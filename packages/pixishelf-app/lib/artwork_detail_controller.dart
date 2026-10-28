import 'dart:async';
import 'package:flutter/foundation.dart';
import 'api.dart';
import 'models.dart';

/// Owns one detail route. Visibility is supplied by the rendered media tiles;
/// fetching metadata, thumbnails, and neighboring works never creates a visit.
class ArtworkDetailController extends ChangeNotifier {
  final MobileApi api;
  final int artworkId;
  ArtworkDetailData? detail;
  ReaderData? reader;
  bool loading = true, foreground = true, covered = false, locating = false;
  bool unreadOnly = false, expanded = false, stacked = false, marking = false;
  bool savingRating = false, disposed = false;
  int initialCount = 10;
  int? failureStatus;
  String? error, notice;
  Set<int>? _unreadSnapshot;
  final Map<int, MediaMark> marks = {};
  final Map<int, String> mediaErrors = {};
  final Set<int> finishedVideos = {};
  final Map<int, String> readingUpdates = {};
  final Map<int, bool> _visible = {};
  final Set<int> _ready = {}, _observed = {}, _loadingPages = {};
  final List<Map<String, dynamic>> _events = [];
  final Map<String, Future<void>> _markWrites = {};
  final Map<int, Future<void>> _mediaMarkWrites = {};
  final Map<String, bool> _markTargets = {};
  Timer? _reportTimer, _heartbeat;
  int _epoch = 0;
  Future<void>? _flushFuture;
  int? _ratingTarget;
  int _ratingIntent = 0;

  ArtworkDetailController(this.api, this.artworkId) {
    _reportTimer = Timer.periodic(const Duration(seconds: 3), (_) => flush());
    _heartbeat = Timer.periodic(const Duration(seconds: 60), (_) {
      for (final id in _ready) {
        if (_eligible(id)) _observe(id, heartbeat: true);
      }
    });
  }

  List<MediaItem> get candidates =>
      reader?.media
          .where((item) => !unreadOnly || _unreadSnapshot!.contains(item.id))
          .toList() ??
      [];
  bool get canCollapse =>
      candidates.length > initialCount + (initialCount * .25).floor();
  List<MediaItem> get displayed => expanded || !canCollapse || stacked
      ? candidates
      : candidates.take(initialCount).toList();
  bool get canObserve =>
      !disposed &&
      foreground &&
      !covered &&
      !locating &&
      !loading &&
      error == null;

  void emit() {
    if (!disposed) notifyListeners();
  }

  void fail(Object e, {bool fatal = false}) {
    failureStatus = e is ApiFailure ? e.status : null;
    final message = e is ApiFailure ? e.message : '加载失败，请重试';
    if (fatal || failureStatus == 409) {
      error = message;
      _events.clear();
      _ready.clear();
    } else {
      notice = message;
    }
    emit();
  }

  Future<void> load() async {
    final epoch = ++_epoch;
    loading = true;
    error = null;
    failureStatus = null;
    _ready.clear();
    _observed.clear();
    _visible.clear();
    _events.clear();
    _loadingPages.clear();
    mediaErrors.clear();
    finishedVideos.clear();
    emit();
    try {
      final results =
          await Future.wait([api.detail(artworkId), api.reader(artworkId)]);
      if (disposed || epoch != _epoch) return;
      detail = results[0] as ArtworkDetailData;
      reader = results[1] as ReaderData;
      readingUpdates[artworkId] = reader!.summary.status;
      if (unreadOnly) _snapshotUnread();
      loading = false;
      emit();
    } catch (e) {
      if (!disposed && epoch == _epoch) {
        loading = false;
        fail(e, fatal: true);
      }
    }
  }

  Future<void> ensureMedia(MediaItem item) async {
    final data = reader;
    if (disposed || data == null) return;
    final page = item.index ~/ 24;
    if (data.sources.containsKey(item.id) || !_loadingPages.add(page)) return;
    mediaErrors.remove(page);
    try {
      await api.mediaPage(data, page);
      if (disposed || data != reader) return;
      emit();
      final ids = data.media.skip(page * 24).take(24).map((v) => v.id).toList();
      final loaded = await api.mediaMarks(artworkId, ids);
      if (disposed || data != reader) return;
      for (final mark in loaded) {
        if (!_markWrites.keys
            .any((key) => key.startsWith('${mark.mediaId}:'))) {
          marks[mark.mediaId] = mark;
        }
      }
      emit();
    } catch (e) {
      if (!disposed && data == reader) {
        mediaErrors[page] = e is ApiFailure ? e.message : '加载失败，请重试';
        fail(e);
      }
    } finally {
      _loadingPages.remove(page);
    }
  }

  void setVisibility(int mediaId, bool visible) {
    _visible[mediaId] = visible;
    if (!visible) {
      _ready.remove(mediaId);
      _observed.remove(mediaId);
    }
  }

  bool _eligible(int id) => canObserve && _visible[id] == true;
  void mediaReady(int mediaId) {
    if (!_eligible(mediaId)) return;
    _ready.add(mediaId);
    if (_observed.add(mediaId)) _observe(mediaId);
  }

  bool isReady(int id) => _ready.contains(id);
  void videoEnded(int mediaId) {
    if (_eligible(mediaId)) finishedVideos.add(mediaId);
  }

  void videoObservation(
      int mediaId, double position, double duration, bool playing) {
    if (!_eligible(mediaId) || position <= 0 || duration <= 0) return;
    _observe(mediaId,
        playback: {'currentTime': position, 'duration': duration});
  }

  void _observe(int mediaId,
      {bool heartbeat = false, Map<String, double>? playback}) {
    final data = reader;
    if (!_eligible(mediaId) || data == null) return;
    ArtworkStackGroup? group;
    if (stacked &&
        !heartbeat &&
        playback == null &&
        data.stackFingerprint != null) {
      for (final value in data.stacks) {
        if (value.mediaIds.contains(mediaId)) {
          group = value;
          break;
        }
      }
    }
    _events.add({
      'type': heartbeat ? 'HEARTBEAT' : 'VIEW',
      'mediaId': mediaId,
      'observedAt': DateTime.now().toUtc().toIso8601String(),
      if (playback != null) 'playback': playback,
      if (group != null)
        'stack': {
          'ruleVersion': 1,
          'fingerprint': data.stackFingerprint,
          'groupId': group.id
        },
    });
    if (_events.length > 100) unawaited(flush());
  }

  void setCovered(bool value) {
    covered = value;
    if (value) {
      _ready.clear();
      _observed.clear();
      unawaited(flush());
    }
    emit();
  }

  void setForeground(bool value) {
    foreground = value;
    if (!value) {
      _ready.clear();
      _observed.clear();
      unawaited(flush());
    }
    emit();
  }

  Future<void> flush() async {
    while (_flushFuture != null) {
      await _flushFuture;
    }
    if (disposed || _events.isEmpty || reader == null) return;
    final pending = _flush();
    _flushFuture = pending;
    try {
      await pending;
    } finally {
      if (identical(_flushFuture, pending)) _flushFuture = null;
    }
  }

  Future<void> _flush() async {
    final data = reader!;
    final batch = _events.take(100).toList();
    _events.removeRange(0, batch.length);
    try {
      final result = await api.request('reading', method: 'POST', body: {
        'expectedUserId': api.session.userId,
        'artworkId': artworkId,
        'mediaRevision': data.revision,
        'events': batch,
      });
      if (disposed || reader != data) return;
      if (result['mediaRevision'] != null &&
          result['mediaRevision'] != data.revision) {
        throw const ApiFailure('MEDIA_CHANGED', 409);
      }
      data.seen.addAll((result['seenMediaIds'] as List? ?? []).cast<int>());
      if (result['summary'] is Map) {
        final summary = ReadingSummary.fromJson(
            Map<String, dynamic>.from(result['summary']));
        if (summary.stateVersion >= data.summary.stateVersion) {
          data.summary = summary;
        }
        readingUpdates[artworkId] = data.summary.status;
      }
      emit();
    } catch (e) {
      if (!disposed && reader == data) fail(e);
    }
  }

  Future<void> refreshReading() async {
    final old = reader;
    if (old == null) return;
    try {
      final fresh = await api.reader(artworkId);
      if (disposed || reader != old) return;
      if (fresh.revision != old.revision ||
          fresh.fingerprint != old.fingerprint) {
        throw const ApiFailure('MEDIA_CHANGED', 409);
      }
      old.seen.addAll(fresh.seen);
      old.summary = fresh.summary;
      old.rating = fresh.rating;
      readingUpdates[artworkId] = fresh.summary.status;
      emit();
      if (marks.isNotEmpty) {
        final latestMarks =
            await api.mediaMarks(artworkId, marks.keys.take(200).toList());
        if (disposed || reader != old) return;
        for (final mark in latestMarks) {
          if (!_mediaMarkWrites.containsKey(mark.mediaId)) {
            marks[mark.mediaId] = mark;
          }
        }
        emit();
      }
    } catch (e) {
      if (!disposed) fail(e);
    }
  }

  void _snapshotUnread() {
    _unreadSnapshot = reader!.media
        .where((item) => !reader!.seen.contains(item.id))
        .map((item) => item.id)
        .toSet();
  }

  void toggleUnread() {
    unreadOnly = !unreadOnly;
    if (unreadOnly) _snapshotUnread();
    emit();
  }

  Future<void> refreshUnread() async {
    await flush();
    await refreshReading();
    if (disposed || reader == null || error != null) return;
    _snapshotUnread();
    emit();
  }

  Future<void> markRead({int? mediaId}) async {
    final data = reader;
    if (data == null || marking) return;
    marking = true;
    emit();
    try {
      final result = await api.markRead(data, mediaId: mediaId);
      if (disposed || reader != data) return;
      if (result.revision != data.revision) {
        throw const ApiFailure('MEDIA_CHANGED', 409);
      }
      data.seen.addAll(result.seen);
      if (result.summary.stateVersion >= data.summary.stateVersion) {
        data.summary = result.summary;
      }
      readingUpdates[artworkId] = data.summary.status;
    } catch (e) {
      if (!disposed) fail(e);
    } finally {
      marking = false;
      emit();
    }
  }

  Future<void> setRating(int? level) async {
    final data = reader;
    if (data == null) return;
    _ratingTarget = level;
    notice = null;
    _ratingIntent++;
    if (savingRating) return;
    savingRating = true;
    emit();
    try {
      while (!disposed && data == reader) {
        final intent = _ratingIntent, target = _ratingTarget;
        try {
          data.rating = await api.setRating(artworkId, target);
        } catch (e) {
          if (!disposed) fail(e);
        }
        if (intent == _ratingIntent) break;
      }
    } finally {
      savingRating = false;
      emit();
    }
  }

  Future<void> setMark(int mediaId, String kind, bool value) {
    final key = '$mediaId:$kind';
    final previous = _mediaMarkWrites[mediaId] ?? Future<void>.value();
    _markTargets[key] = value;
    notice = null;
    emit();
    late final Future<void> pending;
    pending = previous.then((_) async {
      if (disposed) return;
      try {
        final mark = await api.setMediaMark(artworkId, mediaId, kind, value);
        if (!disposed) {
          marks[mediaId] = mark;
          emit();
        }
      } catch (e) {
        if (!disposed) fail(e);
      }
    }).whenComplete(() {
      if (identical(_markWrites[key], pending)) {
        _markWrites.remove(key);
        _markTargets.remove(key);
      }
      if (identical(_mediaMarkWrites[mediaId], pending)) {
        _mediaMarkWrites.remove(mediaId);
      }
      emit();
    });
    _markWrites[key] = pending;
    _mediaMarkWrites[mediaId] = pending;
    return pending;
  }

  bool markValue(int mediaId, String kind) =>
      _markTargets['$mediaId:$kind'] ??
      (kind == 'bookmark'
          ? marks[mediaId]?.bookmarked
          : marks[mediaId]?.liked) ??
      false;

  @override
  void dispose() {
    disposed = true;
    ++_epoch;
    _reportTimer?.cancel();
    _heartbeat?.cancel();
    super.dispose();
  }
}
