import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/artwork_detail_view.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:pixishelf_app/gallery_view.dart';
import 'package:pixishelf_app/gallery_filters.dart';
import 'package:pixishelf_app/media_grid_sheet.dart';
import 'package:pixishelf_app/main.dart';
import 'package:pixishelf_app/reader_view.dart';
import 'package:pixishelf_app/storage.dart';
import 'fixtures/gallery_api.dart';

class MinimalGalleryApiFixture extends GalleryApiFixture {
  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    final response =
        await super.request(path, method: method, query: query, body: body);
    if (path == 'session') {
      response['galleryPreferences'] = {
        'displayMode': 'minimal',
        'showReadingStatus': false,
      };
    }
    return response;
  }
}

Future<void> renderGallery(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
  }
}

Future<void> mountGallery(WidgetTester tester, GalleryApiFixture api,
    {bool confirmed = true,
    Size size = const Size(400, 800),
    double textScale = 1}) async {
  VisibilityDetectorController.instance.updateInterval = Duration.zero;
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetViewInsets);
  SharedPreferences.setMockInitialValues(confirmed
      ? {
          'privacy-mode': false,
          'privacy-until':
              DateTime.now().add(const Duration(days: 1)).millisecondsSinceEpoch
        }
      : {});
  final storage = AppStorage(await SharedPreferences.getInstance());
  await tester.pumpWidget(ProviderScope(
      overrides: [storageProvider.overrideWithValue(storage)],
      child: MaterialApp(
          theme: AppTheme.light,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!),
          home: GalleryView(
              api: api,
              storage: storage,
              onLogout: () async {},
              onExpired: () async {}))));
  await renderGallery(tester);
}

void main() {
  testWidgets(
      'compact H5 gallery cover enters cross-artwork browsing; title remains the detail entry',
      (tester) async {
    final api = GalleryApiFixture();
    await mountGallery(tester, api);
    expect(find.byType(AppBar), findsNothing);
    expect(tester.getSize(find.byKey(const ValueKey('gallery-toolbar'))).height,
        56);
    final cover = tester.getSize(find.byKey(const ValueKey('artwork-1')));
    expect(cover.width / cover.height, closeTo(3 / 4, .001));
    await tester.tap(find.byKey(const ValueKey('artwork-1')));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsOneWidget);
    expect(find.byType(ArtworkDetailView), findsNothing);
    final state = tester.state<ReaderViewState>(find.byType(ReaderView));
    expect(state.debugController.current!.id, 1);
    await tester.dragFrom(const Offset(200, 360), const Offset(0, -160));
    await renderGallery(tester);
    await renderGallery(tester);
    expect(state.debugController.current!.id, 2);
    await tester.tap(find.byTooltip('返回'));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsNothing);
    expect(find.text('继续上次浏览'), findsNothing);
    await tester.tap(find.text('更多'));
    await renderGallery(tester);
    expect(find.text('图库设置'), findsOneWidget);
    expect(find.text('继续上次浏览'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
  testWidgets('server minimal preference renders a compact cover-only gallery',
      (tester) async {
    final api = MinimalGalleryApiFixture();
    await mountGallery(tester, api);
    expect(find.byKey(const ValueKey('artwork-detail-1')), findsNothing);
    expect(find.text('测试艺术家'), findsNothing);
    final first = tester.getRect(find.byKey(const ValueKey('artwork-1')));
    final second = tester.getRect(find.byKey(const ValueKey('artwork-2')));
    final nextRow = tester.getRect(find.byKey(const ValueKey('artwork-3')));
    expect(second.left - first.right, 2);
    expect(nextRow.top - first.bottom, closeTo(2, .001));
    await tester.tap(find.byKey(const ValueKey('artwork-1')));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsOneWidget);
    expect(tester.widget<ReaderView>(find.byType(ReaderView)).sameWorkOnly,
        isFalse);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
  for (final original in [false, true]) {
    testWidgets(
        '${original ? 'original' : 'adaptive'} preview opened from a stack never inherits group reading credit',
        (tester) async {
      final api = GalleryApiFixture();
      await mountGallery(tester, api);
      await tester.tap(find.byKey(const ValueKey('artwork-detail-1')));
      await renderGallery(tester);
      await tester.tap(find.byTooltip('切换堆叠浏览'));
      await renderGallery(tester);
      await renderGallery(tester);
      await tester.longPress(find.byKey(const ValueKey('detail-preview-1001')));
      await renderGallery(tester);
      await tester.tap(find.text(original ? '查看原始文件' : '适配预览'));
      await renderGallery(tester);
      await renderGallery(tester);
      final reader = tester.widget<ReaderView>(find.byType(ReaderView));
      expect(reader.initialHighQuality, original);
      api.reports.clear();
      final state = tester.state<ReaderViewState>(find.byType(ReaderView));
      await state.debugController.flush();
      expect(api.reports, isNotEmpty);
      expect(
          api.reports
              .expand((report) => report['events'] as List)
              .every((event) => !(event as Map).containsKey('stack')),
          isTrue);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      api.close();
    });
  }
  testWidgets(
      'gallery to detail to page 31 preview and back preserves media anchor and gallery position',
      (tester) async {
    final api = GalleryApiFixture();
    await mountGallery(tester, api);
    await tester.pump(const Duration(seconds: 4));
    expect(api.reports, isEmpty);
    expect(api.imageRequests.every((v) => v.contains('variant=thumbnail')),
        isTrue);
    final scroll = tester
        .widget<CustomScrollView>(find.byType(CustomScrollView))
        .controller!;
    scroll.jumpTo(500);
    await renderGallery(tester);
    final offset = scroll.offset;
    await tester.tap(find.byKey(const ValueKey('artwork-detail-5')));
    await renderGallery(tester);
    expect(find.byType(ArtworkDetailView), findsOneWidget);
    expect(find.byType(ReaderView), findsNothing);
    await tester.pump(const Duration(seconds: 4));
    api.reports.clear();
    await tester.tap(find.text('1 / 60'));
    await renderGallery(tester);
    expect(find.byType(MediaGridSheet), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    expect(api.reports, isEmpty);
    final picker = find
        .descendant(
            of: find.byType(MediaGridSheet), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('media-pick-5031')), 400,
        scrollable: picker);
    await renderGallery(tester);
    await tester.tap(find.byKey(const ValueKey('media-pick-5031')));
    await renderGallery(tester);
    await renderGallery(tester);
    expect(find.text('31 / 60'), findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((v) => v.data)
            .join(' | '));
    expect(api.mediaPages, contains(1));
    await tester.tap(find.byKey(const ValueKey('detail-preview-5031')));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsOneWidget);
    for (var turn = 0; turn < 3; turn++) {
      await tester.dragFrom(const Offset(200, 360), const Offset(-140, 0));
      await renderGallery(tester);
    }
    expect(find.text('34 / 60'), findsOneWidget);
    final calls = api.queries.length;
    await tester.tap(find.byTooltip('返回'));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsNothing);
    expect(find.byType(ArtworkDetailView), findsOneWidget);
    expect(find.text('34 / 60'), findsOneWidget);
    await tester.tap(find.byTooltip('返回作品列表'));
    await renderGallery(tester);
    expect(scroll.offset, offset);
    expect(api.queries.length, calls);
    expect(api.closed, isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
  testWidgets(
      'filter drafts cancel without changing the feed, while apply uses the same H5 terms',
      (tester) async {
    final api = GalleryApiFixture();
    await mountGallery(tester, api);
    final before = api.queries.length;
    await tester.tap(find.byTooltip('筛选作品'));
    await renderGallery(tester);
    await tester.tap(find.text('仅视频'));
    await tester.pump();
    await tester.tap(find.byTooltip('关闭筛选'));
    await renderGallery(tester);
    expect(api.queries.length, before);
    await tester.tap(find.byTooltip('筛选作品'));
    await renderGallery(tester);
    expect(
        tester
            .widget<ChoiceChip>(find.ancestor(
                of: find.text('全部类型'), matching: find.byType(ChoiceChip)))
            .selected,
        isTrue);
    await tester.tap(find.text('仅视频'));
    await tester.pump();
    await tester.tap(find.text('应用筛选'));
    await renderGallery(tester);
    expect(find.byType(GalleryFilters), findsNothing);
    expect(api.queries.last['mediaType'], 'video');
    expect(api.queries.last['sortBy'], 'source_date_desc');
    expect(api.reports, isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
  testWidgets('gallery stays behind the content confirmation', (tester) async {
    final api = GalleryApiFixture();
    await mountGallery(tester, api, confirmed: false);
    expect(find.text('进入个人图库'), findsOneWidget);
    expect(api.queries, isEmpty);
    expect(api.imageRequests, isEmpty);
    await tester.tap(find.text('隐私模式进入'));
    await renderGallery(tester);
    expect(find.text('内容已遮蔽'), findsWidgets);
    expect(find.text('作品 1'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
  testWidgets(
      'gallery and filter actions fit a narrow phone with large text and keyboard',
      (tester) async {
    final api = GalleryApiFixture();
    await mountGallery(tester, api, size: const Size(320, 640), textScale: 1.3);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('筛选作品'));
    await renderGallery(tester);
    final field = find.descendant(
        of: find.byType(GalleryFilters), matching: find.byType(TextField));
    await tester.enterText(field, '测试关键词');
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('应用筛选'));
    await renderGallery(tester);
    expect(api.queries.last['search'], '测试关键词');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
}
