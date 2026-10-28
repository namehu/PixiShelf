import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/artwork_detail_controller.dart';
import 'package:pixishelf_app/models.dart';
import 'fixtures/gallery_api.dart';

class SlowMarksApi extends GalleryApiFixture {
  final List<String> writes = [];
  final first = Completer<void>();
  @override
  Future<MediaMark> setMediaMark(
      int artworkId, int mediaId, String kind, bool value) async {
    writes.add('$kind:$value');
    if (writes.length == 1) await first.future;
    return super.setMediaMark(artworkId, mediaId, kind, value);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late GalleryApiFixture api;
  late ArtworkDetailController c;
  setUp(() async {
    api = GalleryApiFixture();
    c = ArtworkDetailController(api, 1);
    await c.load();
  });
  tearDown(() {
    c.dispose();
    api.close();
  });

  test(
      'detail load and media metadata never read; only rendered visible media read',
      () async {
    await c.ensureMedia(c.reader!.media.first);
    await c.flush();
    expect(api.reports, isEmpty);
    c.mediaReady(1001);
    await c.flush();
    expect(api.reports, isEmpty);
    c.setVisibility(1001, true);
    c.mediaReady(1001);
    await c.flush();
    expect(api.reports, hasLength(1));
    expect((api.reports.single['events'] as List).single['mediaId'], 1001);
    c.setCovered(true);
    c.mediaReady(1001);
    await c.flush();
    expect(api.reports, hasLength(1));
  });

  test('unread snapshot stays stable until an explicit refresh', () async {
    c.toggleUnread();
    expect(c.candidates, hasLength(60));
    c.setVisibility(1001, true);
    c.mediaReady(1001);
    await c.flush();
    expect(c.reader!.seen, contains(1001));
    expect(c.candidates, hasLength(60));
    await c.refreshUnread();
    expect(c.candidates, hasLength(59));
    expect(c.candidates.first.index, 1);
  });

  test('manual completion does not create a visit or change the frozen list',
      () async {
    c.toggleUnread();
    await c.markRead();
    expect(api.reports, isEmpty);
    expect(c.reader!.seen, hasLength(60));
    expect(c.reader!.summary.viewCount, 0);
    expect(c.candidates, hasLength(60));
    expect(c.readingUpdates[1], 'COMPLETED');
  });

  test(
      'stack observation uses authoritative group proof, locating does not read',
      () async {
    c.stacked = true;
    c.locating = true;
    c.setVisibility(1001, true);
    c.mediaReady(1001);
    await c.flush();
    expect(api.reports, isEmpty);
    c.locating = false;
    c.mediaReady(1001);
    await c.flush();
    final event = (api.reports.single['events'] as List).single as Map;
    expect(event['stack'], {
      'ruleVersion': 1,
      'fingerprint': 'fixture-stack-1',
      'groupId': 'stack-v1-1001-1004'
    });
    expect(event.containsKey('mediaIds'), isFalse);
  });

  test('initial collapse uses the H5 one-quarter threshold', () {
    expect(c.displayed, hasLength(10));
    c.initialCount = 48;
    expect(c.canCollapse, isFalse);
    expect(c.displayed, hasLength(60));
    c.initialCount = 47;
    expect(c.canCollapse, isTrue);
  });

  test(
      'bookmark and like writes serialize per media and remain independent of rating',
      () async {
    final slow = SlowMarksApi();
    final subject = ArtworkDetailController(slow, 1);
    await subject.load();
    final bookmark = subject.setMark(1001, 'bookmark', true);
    final like = subject.setMark(1001, 'like', true);
    final unbookmark = subject.setMark(1001, 'bookmark', false);
    await Future<void>.delayed(Duration.zero);
    expect(slow.writes, ['bookmark:true']);
    expect(subject.markValue(1001, 'bookmark'), isFalse);
    expect(subject.markValue(1001, 'like'), isTrue);
    slow.first.complete();
    await Future.wait([bookmark, like, unbookmark]);
    expect(slow.writes, ['bookmark:true', 'like:true', 'bookmark:false']);
    expect(subject.marks[1001]!.bookmarked, isFalse);
    expect(subject.marks[1001]!.liked, isTrue);
    expect(subject.reader!.rating, isNull);
    subject.dispose();
    slow.close();
  });
}
