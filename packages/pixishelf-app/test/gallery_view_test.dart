import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/gallery_view.dart';
import 'package:pixishelf_app/gallery_filters.dart';
import 'package:pixishelf_app/media_grid_sheet.dart';
import 'package:pixishelf_app/main.dart';
import 'package:pixishelf_app/reader_view.dart';
import 'package:pixishelf_app/storage.dart';
import 'fixtures/gallery_api.dart';

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
          home: GalleryView(
              api: api,
              storage: storage,
              onLogout: () async {},
              onExpired: () async {}))));
  await renderGallery(tester);
}

void main() {
  testWidgets(
      'grid thumbnails do not count as reading; selecting a later media page returns to the same gallery position',
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
    await tester.tap(find.byKey(const ValueKey('artwork-5')));
    await renderGallery(tester);
    final c = ProviderScope.containerOf(tester.element(find.byType(ReaderView)))
        .read(readerProvider(api));
    expect(c.current!.id, 5);
    await c.flush();
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
    expect(find.text('31 / 60'), findsOneWidget);
    expect(c.mediaIndex, 30);
    expect(api.mediaPages, contains(1));
    final calls = api.queries.length;
    await tester.tap(find.byTooltip('返回'));
    await renderGallery(tester);
    expect(find.byType(ReaderView), findsNothing);
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
