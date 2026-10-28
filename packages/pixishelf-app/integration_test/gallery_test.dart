import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/gallery_view.dart';
import 'package:pixishelf_app/main.dart';
import 'package:pixishelf_app/media_grid_sheet.dart';
import 'package:pixishelf_app/reader_view.dart';
import 'package:pixishelf_app/storage.dart';
import '../test/fixtures/gallery_api.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native gallery filters, thumbnail picker and return navigation',
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
    await tester.tap(find.byTooltip('筛选作品'));
    await tester.pumpAndSettle();
    for (var frame = 0; frame < 20; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    await binding.takeScreenshot('gallery-filters');
    await tester.tap(find.byTooltip('关闭筛选'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('artwork-1')));
    await tester.pumpAndSettle();
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
        find.byKey(const ValueKey('media-pick-1031')), 400,
        scrollable: picker);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('media-pick-1031')));
    await tester.pumpAndSettle();
    expect(find.text('31 / 60'), findsOneWidget);
    await tester.tap(find.byTooltip('返回'));
    await tester.pumpAndSettle();
    expect(find.byType(ReaderView), findsNothing);
    expect(api.closed, isFalse);
    expect(api.queries.length, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
}
