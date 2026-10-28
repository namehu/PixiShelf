import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/app_theme.dart';
import 'package:pixishelf_app/main.dart';

void main() {
  testWidgets(
      'login stays usable with large text and the keyboard on a narrow phone',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!),
      home: LoginView(
          onLogin: (_) async => fail('Invalid server must not log in')),
    ));
    expect(tester.takeException(), isNull);
    final password = find.byType(TextField).at(2);
    await tester.ensureVisible(password);
    await tester.enterText(password, 'synthetic-password');
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pump();
    await tester.ensureVisible(find.byTooltip('显示密码'));
    await tester.tap(find.byTooltip('显示密码'));
    await tester.pump();
    expect(tester.widget<TextField>(password).obscureText, isFalse);
    expect(tester.widget<TextField>(password).controller!.text,
        'synthetic-password');
    await tester.tap(find.byTooltip('隐藏密码'));
    await tester.pump();
    expect(tester.widget<TextField>(password).obscureText, isTrue);
    await tester.ensureVisible(find.byType(FilledButton));
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(find.text('请输入有效的 HTTPS 服务器地址'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
