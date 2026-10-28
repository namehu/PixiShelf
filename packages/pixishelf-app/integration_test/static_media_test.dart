import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:image/image.dart' as img;
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/media_canvas.dart';

class StaticImageAdapter implements HttpClientAdapter {
  final Uint8List bytes;
  StaticImageAdapter(this.bytes);
  @override
  Future<ResponseBody> fetch(RequestOptions options,
          Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async =>
      ResponseBody.fromBytes(bytes, 200);
  @override
  void close({bool force = false}) {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native static media survives first fetch, zoom and replacement',
      (tester) async {
    final pixels = img.Image(width: 600, height: 800);
    img.fill(pixels, color: img.ColorRgb8(0, 111, 190));
    // Generated solid-color WebP, matching the server preview format.
    final webp = base64Decode(
        'UklGRq4DAABXRUJQVlA4IKIDAAAwagCdASpYAiADPlEokkcjoqGhIAgAcAoJaW7hd2Ee3AfgB+AAABaW'
        'ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2Tk'
        'PfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77'
        'ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJy'
        'Hvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99'
        'snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5'
        'D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+'
        '2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32yc'
        'h77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPf'
        'bJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZO'
        'Q99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHv'
        'tk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99sn'
        'Ie+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D3'
        '2ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2T'
        'kPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych6wAA/v+21D//+k0ap+PtLf//1lV8lR+2'
        'YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    for (final bytes in [img.encodeJpg(pixels), img.encodePng(pixels), webp]) {
      final api = MobileApi(
          const Session('https://fixture.invalid', 'synthetic', 'owner'),
          client: Dio()
            ..httpClientAdapter =
                StaticImageAdapter(Uint8List.fromList(bytes)));
      final data = ReaderData(
          id: 1,
          title: 'Fixture',
          author: '',
          fingerprint: 'fixture',
          revision: 1,
          media: [],
          resumeId: null,
          rating: null,
          seen: {});
      var id = 1, highQuality = false, ready = 0;
      late StateSetter update;
      await tester.pumpWidget(
          MaterialApp(home: StatefulBuilder(builder: (context, set) {
        update = set;
        return MediaCanvas(
            key: ValueKey(id),
            api: api,
            reader: data,
            item: MediaItem(
                id: id, index: 0, video: false, animated: false, members: [id]),
            source: MediaSource(
                id,
                false,
                '/api/mobile/v1/media/$id?variant=preview',
                '/api/mobile/v1/media/$id?variant=original'),
            active: true,
            highQuality: highQuality,
            onReady: () => ready++,
            onFailure: (e) => fail(e.message));
      })));
      Future<void> displayed() async {
        for (var i = 0;
            i < 80 && find.byType(RawImage).evaluate().isEmpty;
            i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(find.byType(RawImage), findsOneWidget);
        final image = tester.widget<RawImage>(find.byType(RawImage)).image!;
        expect(image.width, 600);
        expect(image.height, 800);
        await tester.pump(const Duration(milliseconds: 250));
      }

      await displayed();
      expect(ready, greaterThan(0));
      update(() => highQuality = true);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await displayed();
      for (var next = 2; next <= 5; next++) {
        update(() {
          id = next;
          highQuality = false;
        });
        await tester.pump();
        await displayed();
      }
      await tester.pumpWidget(const SizedBox.shrink());
      api.close();
      expect(tester.takeException(), isNull);
    }
  });
}
