import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

// Explicit profile builds emit only frame timings, never media or account data.
void startFrameMetrics() {
  if (!kProfileMode || !const bool.fromEnvironment('PIXISHELF_FRAME_METRICS')) {
    return;
  }
  final frames = <FrameTiming>[];
  SchedulerBinding.instance.addTimingsCallback((batch) {
    frames.addAll(batch);
    if (frames.length > 600) frames.removeRange(0, frames.length - 600);
  });
  Timer.periodic(const Duration(seconds: 5), (_) {
    if (frames.isEmpty) return;
    final sample = List<FrameTiming>.of(frames);
    frames.clear();
    final build = sample.map((f) => f.buildDuration.inMicroseconds).toList()
      ..sort();
    final raster = sample.map((f) => f.rasterDuration.inMicroseconds).toList()
      ..sort();
    final views = PlatformDispatcher.instance.views;
    final reportedHz = views.isEmpty ? 60.0 : views.first.display.refreshRate;
    final refreshHz = reportedHz > 0 ? reportedHz : 60.0;
    final budgetUs = 1000000 / refreshHz;
    double p95(List<int> values) =>
        values[(values.length * .95).ceil() - 1] / 1000;
    debugPrint('PIXISHELF_FRAMES ${jsonEncode({
          'frames': sample.length,
          'refreshHz': refreshHz,
          'uiP95Ms': p95(build),
          'rasterP95Ms': p95(raster),
          'overBudget': sample
              .where((f) =>
                  f.buildDuration.inMicroseconds > budgetUs ||
                  f.rasterDuration.inMicroseconds > budgetUs)
              .length,
          'over16_7Ms': sample
              .where((f) =>
                  f.buildDuration.inMicroseconds > 16667 ||
                  f.rasterDuration.inMicroseconds > 16667)
              .length,
          'over33_3Ms': sample
              .where((f) =>
                  f.buildDuration.inMicroseconds > 33333 ||
                  f.rasterDuration.inMicroseconds > 33333)
              .length,
        })}');
  });
}
