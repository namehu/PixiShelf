import 'dart:io';
import 'package:flutter/services.dart';

Future<void> setReaderSystemUi(bool hidden) async {
  if (Platform.isAndroid) {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    await const MethodChannel('app.pixishelf/window')
        .invokeMethod<void>('setImmersive', hidden);
  } else {
    await SystemChrome.setEnabledSystemUIMode(
        hidden ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);
  }
}
