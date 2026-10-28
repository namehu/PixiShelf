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
  ReaderController(this.api, this.storage) {
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
  void emit() {
    if (!_disposed) notifyListeners();
  }

  void fail(Object exception) {
    failureStatus = exception is ApiFailure ? exception.status : null;
    error = exception is ApiFailure ? exception.message : '加载失败，请重试';
    loading = false;
    emit();
  }

  Future<void> start({bool restore = true, ReaderEntry? entry}) async {
    final generation = ++_generation;
    ++_selection;
    ready = false;
    loading = true;
    error = null;
    failureStatus = null;
    feed.clear();
    readers.clear();
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
      await _loadCurrentPage(data);
      if (_disposed || selection != _selection) return;
      loading = false;
      emit();
      _save();
      _preload();
      // Keep only nearby reader metadata; positions remain lightweight.
      final nearby =
          feed.skip(max(0, index - 1)).take(3).map((item) => item.id).toSet();
      readers.removeWhere((id, _) => !nearby.contains(id));
    } catch (e) {
      if (selection == _selection && !_disposed) fail(e);
    }
  }

  Future<void> _loadCurrentPage(ReaderData data) async {
    if (data.media.isNotEmpty &&
        !data.sources.containsKey(data.media[mediaIndex].id)) {
      await api.mediaPage(data, mediaIndex ~/ 24);
    }
  }

  Future<void> horizontal(int delta) async {
    final data = current;
    if (loading || data == null) return;
    await selectMedia(mediaIndex + delta);
  }

  Future<void> selectMedia(int target) async {
    final data = current;
    if (loading || data == null) return;
    if (target < 0 || target >= data.media.length) return;
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
    } catch (e) {
      if (selection == _selection && !_disposed) fail(e);
    }
  }

  Future<void> vertical(int delta) async {
    if (loading) return;
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
      ready = false;
      unawaited(flush());
    }
    emit();
  }

  void setCovered(bool value) {
    covered = value;
    if (value) ready = false;
    emit();
  }

  void mediaReady(String key) {
    if (_disposed ||
        key != selectionKey ||
        loading ||
        !foreground ||
        covered ||
        media?.video != false) {
      return;
    }
    if (!ready) {
      ready = true;
      observe();
    }
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
    if (!ready || !foreground || covered || current == null || media == null) {
      return;
    }
    _events.add(_Observation(current!.id, current!.revision, {
      'type': heartbeat ? 'HEARTBEAT' : 'VIEW',
      'mediaId': media!.id,
      'observedAt': DateTime.now().toUtc().toIso8601String(),
      if (media!.video && _playbackKey == selectionKey && _playback != null)
        'playback': _playback
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
    _knownRatings.putIfAbsent(data.id, () => data.rating);
    data.rating = data.liked ? null : 2;
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
          _ratingTargets.remove(id);
          try {
            final fresh = await api.reader(id);
            if (_disposed) return;
            readers[id]?.rating = fresh.rating;
            _knownRatings[id] = fresh.rating;
          } catch (_) {
            readers[id]?.rating = _knownRatings[id];
          }
          notice = '喜欢未能保存，请重试';
          if (e is ApiFailure && (e.status == 401 || e.status == 403)) fail(e);
        }
      }
    } finally {
      savingRating = false;
      emit();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    ++_selection;
    _flushTimer?.cancel();
    _heartbeat?.cancel();
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
