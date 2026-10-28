import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/storage.dart';
import 'package:pixishelf_app/reader_controller.dart';

class FakeApi extends MobileApi {
  final List<Map<String, dynamic>> reports = [];
  bool rejectRating = false;
  final List<int?> ratings = [];
  @override
  Future<ReaderData> reader(int id) async => throw const ApiFailure('OFFLINE');
  FakeApi() : super(const Session('https://gallery.test', 'token', 'owner'));
  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    if (path == 'rating') {
      if (rejectRating) throw const ApiFailure('OFFLINE');
      ratings.add((body as Map)['level'] as int?);
      return {};
    }
    if (path == 'reading') {
      reports.add(Map<String, dynamic>.from(body as Map));
      return {
        'seenMediaIds': [8]
      };
    }
    return {};
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeApi api;
  late ReaderController controller;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    api = FakeApi();
    controller = ReaderController(
        api, AppStorage(await SharedPreferences.getInstance()));
    controller.feed.add(const FeedItem(4, 'test'));
    controller.readers[4] = ReaderData(
        id: 4,
        title: 'test',
        author: '',
        fingerprint: 'abc',
        revision: 1,
        media: [
          const MediaItem(
              id: 8, index: 0, video: false, animated: false, members: [8])
        ],
        resumeId: null,
        rating: null,
        seen: {});
    controller.current!.sources[8] =
        const MediaSource(8, false, '/preview', '/original');
    controller.loading = false;
  });
  tearDown(() => controller.dispose());
  test('saved group members resolve to the representative', () {
    controller.current!.media.add(const MediaItem(
        id: 9, index: 1, video: false, animated: false, members: [9, 10]));
    expect(controller.current!.resolvePosition(10), 1);
  });
  test(
      'likes assign existing rating semantics and recover from offline failure',
      () async {
    await controller.toggleLike();
    expect(api.ratings, [2]);
    expect(controller.current!.liked, isTrue);
    api.rejectRating = true;
    await controller.toggleLike();
    expect(controller.current!.rating, 2);
    expect(controller.notice, isNotNull);
  });
  test('preloading and stale callbacks cannot produce reading', () async {
    await controller.flush();
    expect(api.reports, isEmpty);
    controller.mediaReady('wrong-key');
    await controller.flush();
    expect(api.reports, isEmpty);
    controller.mediaReady(controller.selectionKey);
    await controller.flush();
    expect(api.reports.single['events'], hasLength(1));
  });
  test('background and covered media do not count as viewed', () async {
    controller.setVisible(false);
    controller.mediaReady(controller.selectionKey);
    await controller.flush();
    expect(api.reports, isEmpty);
    controller.setVisible(true);
    controller.setCovered(true);
    controller.mediaReady(controller.selectionKey);
    await controller.flush();
    expect(api.reports, isEmpty);
  });
  test('APNG first rendered animation frame now counts as reading', () async {
    controller.current!.sources[8] =
        const MediaSource(8, true, '/preview', '/original');
    controller.mediaReady(controller.selectionKey);
    await controller.flush();
    expect(api.reports, hasLength(1));
  });
  test('video reports require actual playback, retain server 90 percent rule',
      () async {
    controller.current!.media[0] = const MediaItem(
        id: 8, index: 0, video: true, animated: false, members: [8]);
    controller.mediaReady(controller.selectionKey);
    await controller.flush();
    expect(api.reports, isEmpty);
    controller.videoObservation(controller.selectionKey, 0, 100, true);
    await controller.flush();
    expect(api.reports, isEmpty);
    controller.videoObservation(controller.selectionKey, 91, 100, true);
    await controller.flush();
    final event = (api.reports.single['events'] as List).single as Map;
    expect(event['playback'], {'currentTime': 91.0, 'duration': 100.0});
    controller.observe(heartbeat: true);
    await controller.flush();
    expect(api.reports, hasLength(1));
  });
}
