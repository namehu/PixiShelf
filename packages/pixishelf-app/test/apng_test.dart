import 'dart:typed_data';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:pixishelf_app/apng_decoder.dart';

void main() {
  test('APNG decodes actual frames and loops without retaining all frames',
      () async {
    final first = img.Image(width: 2, height: 2, numChannels: 4)
      ..frameDuration = 80;
    img.fill(first, color: img.ColorRgba8(255, 0, 0, 255));
    final second = img.Image(width: 2, height: 2, numChannels: 4)
      ..frameDuration = 120;
    img.fill(second, color: img.ColorRgba8(0, 0, 255, 255));
    first.addFrame(second);
    final decoder =
        await ApngDecoder.open(Uint8List.fromList(img.encodePng(first)));
    try {
      expect(decoder.frameCount, 2);
      final a = await decoder.next();
      final b = await decoder.next();
      final again = await decoder.next();
      expect(a.pixels.take(4), [255, 0, 0, 255]);
      expect(b.pixels.take(4), [0, 0, 255, 255]);
      expect(again.pixels, a.pixels);
      expect(a.duration.inMilliseconds, 80);
      expect(b.duration.inMilliseconds, 120);
    } finally {
      decoder.dispose();
    }
  });
  test('partial APNG frames apply previous, background, source and over',
      () async {
    final decoder = await ApngDecoder.open(partialAnimation());
    try {
      expect((await decoder.next()).pixels, [255, 0, 0, 255, 255, 0, 0, 255]);
      expect((await decoder.next()).pixels, [255, 0, 0, 255, 0, 0, 255, 255]);
      // Previous restores red. Transparent over must preserve its destination.
      expect((await decoder.next()).pixels, [255, 0, 0, 255, 255, 0, 0, 255]);
      // Background clears x=0, source transparent clears x=1.
      expect((await decoder.next()).pixels, [0, 0, 0, 0, 0, 0, 0, 0]);
      expect((await decoder.next()).pixels, [255, 0, 0, 255, 255, 0, 0, 255]);
    } finally {
      decoder.dispose();
    }
  });
  test('APNG default poster outside animation is never treated as frame zero',
      () async {
    final decoder =
        await ApngDecoder.open(partialAnimation(excludedPoster: true));
    try {
      expect((await decoder.next()).pixels, [255, 0, 0, 255, 255, 0, 0, 255]);
    } finally {
      decoder.dispose();
    }
  });
  test('malformed animation fails instead of hanging the UI', () async {
    await expectLater(
        ApngDecoder.open(Uint8List.fromList([1, 2, 3])), throwsStateError);
  });
}

List<int> u32(int v) => (ByteData(4)..setUint32(0, v)).buffer.asUint8List();
List<int> chunk(String name, List<int> payload) {
  final content = [...name.codeUnits, ...payload];
  var crc = 0xffffffff;
  for (final byte in content) {
    crc ^= byte;
    for (var i = 0; i < 8; i++) {
      crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320 : 0);
    }
  }
  return [...u32(payload.length), ...content, ...u32(crc ^ 0xffffffff)];
}

Uint8List partialAnimation({bool excludedPoster = false}) {
  final data = <int>[
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', [...u32(2), ...u32(1), 8, 6, 0, 0, 0]),
    ...chunk('acTL', [...u32(4), ...u32(0)])
  ];
  if (excludedPoster) {
    data.addAll(
        chunk('IDAT', ZLibCodec().encode([0, 0, 255, 0, 255, 0, 255, 0, 255])));
  }
  var sequence = 0;
  void frame(
      int width, int x, List<int> rgba, int dispose, int blend, bool first) {
    data.addAll(chunk('fcTL', [
      ...u32(sequence++),
      ...u32(width),
      ...u32(1),
      ...u32(x),
      ...u32(0),
      0,
      1,
      0,
      10,
      dispose,
      blend
    ]));
    final pixels = ZLibCodec().encode([0, ...rgba]);
    data.addAll(first
        ? chunk('IDAT', pixels)
        : chunk('fdAT', [...u32(sequence++), ...pixels]));
  }

  frame(2, 0, [255, 0, 0, 255, 255, 0, 0, 255], 0, 0, !excludedPoster);
  frame(1, 1, [0, 0, 255, 255], 2, 0, false);
  frame(1, 0, [0, 0, 0, 0], 1, 1, false);
  frame(1, 1, [0, 0, 0, 0], 0, 0, false);
  return Uint8List.fromList([...data, ...chunk('IEND', [])]);
}
