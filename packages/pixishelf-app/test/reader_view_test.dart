import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/storage.dart';
import 'package:pixishelf_app/main.dart';
import 'package:pixishelf_app/reader_view.dart';
import 'package:pixishelf_app/media_canvas.dart';
import 'package:pixishelf_app/media_grid_sheet.dart';
import 'package:pixishelf_app/reader_progress.dart';

class GalleryFixture extends MobileApi {
  GalleryFixture()
      : super(const Session('https://fixture.invalid', 'synthetic', 'owner'));
  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    if (path == 'session') {
      return {
        'apiVersion': 1,
        'user': {'id': 'owner'}
      };
    }
    if (path == 'feed') {
      return {
        'items': [
          {'id': 1, 'title': 'First artwork'},
          {'id': 2, 'title': 'Second artwork'}
        ],
        'nextPage': null,
        'nextCursor': null
      };
    }
    if (path == 'reading') return {'seenMediaIds': []};
    return {};
  }

  @override
  Future<ReaderData> reader(int id) async => ReaderData(
      id: id,
      title: id == 1 ? 'First artwork' : 'Second artwork',
      author: 'Fixture',
      fingerprint: '$id',
      revision: 1,
      media: [
        for (var i = 0; i < 2; i++)
          MediaItem(
              id: id * 10 + i,
              index: i,
              video: false,
              animated: false,
              members: [id * 10 + i])
      ],
      resumeId: null,
      rating: null,
      seen: {});
  @override
  Future<void> mediaPage(ReaderData reader, int page) async {
    for (final item in reader.media) {
      reader.sources[item.id] =
          MediaSource(item.id, false, '/preview', '/original');
    }
  }

  @override
  Future<Uint8List> media(String path, int revision) async =>
      Uint8List.fromList(img.encodePng(img.Image(width: 10, height: 10)));
}

Future<void> render(WidgetTester tester) async {
  // Image codecs complete on the engine thread, outside the fake test clock.
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
  }
  await tester.pump();
}

void main() {
  testWidgets(
      'visual frame readiness is distinct from the stable reading observation',
      (tester) async {
    final api = GalleryFixture();
    final data = await api.reader(1);
    await api.mediaPage(data, 0);
    var frames = 0, observations = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: MediaCanvas(
                api: api,
                reader: data,
                item: data.media.first,
                source: data.sources[data.media.first.id]!,
                active: true,
                highQuality: false,
                onFrameReady: () => frames++,
                onReady: () => observations++,
                onFailure: (error) => fail(error.message)))));
    for (var attempt = 0; attempt < 50 && frames == 0; attempt++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)));
      await tester.pump(const Duration(milliseconds: 10));
    }
    expect(frames, 1);
    expect(observations, 0);
    await tester.pump(const Duration(milliseconds: 140));
    expect(observations, 0);
    await tester.pump(const Duration(milliseconds: 60));
    expect(observations, 1);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
  testWidgets(
      'reader pages on separate axes, locks paging while zoomed, and hides its HUD',
      (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({
      'privacy-mode': false,
      'privacy-until':
          DateTime.now().add(const Duration(days: 1)).millisecondsSinceEpoch
    });
    final storage = AppStorage(await SharedPreferences.getInstance());
    final api = GalleryFixture();
    await tester.pumpWidget(ProviderScope(
        overrides: [storageProvider.overrideWithValue(storage)],
        child: MaterialApp(
            theme: AppTheme.light,
            home: ReaderView(
                api: api, onLogout: () async {}, onExpired: () async {}))));
    await render(tester);
    expect(find.text('First artwork'), findsOneWidget);
    expect(find.text('1 / 2'), findsOneWidget);
    expect(Theme.of(tester.element(find.text('First artwork'))).brightness,
        Brightness.dark);
    // Match H5: corner buttons, page badge and compact horizontal artwork actions.
    expect(find.text('沉浸浏览'), findsNothing);
    expect(find.byTooltip('设置'), findsNothing);
    expect(tester.widget<Text>(find.text('First artwork')).style?.fontSize, 14);
    final backRect = tester.getRect(find.byTooltip('返回'));
    final filterRect = tester.getRect(find.byTooltip('筛选'));
    expect(backRect.size, const Size(44, 44));
    expect(filterRect.size, const Size(44, 44));
    final initialBadge = tester.getRect(find.ancestor(
        of: find.text('1 / 2'), matching: find.byType(TextButton)));
    expect(initialBadge.top, greaterThanOrEqualTo(filterRect.bottom + 8));
    final likeRect = tester.getRect(find.byTooltip('喜欢作品'));
    final moreInitial = tester.getRect(find.byTooltip('更多操作'));
    expect(likeRect.center.dy, moreInitial.center.dy);
    expect(likeRect.size, const Size(44, 44));
    await tester.tap(find.byTooltip('更多操作'));
    await render(tester);
    await tester.tap(find.text('浏览设置'));
    await render(tester);
    expect(Theme.of(tester.element(find.text('浏览设置'))).brightness,
        Brightness.light);
    Navigator.of(tester.element(find.text('浏览设置'))).pop();
    await render(tester);
    // The scrubber must not intercept the lower edge of the adjacent actions.
    final moreRect = tester.getRect(find.byTooltip('更多操作'));
    final progressRect = tester.getRect(find.byType(ReaderProgress));
    expect(moreRect.bottom, lessThanOrEqualTo(progressRect.top - 8));
    await tester.tapAt(Offset(moreRect.center.dx, moreRect.bottom - 2));
    await render(tester);
    expect(find.text('作品评分'), findsOneWidget);
    Navigator.of(tester.element(find.text('作品评分'))).pop();
    await render(tester);
    final pickerButton = find.ancestor(
        of: find.text('1 / 2'), matching: find.byType(TextButton));
    final pickerRect = tester.getRect(pickerButton);
    await tester.tapAt(Offset(pickerRect.center.dx, pickerRect.bottom - 2));
    await render(tester);
    expect(find.byType(MediaGridSheet), findsOneWidget);
    Navigator.of(tester.element(find.byType(MediaGridSheet))).pop();
    await render(tester);
    expect(find.text('1 / 2'), findsOneWidget);
    await tester.dragFrom(const Offset(200, 400), const Offset(-100, 0));
    await render(tester);
    expect(find.text('2 / 2'), findsOneWidget);
    expect(find.text('First artwork'), findsOneWidget);
    await tester.dragFrom(const Offset(200, 400), const Offset(0, -100));
    await render(tester);
    expect(find.text('Second artwork'), findsOneWidget);
    expect(find.text('1 / 2'), findsOneWidget);
    await tester.tapAt(const Offset(200, 400));
    await tester.pump(const Duration(milliseconds: 80));
    await tester.tapAt(const Offset(200, 400));
    await render(tester);
    await tester.dragFrom(const Offset(200, 400), const Offset(0, 100));
    await render(tester);
    expect(find.text('Second artwork'), findsOneWidget);
    await tester.tapAt(const Offset(200, 400));
    await render(tester);
    expect(find.text('Second artwork'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}
