import 'dart:math';
import 'package:flutter/foundation.dart';
import 'api.dart';
import 'models.dart';
import 'storage.dart';
import 'gallery_query.dart';

class GalleryController extends ChangeNotifier {
  final MobileApi api;
  final AppStorage storage;
  final List<FeedItem> items = [];
  late GalleryQuery query;
  int seed = 1;
  int? nextPage = 1, failureStatus;
  String? cursor, error, pageError;
  bool loading = true, paging = false, _disposed = false;
  String displayMode = 'card';
  bool showReadingStatus = true;
  int _epoch = 0;
  GalleryController(this.api, this.storage) {
    query = storage.galleryQuery(api.session.scope);
  }
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  Future<void> start({GalleryQuery? filters}) async {
    final epoch = ++_epoch;
    query = filters ?? query;
    seed = Random().nextInt(2147483647);
    nextPage = 1;
    cursor = null;
    error = null;
    pageError = null;
    failureStatus = null;
    items.clear();
    loading = true;
    paging = false;
    _emit();
    try {
      final session = await api.request('session');
      if (_disposed || epoch != _epoch) return;
      if (session['apiVersion'] != 1 ||
          (session['user'] as Map)['id'] != api.session.userId) {
        throw const ApiFailure('API_VERSION');
      }
      final preferences = session['galleryPreferences'];
      if (preferences is Map) {
        displayMode =
            preferences['displayMode'] == 'minimal' ? 'minimal' : 'card';
        showReadingStatus = preferences['showReadingStatus'] != false;
      }
      await loadMore();
      if (_disposed || epoch != _epoch) return;
      if (filters != null) {
        await storage.saveGalleryQuery(api.session.scope, query);
      }
    } catch (e) {
      if (!_disposed && epoch == _epoch) {
        error = e is ApiFailure ? e.message : '加载失败，请重试';
        failureStatus = e is ApiFailure ? e.status : null;
      }
    } finally {
      if (!_disposed && epoch == _epoch) {
        loading = false;
        _emit();
      }
    }
  }

  Future<void> loadMore() async {
    if (_disposed || paging || nextPage == null) return;
    final epoch = _epoch;
    paging = true;
    pageError = null;
    _emit();
    try {
      final result = await api.request('feed', query: {
        ...query.parameters,
        'seed': seed,
        'page': nextPage,
        if (cursor != null) 'cursor': cursor
      });
      if (_disposed || epoch != _epoch) return;
      final ids = items.map((v) => v.id).toSet();
      items.addAll((result['items'] as List)
          .map((v) => FeedItem.fromJson(Map<String, dynamic>.from(v)))
          .where((v) => ids.add(v.id)));
      nextPage = result['nextPage'] as int?;
      cursor = result['nextCursor'] as String?;
    } catch (e) {
      if (!_disposed && epoch == _epoch) {
        final message = e is ApiFailure ? e.message : '加载失败，请重试';
        if (items.isEmpty) {
          error = message;
        } else {
          pageError = message;
        }
        failureStatus = e is ApiFailure ? e.status : null;
      }
    } finally {
      if (!_disposed && epoch == _epoch) {
        paging = false;
        _emit();
      }
    }
  }

  ReaderEntry entry(int id) => ReaderEntry(
      items: items,
      query: query,
      seed: seed,
      artworkId: id,
      nextPage: nextPage,
      cursor: cursor);
  void updateReading(Map<int, String> states) {
    for (var i = 0; i < items.length; i++) {
      final state = states[items[i].id];
      if (state != null) items[i] = items[i].withReading(state);
    }
    _emit();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_epoch;
    super.dispose();
  }
}
