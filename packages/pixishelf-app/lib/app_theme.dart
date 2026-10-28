import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class AppTheme {
  static const canvas = Color(0xffffffff);
  static const blue = Color(0xff006fbe);
  static const ink = Color(0xff333333);
  static const muted = Color(0xff66727d);
  static const lightBars = SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    statusBarBrightness: Brightness.light,
    systemNavigationBarColor: canvas,
    systemNavigationBarIconBrightness: Brightness.dark,
    systemNavigationBarDividerColor: Colors.transparent,
  );
  static const mediaBars = SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    statusBarBrightness: Brightness.dark,
    systemNavigationBarColor: Colors.black,
    systemNavigationBarIconBrightness: Brightness.light,
    systemNavigationBarDividerColor: Colors.transparent,
  );

  static final light = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: canvas,
    colorScheme: ColorScheme.fromSeed(seedColor: blue).copyWith(
      primary: blue,
      onPrimary: Colors.white,
      surface: canvas,
      onSurface: ink,
      onSurfaceVariant: muted,
      surfaceContainerHighest: const Color(0xfff4f7f9),
      outline: const Color(0xffd4dce2),
      outlineVariant: const Color(0xffe4e9ed),
      error: const Color(0xffc8323c),
    ),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
          fontSize: 30,
          height: 1.3,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.5),
      titleLarge:
          TextStyle(fontSize: 22, height: 1.35, fontWeight: FontWeight.w600),
      titleMedium:
          TextStyle(fontSize: 16, height: 1.45, fontWeight: FontWeight.w600),
      bodyLarge: TextStyle(fontSize: 16, height: 1.5),
      bodyMedium: TextStyle(fontSize: 14, height: 1.5),
      bodySmall: TextStyle(fontSize: 12, height: 1.5),
      labelLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    ).apply(bodyColor: ink, displayColor: ink),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      hintStyle: const TextStyle(color: muted, fontSize: 15),
      labelStyle: const TextStyle(color: muted),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xffbdc8cf))),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: blue, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
      minimumSize: const Size(48, 56),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    )),
    outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 56),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)))),
    iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(48, 48))),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: canvas,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: Color(0xffbdc8cf),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    dialogTheme: DialogTheme(
      backgroundColor: canvas,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );

  // Media controls keep their own contrast; sheets use the app's light theme.
  static final media = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: Colors.black,
    colorScheme: ColorScheme.fromSeed(
            seedColor: blue, brightness: Brightness.dark)
        .copyWith(primary: const Color(0xff9bd1ff), onSurface: Colors.white),
    iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
            foregroundColor: Colors.white, minimumSize: const Size(48, 48))),
    sliderTheme: const SliderThemeData(
        trackHeight: 2,
        thumbShape: RoundSliderThumbShape(enabledThumbRadius: 6)),
  );
}
