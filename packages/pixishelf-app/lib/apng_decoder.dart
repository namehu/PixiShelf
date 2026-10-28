import 'dart:async';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';
import 'package:image/image.dart' as img;

/// One decoder per visible APNG. Only the canvas, disposal snapshot and current
/// frame are retained; decoding runs away from Flutter's UI isolate.
class ApngDecoder {
  final Isolate _isolate;
  final ReceivePort _port;
  final StreamIterator<dynamic> _messages;
  final SendPort _commands;
  final int frameCount;
  bool _disposed = false;
  ApngDecoder._(this._isolate, this._port, this._messages, this._commands,
      this.frameCount);
  static bool isAnimatedPng(Uint8List bytes) {
    if (bytes.length < 8 ||
        bytes[0] != 137 ||
        bytes[1] != 80 ||
        bytes[2] != 78 ||
        bytes[3] != 71) {
      return false;
    }
    final data = ByteData.sublistView(bytes);
    for (var offset = 8; offset + 12 <= bytes.length;) {
      final length = data.getUint32(offset);
      if (offset + length + 12 > bytes.length) return false;
      final type = String.fromCharCodes(bytes.sublist(offset + 4, offset + 8));
      if (type == 'acTL') return true;
      if (type == 'IDAT' || type == 'IEND') return false;
      offset += length + 12;
    }
    return false;
  }

  static Future<ApngDecoder> open(Uint8List bytes) async {
    if (bytes.length > 32 * 1024 * 1024) throw StateError('APNG_TOO_LARGE');
    final port = ReceivePort();
    final messages = StreamIterator<dynamic>(port);
    final isolate = await Isolate.spawn(_worker, port.sendPort);
    try {
      if (!await messages.moveNext().timeout(const Duration(seconds: 15))) {
        throw StateError('APNG_START_FAILED');
      }
      final commands = messages.current as SendPort;
      commands.send(TransferableTypedData.fromList([bytes]));
      if (!await messages.moveNext().timeout(const Duration(seconds: 15))) {
        throw StateError('APNG_START_FAILED');
      }
      final info = messages.current as Map;
      if (info['error'] != null) throw StateError('APNG_UNSUPPORTED');
      return ApngDecoder._(
          isolate, port, messages, commands, info['frames'] as int);
    } catch (_) {
      isolate.kill(priority: Isolate.immediate);
      port.close();
      await messages.cancel();
      rethrow;
    }
  }

  Future<ApngFrame> next() async {
    if (_disposed) throw StateError('disposed');
    _commands.send('next');
    if (!await _messages.moveNext().timeout(const Duration(seconds: 15))) {
      throw StateError('disposed');
    }
    final result = _messages.current as Map;
    if (result['error'] != null) throw StateError('APNG_DECODE_FAILED');
    return ApngFrame(
        (result['pixels'] as TransferableTypedData).materialize().asUint8List(),
        result['width'] as int,
        result['height'] as int,
        Duration(milliseconds: result['duration'] as int));
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _isolate.kill(priority: Isolate.immediate);
    _port.close();
  }
}

class ApngFrame {
  final Uint8List pixels;
  final int width, height;
  final Duration duration;
  ApngFrame(this.pixels, this.width, this.height, this.duration);
}

void _worker(SendPort parent) {
  final commands = ReceivePort();
  parent.send(commands.sendPort);
  img.PngDecoder? decoder;
  img.Image? canvas, snapshot;
  img.PngFrame? previous;
  Uint8List? separateFirstFrame;
  int index = 0;
  commands.listen((message) {
    try {
      if (message is TransferableTypedData) {
        decoder = img.PngDecoder();
        final bytes = message.materialize().asUint8List();
        final info = decoder!.startDecode(bytes);
        if (info == null ||
            info.width <= 0 ||
            info.height <= 0 ||
            info.width * info.height > 8000000 ||
            info.numFrames <= 0 ||
            info.numFrames > 10000) {
          throw StateError('limit');
        }
        canvas =
            img.Image(width: info.width, height: info.height, numChannels: 4);
        separateFirstFrame = _firstFrameWithoutPoster(bytes);
        parent.send({'frames': info.numFrames});
        return;
      }
      if (decoder == null || canvas == null) {
        throw StateError('not initialized');
      }
      final info = decoder!.info;
      if (index == 0) {
        canvas =
            img.Image(width: info.width, height: info.height, numChannels: 4);
        previous = null;
        snapshot = null;
      }
      if (previous != null) {
        if (previous!.dispose == img.PngDisposeMode.background) {
          img.fillRect(canvas!,
              x1: previous!.xOffset,
              y1: previous!.yOffset,
              x2: previous!.xOffset + previous!.width - 1,
              y2: previous!.yOffset + previous!.height - 1,
              color: img.ColorRgba8(0, 0, 0, 0),
              alphaBlend: false);
        } else if (previous!.dispose == img.PngDisposeMode.previous &&
            snapshot != null) {
          canvas = snapshot;
        }
      }
      final control = info.frames.isEmpty ? null : info.frames[index];
      if (control != null &&
          (control.xOffset + control.width > info.width ||
              control.yOffset + control.height > info.height)) {
        throw StateError('frame bounds');
      }
      snapshot = control?.dispose == img.PngDisposeMode.previous
          ? img.Image.from(canvas!)
          : null;
      final frame = index == 0 && separateFirstFrame != null
          ? img.decodePng(separateFirstFrame!)
          : decoder!.decodeFrame(index);
      if (frame == null) throw StateError('frame');
      img.compositeImage(canvas!, frame,
          dstX: control?.xOffset ?? 0,
          dstY: control?.yOffset ?? 0,
          blend: control?.blend == img.PngBlendMode.over
              ? img.BlendMode.alpha
              : img.BlendMode.direct);
      final ratio = min(1.0, 2048 / max(info.width, info.height));
      final displayed = ratio < 1
          ? img.copyResize(canvas!,
              width: max(1, (info.width * ratio).round()),
              height: max(1, (info.height * ratio).round()))
          : canvas!;
      final denominator =
          (control?.delayDen ?? 0) == 0 ? 100 : control!.delayDen;
      final milliseconds =
          max(16, (((control?.delayNum ?? 10) / denominator) * 1000).round());
      parent.send({
        'pixels': TransferableTypedData.fromList(
            [displayed.getBytes(order: img.ChannelOrder.rgba)]),
        'width': displayed.width,
        'height': displayed.height,
        'duration': milliseconds
      });
      previous = control;
      index = (index + 1) % info.numFrames;
    } catch (_) {
      parent.send({'error': true});
    }
  });
}

// APNG may have an IDAT poster that is not part of the animation. The image
// package treats IDAT as frame zero, so reconstruct that one frame from fdAT.
Uint8List? _firstFrameWithoutPoster(Uint8List bytes) {
  final view = ByteData.sublistView(bytes);
  var hadIdat = false, inFirst = false;
  List<int>? header;
  final metadata = <List<int>>[], imageData = <List<int>>[];
  for (var at = 8; at + 12 <= bytes.length;) {
    final size = view.getUint32(at);
    if (at + size + 12 > bytes.length) throw StateError('chunk bounds');
    final type = String.fromCharCodes(bytes.sublist(at + 4, at + 8));
    final payload = bytes.sublist(at + 8, at + 8 + size);
    if (type == 'IHDR') header = payload.toList();
    if (['PLTE', 'tRNS', 'gAMA'].contains(type)) {
      metadata.add(bytes.sublist(at, at + size + 12));
    }
    if (type == 'IDAT') hadIdat = true;
    if (type == 'fcTL') {
      if (!hadIdat) return null;
      if (inFirst) break;
      inFirst = true;
      header!.setRange(0, 8, payload.sublist(4, 12));
    }
    if (type == 'fdAT' && inFirst) {
      imageData.add(_pngChunk('IDAT', payload.sublist(4)));
    }
    at += size + 12;
  }
  if (!inFirst) return null;
  return Uint8List.fromList([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ..._pngChunk('IHDR', header!),
    ...metadata.expand((v) => v),
    ...imageData.expand((v) => v),
    ..._pngChunk('IEND', [])
  ]);
}

List<int> _pngChunk(String name, List<int> payload) {
  final content = [...name.codeUnits, ...payload];
  var crc = 0xffffffff;
  for (final byte in content) {
    crc ^= byte;
    for (var i = 0; i < 8; i++) {
      crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320 : 0);
    }
  }
  return [
    ...(ByteData(4)..setUint32(0, payload.length)).buffer.asUint8List(),
    ...content,
    ...(ByteData(4)..setUint32(0, crc ^ 0xffffffff)).buffer.asUint8List()
  ];
}
