import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'api.dart';
import 'models.dart';
import 'storage.dart';
import 'gallery_query.dart';

class ReaderController extends ChangeNotifier {
  final MobileApi api;
  final AppStorage storage;
  final bool sameWorkOnly;
  final Set<int>? allowedMediaIds;
  final Map<int, ArtworkDetailData> details = {};
  final Map<String, bool> mediaLikes = {};
  final Map<String, Duration> videoPositions = {};
  final Map<String, bool> _markTargets = {};
  bool _savingMark = false;
  bool autoEnabled = false, autoPaused = false, transitioning = false;
  int autoSeconds = 5;
  double videoSpeed = 1;
  int longPressSpeed = 2;
  Timer? _autoTimer;
  String? _animationCycleKey, _completedCycleKey;
  final List<FeedItem> feed = [];
  final Map<int, ReaderData> readers = {};
  final Map<int, int> positions = {};
  int artworkIndex = 0, mediaIndex = 0, seed = Random().nextInt(2147483647);
  int? nextPage = 1;
  String? cursor;
  GalleryQuery filters = const GalleryQuery(sortBy: 'random');
  String get mode => filters.sortBy == 'random' ? 'random' : 'latest';
  set mode(String value) => filters = filters.copyWith(
      sortBy: value == 'random' ? 'random' : 'created_at_desc');
  String get search => filters.search;
  set search(String value) => filters = filters.copyWith(search: value);
  final Map<int, String> readingUpdates = {};
  bool loading = true, paging = false, foreground = true, covered = false;
  bool ready = false,
      savingRating = false,
      _disposed = false,
      _flushing = false;
  int _generation = 0, _selection = 0;
  String? error, notice;
  int? failureStatus;
  final List<_Observation> _events = [];
  Timer? _flushTimer, _heartbeat;
  ReaderController(this.api, this.storage,
      {this.sameWorkOnly = false, List<int>? mediaIds})
      : allowedMediaIds = mediaIds?.toSet() {
    _flushTimer = Timer.periodic(const Duration(seconds: 3), (_) => flush());
    _heartbeat = Timer.periodic(
        const Duration(seconds: 60), (_) => observe(heartbeat: true));
  }
  ReaderData? get current =>
      feed.isEmpty ? null : readers[feed[artworkIndex].id];
  MediaItem? get media => current == null || current!.media.isEmpty
      ? null
      : current!.media[mediaIndex];
  MediaSource? get source => media == null ? null : current!.sources[media!.id];
  String get selectionKey => '${current?.id}:${current?.revision}:${media?.id}';
  ArtworkDetailData? get detail => details[current?.id];
  List<int> get mediaIndices => [
        for (var i = 0; i < (current?.media.length ?? 0); i++)
          if (allowedMediaIds == null ||
              allowedMediaIds!.contains(current!.media[i].id) ||
              current!.media[i].members.any(allowedMediaIds!.contains))
            i
      ];
  int get candidateIndex => mediaIndices.indexOf(mediaIndex);
  String get markKey => '${current?.id}:${media?.id}';
  bool get mediaLiked => mediaLikes[markKey] ?? false;
  bool get autoRunning => autoEnabled && !autoPaused;
  void emit() {
    if (!_disposed) notifyListeners();
  }

  void fail(Object exception) {
    pauseAuto();
    failureStatus = exception is ApiFailure ? exception.status : null;
    error = exception is ApiFailure ? exception.message : '加载失败，请重试';
    loading = false;
    emit();
  }

  Future<void> start({bool restore = true, ReaderEntry? entry}) async {
    stopAuto(notify: false);
    final generation = ++_generation;
    ++_selection;
    ready = false;
    loading = true;
    error = null;
    failureStatus = null;
    feed.clear();
    readers.clear();
    details.clear();
    positions.clear();
    artworkIndex = 0;
    mediaIndex = 0;
    nextPage = 1;
    cursor = null;
    seed = Random().nextInt(2147483647);
    paging = false;
    emit();
    try {
      final session = await api.request('session');
      if (session['apiVersion'] != 1 ||
          (session['user'] as Map)['id'] != api.session.userId) {
        throw const ApiFailure('API_VERSION');
      }
      if (_disposed || generation != _generation) return;
      if (entry != null) {
        filters = entry.query;
        seed = entry.seed;
        feed.addAll(entry.items);
        nextPage = entry.nextPage;
        cursor = entry.cursor;
        var index = feed.indexWhere((item) => item.id == entry.artworkId);
        if (index < 0) {
          feed.insert(0, FeedItem(entry.artworkId, ''));
          index = 0;
        }
        if (entry.mediaId != null || entry.items.isEmpty) {
          try {
            final data = await api.reader(entry.artworkId);
            if (_disposed || generation != _generation) return;
            readers[data.id] = data;
            positions[data.id] = data.resolvePosition(entry.mediaId);
          } on ApiFailure catch (e) {
            if (e.status != 404 || entry.items.isNotEmpty) rethrow;
            if (_disposed || generation != _generation) return;
            await storage.clearPosition(api.session.scope);
            notice = '上次作品已不存在，已开始新的浏览';
            feed.clear();
            await loadMore();
            if (_disposed || generation != _generation) return;
            if (feed.isEmpty) {
              loading = false;
              emit();
              return;
            }
            index = 0;
          }
        }
        await selectArtwork(index);
        return;
      }
      final saved = restore ? storage.position(api.session.scope) : null;
      if (saved != null) {
        mode = saved['mode'] == 'latest' ? 'latest' : 'random';
        search = saved['search'] as String? ?? '';
        if (saved['filters'] is Map) {
          filters = GalleryQuery.fromJson(
              Map<String, dynamic>.from(saved['filters'] as Map));
        }
        try {
          final data = await api.reader(saved['artworkId'] as int);
          if (_disposed || generation != _generation) return;
          readers[data.id] = data;
          feed.add(FeedItem(data.id, data.title));
          mediaIndex =
              data.resolvePosition(saved['mediaId'] as int? ?? data.resumeId);
          positions[data.id] = mediaIndex;
        } on ApiFailure catch (e) {
          if (e.status != 404) rethrow;
          notice = '上次作品已不存在，已开始新的浏览';
        }
      }
      await loadMore();
      if (_disposed || generation != _generation) return;
      if (feed.isNotEmpty) {
        await selectArtwork(0);
      } else {
        loading = false;
        emit();
      }
    } catch (e) {
      if (generation == _generation && !_disposed) fail(e);
    }
  }

  Future<void> loadMore() async {
    if (paging || nextPage == null || _disposed) return;
    paging = true;
    final generation = _generation;
    try {
      final result = await api.request('feed', query: {
        ...filters.parameters,
        'seed': seed,
        'page': nextPage,
        if (cursor != null) 'cursor': cursor
      });
      if (_disposed || generation != _generation) return;
      final ids = feed.map((item) => item.id).toSet();
      feed.addAll((result['items'] as List)
          .map((v) => FeedItem.fromJson(Map<String, dynamic>.from(v)))
          .where((item) => ids.add(item.id)));
      nextPage = result['nextPage'] as int?;
      cursor = result['nextCursor'] as String?;
    } catch (e) {
      if (generation == _generation && !_disposed) rethrow;
    } finally {
      if (generation == _generation) {
        paging = false;
        emit();
      }
    }
  }

  Future<void> selectArtwork(int index) async {
    if (index < 0 || index >= feed.length) return;
    final selection = ++_selection;
    _cancelAutoTimer();
    ready = false;
    loading = true;
    error = null;
    failureStatus = null;
    artworkIndex = index;
    mediaIndex = positions[feed[index].id] ?? 0;
    emit();
    try {
      final id = feed[index].id;
      final data = readers[id] ?? await api.reader(id);
      if (_disposed || selection != _selection) return;
      readers[id] = data;
      mediaIndex = positions[id] ?? data.resolvePosition(data.resumeId);
      if (mediaIndex >= data.media.length) mediaIndex = 0;
      if (allowedMediaIds != null && !mediaIndices.contains(mediaIndex)) {
        mediaIndex = mediaIndices.firstOrNull ?? 0;
      }
      await _loadCurrentPage(data);
      if (_disposed || selection != _selection) return;
      loading = false;
      emit();
      _save();
      _preload();
      unawaited(_loadDetails(data.id));
      unawaited(_loadMark());
      // Keep only nearby reader metadata; positions remain lightweight.
      final nearby =
          feed.skip(max(0, index - 1)).take(3).map((item) => item.id).toSet();
      readers.removeWhere((id, _) => !nearby.contains(id));
      details.removeWhere((id, _) => !nearby.contains(id));
    } catch (e) {
      if (selection == _selection && !_disposed) fail(e);
    }
  }

  Future<void> _loadCurrentPage(ReaderData data) async {
    if (data.media.isNotEmpty &&
        !data.sources.containsKey(data.media[mediaIndex].id)) {
      await api.mediaPage(data, data.media[mediaIndex].index ~/ 24);
    }
  }

  Future<void> horizontal(int delta, {bool manual = true}) async {
    final data = current;
    if (loading || data == null) return;
    if (manual) pauseAuto();
    final candidates = mediaIndices;
    final target = candidates.indexOf(mediaIndex) + delta;
    if (target < 0 || target >= candidates.length) return;
    await selectMedia(candidates[target], manual: manual);
  }

  Future<void> selectMedia(int target, {bool manual = true}) async {
    final data = current;
    if (loading || data == null) return;
    if (target < 0 || target >= data.media.length) return;
    if (!mediaIndices.contains(target)) return;
    if (manual) pauseAuto();
    _cancelAutoTimer();
    final selection = ++_selection;
    ready = false;
    mediaIndex = target;
    positions[data.id] = target;
    loading = true;
    error = null;
    emit();
    try {
      await _loadCurrentPage(data);
      if (_disposed || selection != _selection) return;
      loading = false;
      emit();
      _save();
      _preload();
      unawaited(_loadMark());
    } catch (e) {
      if (selection == _selection && !_disposed) fail(e);
    }
  }

  Future<void> vertical(int delta, {bool manual = true}) async {
    if (loading || sameWorkOnly) return;
    if (manual) pauseAuto();
    final target = artworkIndex + delta;
    if (target < 0) return;
    try {
      if (target >= feed.length && nextPage != null) await loadMore();
      if (target >= feed.length) {
        notice = '已浏览本轮全部作品';
        emit();
        return;
      }
      await selectArtwork(target);
    } catch (e) {
      fail(e);
    }
  }

  Future<void> retry() async {
    if (feed.isEmpty) {
      await start();
      return;
    }
    final id = feed[artworkIndex].id;
    readers.remove(id);
    await selectArtwork(artworkIndex);
  }

  void _save() {
    final item = media;
    if (item == null) return;
    unawaited(storage.savePosition(api.session.scope, {
      'artworkId': current!.id,
      'mediaId': item.id,
      'mode': mode,
      'search': search,
      'title': current!.title,
      'filters': filters.toJson()
    }).catchError((_) {
      notice = '浏览位置未能保存';
      emit();
    }));
  }

  Future<void> _preload() async {
    final data = current;
    final selection = _selection;
    if (data == null) return;
    for (final offset in [-1, 1]) {
      final index = mediaIndex + offset;
      if (index < 0 || index >= data.media.length) continue;
      final item = data.media[index];
      if (item.video || item.animated) continue;
      try {
        if (!data.sources.containsKey(item.id)) {
          await api.mediaPage(data, index ~/ 24);
        }
        if (_disposed || selection != _selection) return;
        final src = data.sources[item.id];
        if (src != null) await api.media(src.preview, data.revision);
      } catch (_) {
        /* Preloading never changes visible state or reading facts. */
      }
    }
    // A single next-artwork preview, without playback or a reading observation.
    if (_disposed ||
        selection != _selection ||
        sameWorkOnly ||
        artworkIndex + 1 >= feed.length) {
      return;
    }
    final nextId = feed[artworkIndex + 1].id;
    try {
      final next = readers[nextId] ?? await api.reader(nextId);
      if (_disposed || selection != _selection) return;
      readers[nextId] = next;
      if (next.media.isEmpty) return;
      final index = positions[nextId] ?? next.resolvePosition(next.resumeId);
      if (next.media[index].video || next.media[index].animated) return;
      await api.mediaPage(next, index ~/ 24);
      if (_disposed || selection != _selection) return;
      final source = next.sources[next.media[index].id];
      if (source != null) await api.media(source.preview, next.revision);
    } catch (_) {/* Best-effort prefetch never changes the visible artwork. */}
  }

  void setVisible(bool value) {
    foreground = value;
    if (!value) {
      pauseAuto();
      ready = false;
      unawaited(flush());
    }
    emit();
  }

  void setCovered(bool value) {
    covered = value;
    if (value) {
      pauseAuto();
      ready = false;
    }
    emit();
  }

  void mediaReady(String key) {
    if (_disposed ||
        key != selectionKey ||
        loading ||
        transitioning ||
        !foreground ||
        covered ||
        media?.video != false) {
      return;
    }
    if (!ready) {
      ready = true;
      observe();
      emit();
    }
    _scheduleAuto();
  }

  Map<String, double>? _playback;
  String? _playbackKey;
  void videoObservation(
      String key, double position, double duration, bool playing) {
    if (_disposed ||
        key != selectionKey ||
        !foreground ||
        covered ||
        loading ||
        transitioning ||
        media?.video != true ||
        duration <= 0 ||
        position <= 0) {
      return;
    }
    _playback = {'currentTime': position, 'duration': duration};
    _playbackKey = key;
    ready = true;
    observe();
    // Video observations are driven only by actual player progress, never the image heartbeat.
    ready = false;
  }

  void observe({bool heartbeat = false}) {
    if (!ready ||
        !foreground ||
        covered ||
        transitioning ||
        current == null ||
        media == null) {
      return;
    }
    _events.add(_Observation(current!.id, current!.revision, {
      'type': heartbeat ? 'HEARTBEAT' : 'VIEW',
      'mediaId': media!.id,
      'observedAt': DateTime.now().toUtc().toIso8601String(),
      if (media!.video && _playbackKey == selectionKey && _playback != null)
        'playback': _playback,
    }));
  }

  Future<void>? _flushFuture;
  Future<void> flush() async {
    while (_flushFuture != null) {
      await _flushFuture;
    }
    if (_disposed || _events.isEmpty) return;
    final pending = _flushBatch();
    _flushFuture = pending;
    try {
      await pending;
    } finally {
      if (identical(_flushFuture, pending)) _flushFuture = null;
    }
  }

  Future<void> _flushBatch() async {
    if (_flushing || _events.isEmpty || _disposed) return;
    _flushing = true;
    try {
      final pending = List<_Observation>.from(_events);
      _events.clear();
      while (pending.isNotEmpty && !_disposed) {
        final first = pending.first;
        final group = pending
            .where((e) =>
                e.artwork == first.artwork && e.revision == first.revision)
            .take(100)
            .toList();
        pending.removeWhere(group.contains);
        try {
          final response = await api.request('reading', method: 'POST', body: {
            'expectedUserId': api.session.userId,
            'artworkId': first.artwork,
            'mediaRevision': first.revision,
            'events': group.map((e) => e.event).toList()
          });
          if (_disposed) return;
          final data = readers[first.artwork];
          if (data?.revision == first.revision) {
            data!.seen.addAll((response['seenMediaIds'] as List).cast<int>());
          }
          final summary = response['summary'];
          if (summary is Map && summary['status'] is String) {
            if (data?.revision == first.revision) {
              data!.summary =
                  ReadingSummary.fromJson(Map<String, dynamic>.from(summary));
            }
            readingUpdates[first.artwork] = summary['status'] as String;
            emit();
          }
        } on ApiFailure catch (e) {
          if (_disposed) return;
          if (e.status == 401 || e.status == 403) {
            fail(e);
            return;
          }
          final now = DateTime.now().toUtc();
          final retry = group
              .where((v) =>
                  v.attempts < 2 &&
                  now
                          .difference(
                              DateTime.parse(v.event['observedAt'] as String))
                          .inSeconds <
                      50 &&
                  e.status != 409)
              .toList();
          for (final event in retry) {
            event.attempts++;
            _events.add(event);
          }
          if (retry.length != group.length) {
            notice = '部分阅读进度未保存，请联网后重新浏览';
            emit();
          }
        }
      }
    } finally {
      _flushing = false;
    }
  }

  final Map<int, int?> _ratingTargets = {};
  final Map<int, int?> _knownRatings = {};
  Future<void> toggleLike() async {
    final data = current;
    if (data == null || loading) return;
    await setRating(data.liked ? null : 2);
  }

  Future<void> setRating(int? level) async {
    final data = current;
    if (data == null || loading) return;
    _knownRatings.putIfAbsent(data.id, () => data.rating);
    data.rating = level;
    _ratingTargets[data.id] = data.rating;
    emit();
    if (savingRating) return;
    savingRating = true;
    try {
      while (_ratingTargets.isNotEmpty && !_disposed) {
        final id = _ratingTargets.keys.first;
        final level = _ratingTargets.remove(id);
        try {
          await api.request('rating', method: 'PUT', body: {
            'artworkId': id,
            'expectedUserId': api.session.userId,
            'level': level
          });
          if (_disposed) return;
          _knownRatings[id] = level;
        } catch (e) {
          if (_disposed) return;
          try {
            final fresh = await api.reader(id);
            if (_disposed) return;
            if (!_ratingTargets.containsKey(id)) {
              readers[id]?.rating = fresh.rating;
            }
            _knownRatings[id] = fresh.rating;
          } catch (_) {
            if (!_ratingTargets.containsKey(id)) {
              readers[id]?.rating = _knownRatings[id];
            }
          }
          notice = '评分未能保存，请重试';
          if (e is ApiFailure && (e.status == 401 || e.status == 403)) fail(e);
        }
      }
    } finally {
      savingRating = false;
      emit();
    }
  }

  Future<void> _loadDetails(int id) async {
    if (details.containsKey(id)) return;
    final generation = _generation;
    try {
      final data = await api.detail(id);
      if (_disposed || generation != _generation || !readers.containsKey(id)) {
        return;
      }
      details[id] = data;
      emit();
    } on ApiFailure catch (e) {
      if (!_disposed &&
          generation == _generation &&
          (e.status == 401 || e.status == 403)) {
        fail(e);
      }
    } catch (_) {/* Metadata failure never interrupts a visible image. */}
  }

  Future<void> _loadMark() async {
    final artwork = current?.id, mediaId = media?.id;
    final generation = _generation;
    if (artwork == null || mediaId == null) return;
    final key = '$artwork:$mediaId';
    try {
      final states = await api.mediaMarks(artwork, [mediaId]);
      if (_disposed ||
          generation != _generation ||
          _markTargets.containsKey(key) ||
          _savingMark) {
        return;
      }
      mediaLikes[key] =
          states.any((state) => state.mediaId == mediaId && state.liked);
      emit();
    } on ApiFailure catch (e) {
      if (!_disposed &&
          generation == _generation &&
          (e.status == 401 || e.status == 403)) {
        fail(e);
      }
    } catch (_) {/* Missing optional mark metadata remains retryable. */}
  }

  Future<void> toggleMediaLike() async {
    if (current == null || media == null || loading) return;
    final key = markKey;
    _markTargets[key] = !mediaLiked;
    mediaLikes[key] = !mediaLiked;
    emit();
    if (_savingMark) return;
    _savingMark = true;
    try {
      while (_markTargets.isNotEmpty && !_disposed) {
        final targetKey = _markTargets.keys.first;
        final target = _markTargets.remove(targetKey)!;
        final ids = targetKey.split(':').map(int.parse).toList();
        try {
          final state = await api.setMediaMark(ids[0], ids[1], 'like', target);
          if (_disposed) return;
          if (!_markTargets.containsKey(targetKey)) {
            mediaLikes[targetKey] = state.liked;
          }
        } catch (e) {
          if (_disposed) return;
          if (!_markTargets.containsKey(targetKey)) {
            mediaLikes[targetKey] = !target;
          }
          notice = '单图喜欢未能保存，请重试';
          if (e is ApiFailure && (e.status == 401 || e.status == 403)) fail(e);
        }
        emit();
      }
    } finally {
      _savingMark = false;
    }
  }

  Future<void> refreshOrganization() async {
    final id = current?.id;
    if (id == null) return;
    try {
      final fresh = await api.reader(id);
      if (_disposed || current?.id != id) return;
      if (current!.revision != fresh.revision ||
          current!.fingerprint != fresh.fingerprint) {
        fail(const ApiFailure('MEDIA_CHANGED', 409));
        return;
      }
      current!.rating = fresh.rating;
      current!.seen.addAll(fresh.seen);
      current!.summary = fresh.summary;
      readingUpdates[id] = fresh.summary.status;
      await _loadMark();
      emit();
    } on ApiFailure catch (e) {
      if (e.status == 401 || e.status == 403 || e.status == 409) fail(e);
    }
  }

  void _cancelAutoTimer() {
    _autoTimer?.cancel();
    _autoTimer = null;
  }

  void startAuto({int? seconds}) {
    if (seconds != null) autoSeconds = seconds;
    autoEnabled = true;
    autoPaused = false;
    _completedCycleKey = null;
    _scheduleAuto();
    emit();
  }

  void pauseAuto() {
    _cancelAutoTimer();
    if (autoEnabled && !autoPaused) {
      autoPaused = true;
      emit();
    }
  }

  void stopAuto({bool notify = true}) {
    _cancelAutoTimer();
    autoEnabled = false;
    autoPaused = false;
    if (notify) emit();
  }

  void setTransitioning(bool value) {
    transitioning = value;
    if (value) {
      _cancelAutoTimer();
    } else {
      _scheduleAuto();
    }
  }

  void setAnimationCycleMode(String key, bool useCycle) {
    if (key != selectionKey) return;
    _animationCycleKey = useCycle ? key : null;
  }

  void animationCycleComplete(String key) {
    if (key != selectionKey || key != _animationCycleKey) return;
    _completedCycleKey = key;
    if (autoRunning && ready && foreground && !covered && !transitioning) {
      unawaited(_advanceAuto());
    }
  }

  void _scheduleAuto() {
    if (!autoRunning ||
        !ready ||
        media?.video != false ||
        !foreground ||
        covered ||
        loading ||
        transitioning ||
        _autoTimer != null) {
      return;
    }
    if (_animationCycleKey == selectionKey &&
        _completedCycleKey != selectionKey) {
      return;
    }
    final key = selectionKey;
    _autoTimer = Timer(Duration(seconds: autoSeconds), () {
      _autoTimer = null;
      if (key == selectionKey &&
          autoRunning &&
          ready &&
          foreground &&
          !covered &&
          !transitioning) {
        unawaited(_advanceAuto());
      }
    });
  }

  void videoEnded(String key) {
    if (key == selectionKey &&
        autoRunning &&
        foreground &&
        !covered &&
        !loading) {
      unawaited(_advanceAuto());
    }
  }

  bool _autoAdvancing = false;
  Future<void> _advanceAuto() async {
    if (_autoAdvancing || !autoRunning || loading) return;
    _autoAdvancing = true;
    final generation = _generation;
    _cancelAutoTimer();
    try {
      final candidates = mediaIndices;
      final next = candidates.indexOf(mediaIndex) + 1;
      if (next < candidates.length) {
        await selectMedia(candidates[next], manual: false);
      } else if (!sameWorkOnly) {
        if (artworkIndex + 1 >= feed.length && nextPage != null) {
          await loadMore();
        }
        if (_disposed || generation != _generation || !autoRunning) return;
        if (artworkIndex + 1 < feed.length) {
          // An automatically entered work starts at its first media.
          positions[feed[artworkIndex + 1].id] = 0;
          await selectArtwork(artworkIndex + 1);
        } else {
          stopAuto();
          notice = '本轮自动浏览已完成';
        }
      } else {
        stopAuto();
        notice = '当前作品已浏览完毕';
      }
    } catch (e) {
      fail(e);
    } finally {
      _autoAdvancing = false;
      emit();
    }
  }

  Future<void> skipAutoError() async {
    loading = false;
    error = null;
    autoEnabled = true;
    autoPaused = false;
    await _advanceAuto();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    ++_selection;
    _flushTimer?.cancel();
    _heartbeat?.cancel();
    _autoTimer?.cancel();
    _events.clear();
    super.dispose();
  }
}

class _Observation {
  final int artwork, revision;
  final Map<String, dynamic> event;
  int attempts = 0;
  _Observation(this.artwork, this.revision, this.event);
}
