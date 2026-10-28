import 'dart:async';
import 'dart:math';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'api.dart';
import 'models.dart';
import 'apng_decoder.dart';

class MediaCanvas extends StatefulWidget {
  final MobileApi api;
  final ReaderData reader;
  final MediaItem item;
  final MediaSource source;
  final bool active, highQuality;
  final VoidCallback onReady;
  final VoidCallback? onFrameReady;
  final ValueChanged<ApiFailure> onFailure;
  final ValueChanged<bool>? onCycleMode;
  final VoidCallback? onCycleComplete;
  const MediaCanvas(
      {super.key,
      required this.api,
      required this.reader,
      required this.item,
      required this.source,
      required this.active,
      required this.highQuality,
      required this.onReady,
      this.onFrameReady,
      required this.onFailure,
      this.onCycleMode,
      this.onCycleComplete});
  @override
  State<MediaCanvas> createState() => MediaCanvasState();
}

class MediaCanvasState extends State<MediaCanvas> {
  ui.Codec? _codec;
  ApngDecoder? _apng;
  ui.Image? _image;
  Timer? _timer, _readyTimer, _cycleTimer;
  String? _error;
  bool _decoding = false;
  int _epoch = 0;
  int _framesShown = 0;
  bool _webpCycle = false;
  bool _announcedFrame = false;

  /// Shares the displayed pixels without decoding or capturing the render tree.
  /// The caller owns this handle and must dispose it after its last painted frame.
  ui.Image? retainImage() => mounted && _error == null ? _image?.clone() : null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(MediaCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.id != widget.item.id ||
        oldWidget.reader.revision != widget.reader.revision ||
        (oldWidget.highQuality != widget.highQuality &&
            !widget.item.animated &&
            !widget.source.apng)) {
      _load();
      return;
    }
    if (!widget.active) {
      _timer?.cancel();
      _readyTimer?.cancel();
      _cycleTimer?.cancel();
    } else if (!oldWidget.active) {
      _schedule();
      _notifyReady();
    }
  }

  Future<void> _load() async {
    final epoch = ++_epoch;
    _timer?.cancel();
    _readyTimer?.cancel();
    _cycleTimer?.cancel();
    _codec?.dispose();
    _codec = null;
    _apng?.dispose();
    _apng = null;
    _error = null;
    _decoding = false;
    _framesShown = 0;
    _announcedFrame = false;
    try {
      final original =
          widget.source.apng || widget.item.animated || widget.highQuality;
      final bytes = await widget.api.media(
          original ? widget.source.original : widget.source.preview,
          widget.reader.revision);
      if (!mounted || epoch != _epoch) return;
      _webpCycle = bytes.length > 12 &&
          bytes[0] == 82 &&
          bytes[1] == 73 &&
          bytes[2] == 70 &&
          bytes[3] == 70 &&
          bytes[8] == 87 &&
          bytes[9] == 69 &&
          bytes[10] == 66 &&
          bytes[11] == 80 &&
          widget.item.animated;
      widget.onCycleMode?.call(_webpCycle);
      if (widget.source.apng || ApngDecoder.isAnimatedPng(bytes)) {
        final apng = await ApngDecoder.open(bytes);
        if (!mounted || epoch != _epoch) {
          apng.dispose();
          return;
        }
        _apng = apng;
        await _frame(epoch);
        return;
      }
      final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
      final limit = widget.highQuality && !widget.item.animated ? 4096 : 2048;
      // The engine still needs the descriptor during asynchronous frame decode.
      // Let Flutter own it instead of disposing it before getNextFrame finishes.
      final codec = await ui.instantiateImageCodecWithSize(buffer,
          getTargetSize: (width, height) {
        final ratio = min(1.0,
            min(limit / max(width, height), sqrt(16000000 / (width * height))));
        return ui.TargetImageSize(
            width: max(1, (width * ratio).round()),
            height: max(1, (height * ratio).round()));
      });
      if (!mounted || epoch != _epoch) {
        codec.dispose();
        return;
      }
      _codec = codec;
      await _frame(epoch);
    } catch (e) {
      if (!mounted || epoch != _epoch) return;
      final failure = e is ApiFailure ? e : const ApiFailure('DECODE_FAILED');
      setState(() => _error = failure.message);
      widget.onFailure(failure);
    }
  }

  Future<void> _frame(int epoch) async {
    if (_decoding || (_codec == null && _apng == null)) return;
    _decoding = true;
    try {
      ui.Image frameImage;
      Duration duration;
      if (_apng != null) {
        final frame = await _apng!.next();
        final completer = Completer<ui.Image>();
        ui.decodeImageFromPixels(frame.pixels, frame.width, frame.height,
            ui.PixelFormat.rgba8888, completer.complete);
        frameImage = await completer.future;
        duration = frame.duration;
      } else {
        final frame = await _codec!.getNextFrame();
        frameImage = frame.image;
        duration = frame.duration;
      }
      if (!mounted || epoch != _epoch) {
        frameImage.dispose();
        return;
      }
      final previous = _image;
      setState(() {
        _image = frameImage;
        _error = null;
      });
      // The old frame can still be referenced by the render tree until this frame ends.
      WidgetsBinding.instance.addPostFrameCallback((_) => previous?.dispose());
      if (!_announcedFrame) {
        _announcedFrame = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && epoch == _epoch && widget.active) {
            widget.onFrameReady?.call();
          }
        });
      }
      _notifyReady();
      _framesShown++;
      if (_webpCycle &&
          (_codec?.frameCount ?? 0) > 1 &&
          _framesShown % _codec!.frameCount == 0) {
        // Wait for this final frame's duration before reporting a displayed loop.
        final cycleEpoch = _epoch;
        _cycleTimer?.cancel();
        _cycleTimer = Timer(duration, () {
          if (mounted && cycleEpoch == _epoch && widget.active) {
            widget.onCycleComplete?.call();
          }
        });
      }
      _schedule(duration);
    } catch (_) {
      if (mounted && epoch == _epoch) {
        setState(() => _error = '图片解码失败，请重试');
        widget.onFailure(const ApiFailure('DECODE_FAILED'));
      }
    } finally {
      if (epoch == _epoch) _decoding = false;
    }
  }

  void _notifyReady() {
    if (_image == null || !widget.active || _readyTimer?.isActive == true) {
      return;
    }
    final epoch = _epoch;
    _readyTimer = Timer(const Duration(milliseconds: 180), () {
      if (mounted && epoch == _epoch && widget.active) widget.onReady();
    });
  }

  void _schedule([Duration duration = const Duration(milliseconds: 100)]) {
    _timer?.cancel();
    if (!widget.active || (_apng?.frameCount ?? _codec?.frameCount ?? 0) < 2) {
      return;
    }
    final epoch = _epoch;
    _timer = Timer(
        duration < const Duration(milliseconds: 16)
            ? const Duration(milliseconds: 16)
            : duration,
        () => _frame(epoch));
  }

  @override
  void dispose() {
    ++_epoch;
    _timer?.cancel();
    _readyTimer?.cancel();
    _cycleTimer?.cancel();
    _codec?.dispose();
    _apng?.dispose();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.broken_image_outlined, size: 32),
        const SizedBox(height: 12),
        Text(_error!),
        TextButton(onPressed: _load, child: const Text('重试')),
      ]));
    }
    if (_image == null) {
      return const Center(
          child: SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2)));
    }
    return RawImage(
        image: _image,
        fit: BoxFit.contain,
        filterQuality: FilterQuality.medium);
  }
}
