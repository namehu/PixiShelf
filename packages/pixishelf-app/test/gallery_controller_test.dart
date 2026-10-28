import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/gallery_controller.dart';
import 'package:pixishelf_app/gallery_query.dart';
import 'package:pixishelf_app/reader_controller.dart';
import 'package:pixishelf_app/storage.dart';
import 'fixtures/gallery_api.dart';

class DelayedGalleryApi extends GalleryApiFixture {
  final old = Completer<Map<String, dynamic>>();
  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET', Map<String, dynamic>? query, Object? body}) {
    if (path == 'feed' && query?['search'] == 'old') return old.future;
    return super.request(path, method: method, query: query, body: body);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late AppStorage storage;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    storage = AppStorage(await SharedPreferences.getInstance());
  });
  test(
      'gallery snapshot keeps filtering, seed and pagination when entering at an arbitrary artwork',
      () async {
    final api = GalleryApiFixture();
    final gallery = GalleryController(api, storage);
    await gallery.start(
        filters: const GalleryQuery(
            sortBy: 'random', mediaType: 'animation', likedOnly: true));
    await gallery.loadMore();
    expect(gallery.items.length, 40);
    expect(api.queries.last['cursor'], 'cursor-page-2');
    expect(api.queries.last['seed'], api.queries.first['seed']);
    expect(api.reports, isEmpty);
    final reader = ReaderController(api, storage);
    await reader.start(entry: gallery.entry(25));
    expect(reader.current!.id, 25);
    expect(reader.seed, gallery.seed);
    expect(reader.filters.mediaType, 'animation');
    expect(api.queries.length, 2);
    await reader.selectMedia(40);
    expect(reader.mediaIndex, 40);
    expect(reader.source, isNotNull);
    expect(api.reports, isEmpty);
    reader.dispose();
    expect(api.closed, isFalse);
    gallery.updateReading({25: 'COMPLETED'});
    expect(gallery.items[24].readingStatus, 'COMPLETED');
    expect(gallery.items.length, 40);
    expect(gallery.items[24].id, 25);
    expect(storage.galleryQuery('https://fixture.invalid|other').likedOnly,
        isFalse);
    gallery.dispose();
    api.close();
  });
  test('late results from the previous filter cannot replace the new list',
      () async {
    final api = DelayedGalleryApi();
    final gallery = GalleryController(api, storage);
    final previous = gallery.start(filters: const GalleryQuery(search: 'old'));
    await Future<void>.delayed(Duration.zero);
    await gallery.start(filters: const GalleryQuery(search: 'new'));
    api.old.complete({
      'items': [
        {'id': 999, 'title': 'stale'}
      ],
      'nextPage': null
    });
    await previous;
    expect(gallery.query.search, 'new');
    expect(gallery.items.any((item) => item.id == 999), isFalse);
    expect(storage.galleryQuery(api.session.scope).search, 'new');
    gallery.dispose();
    api.close();
  });
}
