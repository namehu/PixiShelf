import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/artwork_detail_view.dart';
import 'package:pixishelf_app/gallery_view.dart';
import 'package:pixishelf_app/main.dart';
import 'package:pixishelf_app/media_grid_sheet.dart';
import 'package:pixishelf_app/reader_view.dart';
import 'package:pixishelf_app/storage.dart';
import '../test/fixtures/gallery_api.dart';

Future<void> waitForReaderPage(WidgetTester tester, int page,
    {int? artworkId}) async {
  final deadline = DateTime.now().add(const Duration(seconds: 4));
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 50));
    final state = tester.state<ReaderViewState>(find.byType(ReaderView));
    final c = state.debugController;
    if (c.mediaIndex == page - 1 &&
        (artworkId == null || c.current?.id == artworkId) &&
        c.ready &&
        !state.debugTransitionBusy) {
      expect(find.text('$page / 60'), findsOneWidget);
      return;
    }
  }
  final state = tester.state<ReaderViewState>(find.byType(ReaderView));
  final c = state.debugController;
  fail('Reader page $page did not become ready: current=${c.mediaIndex + 1}, '
      'ready=${c.ready}, busy=${state.debugTransitionBusy}, error=${c.error}');
}

Future<void> waitForDetailMedia(WidgetTester tester, int mediaId) async {
  final deadline = DateTime.now().add(const Duration(seconds: 4));
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 50));
    final state =
        tester.state<ArtworkDetailViewState>(find.byType(ArtworkDetailView));
    final frame = find.descendant(
        of: find.byKey(ValueKey('detail-image-$mediaId')),
        matching: find.byType(RawImage));
    if (frame.evaluate().isNotEmpty &&
        tester.widget<RawImage>(frame).image != null &&
        state.debugController.isReady(mediaId)) {
      return;
    }
  }
  final state =
      tester.state<ArtworkDetailViewState>(find.byType(ArtworkDetailView));
  fail(
      'Detail media $mediaId did not render: current=${state.debugCurrentMediaId}, '
      'ready=${state.debugController.isReady(mediaId)}, error=${state.debugController.error}, '
      'notice=${state.debugController.notice}');
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
      'native gallery detail and same-work preview preserve both return positions',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'privacy-mode': false,
      'privacy-until':
          DateTime.now().add(const Duration(days: 1)).millisecondsSinceEpoch
    });
    final storage = AppStorage(await SharedPreferences.getInstance());
    final api = GalleryApiFixture();
    await tester.pumpWidget(ProviderScope(
        overrides: [storageProvider.overrideWithValue(storage)],
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light,
            builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
                value: AppTheme.lightBars, child: child!),
            home: GalleryView(
                api: api,
                storage: storage,
                onLogout: () async {},
                onExpired: () async {}))));
    await tester.pumpAndSettle(const Duration(milliseconds: 200));
    expect(find.text('作品'), findsOneWidget);
    expect(api.reports, isEmpty);
    await binding.convertFlutterSurfaceToImage();
    await tester.pump();
    for (var frame = 0; frame < 20; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    await binding.takeScreenshot('gallery-home');
    await tester.tap(find.byKey(const ValueKey('artwork-1')));
    await waitForReaderPage(tester, 1, artworkId: 1);
    expect(find.byType(ArtworkDetailView), findsNothing);
    await tester.dragFrom(
        tester.getCenter(find.byType(ReaderView)), const Offset(0, -180));
    await waitForReaderPage(tester, 1, artworkId: 2);
    await binding.takeScreenshot('gallery-cover-next-artwork');
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('筛选作品'));
    await tester.pumpAndSettle();
    for (var frame = 0; frame < 20; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    await binding.takeScreenshot('gallery-filters');
    await tester.tap(find.byTooltip('关闭筛选'));
    await tester.pumpAndSettle();
    final galleryScroll = tester
        .widget<CustomScrollView>(find.byType(CustomScrollView))
        .controller!;
    galleryScroll.jumpTo(500);
    await tester.pumpAndSettle();
    final originalOffset = galleryScroll.offset;
    await tester.tap(find.byKey(const ValueKey('artwork-detail-5')));
    await tester.pumpAndSettle();
    expect(find.byType(ArtworkDetailView), findsOneWidget);
    expect(find.byType(ReaderView), findsNothing);
    await waitForDetailMedia(tester, 5001);
    await binding.takeScreenshot('detail-header');
    expect(find.text('1 / 60'), findsOneWidget);
    await tester.tap(find.text('1 / 60'));
    await tester.pumpAndSettle();
    for (var frame = 0; frame < 20; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    await binding.takeScreenshot('gallery-media-picker');
    final picker = find
        .descendant(
            of: find.byType(MediaGridSheet), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('media-pick-5031')), 400,
        scrollable: picker);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('media-pick-5031')));
    await tester.pumpAndSettle();
    expect(find.text('31 / 60'), findsOneWidget);
    await waitForDetailMedia(tester, 5031);
    await binding.takeScreenshot('detail-page-31');
    await tester.tap(find.byKey(const ValueKey('detail-preview-5031')));
    await tester.pumpAndSettle();
    expect(find.byType(ReaderView), findsOneWidget);
    await waitForReaderPage(tester, 31);
    final center = tester.getCenter(find.byType(ReaderView));
    for (var turn = 0; turn < 3; turn++) {
      await tester.dragFrom(center, const Offset(-160, 0));
      await waitForReaderPage(tester, 32 + turn);
    }
    expect(find.text('34 / 60'), findsOneWidget);
    await binding.takeScreenshot('reader-page-34');
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    expect(find.byType(ReaderView), findsNothing);
    expect(find.byType(ArtworkDetailView), findsOneWidget);
    expect(find.text('34 / 60'), findsOneWidget);
    await waitForDetailMedia(tester, 5034);
    await binding.takeScreenshot('detail-return-page-34');
    await tester.tap(find.byTooltip('返回作品列表'));
    await tester.pumpAndSettle();
    expect(find.byType(ArtworkDetailView), findsNothing);
    expect(galleryScroll.offset, originalOffset);
    expect(api.closed, isFalse);
    expect(api.queries.length, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
}
