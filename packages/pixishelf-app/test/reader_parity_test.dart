import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/reader_controller.dart';
import 'package:pixishelf_app/reader_progress.dart';
import 'package:pixishelf_app/storage.dart';

class ParityApi extends MobileApi {
  final List<Map<String, dynamic>> reports = [];
  final List<int?> ratings = [];
  final List<bool> likes = [];
  ParityApi()
      : super(const Session('https://fixture.invalid', 'synthetic', 'owner'));
  @override
  Future<ArtworkDetailData> detail(int id) async =>
      ArtworkDetailData(id: id, title: 'Fixture');
  @override
  Future<List<MediaMark>> mediaMarks(int artworkId, List<int> ids) async => [];
  @override
  Future<MediaMark> setMediaMark(
      int artworkId, int mediaId, String kind, bool value) async {
    likes.add(value);
    return MediaMark(
        artworkId: artworkId, mediaId: mediaId, likedAt: value ? 'now' : null);
  }

  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    if (path == 'rating') {
      ratings.add((body as Map)['level'] as int?);
      return {};
    }
    if (path == 'reading') {
      reports.add(Map<String, dynamic>.from(body as Map));
      return {'seenMediaIds': []};
    }
    return {};
  }
}

Future<ReaderController> fixture(ParityApi api, {List<int>? ids}) async {
  SharedPreferences.setMockInitialValues({});
  final c = ReaderController(
      api, AppStorage(await SharedPreferences.getInstance()),
      sameWorkOnly: true, mediaIds: ids);
  c.feed.add(const FeedItem(1, 'Fixture'));
  c.nextPage = null;
  c.readers[1] = ReaderData(
      id: 1,
      title: 'Fixture',
      author: '',
      fingerprint: 'fp',
      revision: 1,
      media: [
        for (var i = 0; i < 3; i++)
          MediaItem(
              id: i + 10,
              index: i,
              video: false,
              animated: false,
              members: [i + 10])
      ],
      resumeId: null,
      rating: null,
      seen: {},
      stackFingerprint: 'fp',
      stacks: [
        const ArtworkStackGroup(
            id: 'g1',
            mediaIds: [10, 11, 12],
            representativeMediaId: 10,
            startIndex: 0,
            endIndex: 2)
      ]);
  for (final media in c.current!.media) {
    c.current!.sources[media.id] =
        MediaSource(media.id, false, '/preview', '/original');
  }
  c.loading = false;
  return c;
}

void main() {
  testWidgets(
      'automatic browsing waits for visible readiness and pauses across sheets/background',
      (tester) async {
    final c = await fixture(ParityApi());
    c.startAuto(seconds: 3);
    await tester.pump(const Duration(seconds: 4));
    expect(c.mediaIndex, 0);
    c.mediaReady(c.selectionKey);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(c.mediaIndex, 1);
    c.mediaReady(c.selectionKey);
    c.setCovered(true);
    c.setCovered(false);
    c.mediaReady(c.selectionKey);
    await tester.pump(const Duration(seconds: 4));
    expect(c.mediaIndex, 1);
    expect(c.autoPaused, isTrue);
    c.startAuto();
    c.setVisible(false);
    c.setVisible(true);
    c.mediaReady(c.selectionKey);
    await tester.pump(const Duration(seconds: 4));
    expect(c.mediaIndex, 1);
    c.startAuto();
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(c.mediaIndex, 2);
    c.mediaReady(c.selectionKey);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(c.autoEnabled, isFalse);
    c.dispose();
  });

  testWidgets(
      'video completion advances only at actual end, with no observation during page transition',
      (tester) async {
    final api = ParityApi();
    final c = await fixture(api);
    c.current!.media[0] = const MediaItem(
        id: 10, index: 0, video: true, animated: false, members: [10]);
    c.startAuto(seconds: 3);
    c.setTransitioning(true);
    c.videoObservation(c.selectionKey, 9.5, 10, true);
    await c.flush();
    expect(api.reports, isEmpty);
    c.setTransitioning(false);
    c.videoObservation(c.selectionKey, 9.5, 10, true);
    await tester.pump(const Duration(seconds: 10));
    expect(c.mediaIndex, 0);
    c.videoEnded(c.selectionKey);
    await tester.pump();
    expect(c.mediaIndex, 1);
    c.dispose();
  });

  test('same-work preview keeps original indices and never grants a stack',
      () async {
    final api = ParityApi();
    final c = await fixture(api, ids: [10, 12]);
    expect(c.mediaIndices, [0, 2]);
    await c.horizontal(1);
    expect(c.media!.id, 12);
    await c.vertical(1);
    expect(c.current!.id, 1);
    c.dispose();
    final preview = await fixture(api);
    preview.mediaReady(preview.selectionKey);
    await preview.flush();
    final event = (api.reports.single['events'] as List).single as Map;
    expect(event['mediaId'], 10);
    expect(event.containsKey('stack'), isFalse);
    preview.dispose();
  });

  test('explicit artwork rating and single-media like stay independent',
      () async {
    final api = ParityApi();
    final reader = await fixture(api);
    await reader.setRating(1);
    expect(reader.current!.liked, isFalse);
    await reader.setRating(4);
    await reader.toggleMediaLike();
    expect(reader.current!.rating, 4);
    expect(reader.mediaLiked, isTrue);
    await reader.toggleLike();
    expect(reader.current!.rating, isNull);
    expect(reader.mediaLiked, isTrue);
    expect(api.ratings, [1, 4, null]);
    expect(api.likes, [true]);
    reader.dispose();
  });

  testWidgets(
      'segmented progress previews during drag and commits only on release',
      (tester) async {
    final commits = <int>[];
    var canceled = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SizedBox(
                width: 300,
                child: ReaderProgress(
                    indices: const [0, 4, 8],
                    current: 0,
                    onCommit: commits.add,
                    onStart: () {},
                    onCancel: () => canceled++)))));
    final gesture = await tester.startGesture(const Offset(30, 24));
    await gesture.moveTo(const Offset(240, 24));
    await tester.pump();
    expect(commits, isEmpty);
    expect(find.text('第 9 项'), findsOneWidget);
    await gesture.up();
    await tester.pump();
    expect(commits, [8]);
    final cancel = await tester.startGesture(const Offset(30, 24));
    await cancel.moveTo(const Offset(150, 24));
    await tester.pump();
    await cancel.cancel();
    expect(commits, [8]);
    expect(canceled, 1);
    await tester.pumpWidget(const SizedBox());
  });
}
