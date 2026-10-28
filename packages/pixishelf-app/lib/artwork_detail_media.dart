import 'dart:async';
import 'dart:math';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'api.dart';
import 'app_theme.dart';
import 'artwork_detail_controller.dart';
import 'media_canvas.dart';
import 'models.dart';
import 'video_canvas.dart';

class ArtworkDetailMedia extends StatefulWidget {
  final ArtworkDetailController controller;
  final MediaItem item;
  final bool privacy, playbackActive;
  final VoidCallback onPreview, onActions, onReady;
  final ValueChanged<ApiFailure> onFailure;
  final ValueChanged<int>? onTurn;
  const ArtworkDetailMedia(
      {super.key,
      required this.controller,
      required this.item,
      required this.privacy,
      required this.playbackActive,
      required this.onPreview,
      required this.onActions,
      required this.onReady,
      required this.onFailure,
      this.onTurn});
  @override
  State<ArtworkDetailMedia> createState() => _ArtworkDetailMediaState();
}

class _ArtworkDetailMediaState extends State<ArtworkDetailMedia> {
  bool _inView = false, _enoughVisible = false;
  double _horizontalTravel = 0;
  void _visibility(VisibilityInfo info) {
    if (!mounted) return;
    final enough = info.visibleBounds.height >=
        min(info.size.height, MediaQuery.sizeOf(context).height - 160) * .5;
    final visible = info.visibleFraction > 0;
    widget.controller.setVisibility(widget.item.id, enough);
    if (_inView != visible || _enoughVisible != enough) {
      setState(() {
        _inView = visible;
        _enoughVisible = enough;
      });
    }
    if (visible &&
        widget.controller.reader?.sources[widget.item.id] == null &&
        !widget.controller.mediaErrors.containsKey(widget.item.index ~/ 24)) {
      unawaited(widget.controller.ensureMedia(widget.item));
    }
  }

  @override
  void didUpdateWidget(ArtworkDetailMedia old) {
    super.didUpdateWidget(old);
    if (old.item.id != widget.item.id) {
      old.controller.setVisibility(old.item.id, false);
      widget.controller.setVisibility(widget.item.id, _enoughVisible);
      if (_inView) unawaited(widget.controller.ensureMedia(widget.item));
    }
  }

  @override
  void dispose() {
    widget.controller.setVisibility(widget.item.id, false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item, controller = widget.controller;
    final data = controller.reader!;
    final source = data.sources[item.id];
    final pageError = controller.mediaErrors[item.index ~/ 24];
    final active = controller.canObserve &&
        _enoughVisible &&
        ((!item.video && !item.animated) || widget.playbackActive);
    final ratio = (item.width ?? 0) > 0 && (item.height ?? 0) > 0
        ? item.width! / item.height!
        : item.video
            ? 16 / 9
            : 3 / 4;
    Widget media = const Center(
        child: Icon(Icons.image_outlined, size: 32, color: AppTheme.muted));
    if (_inView) {
      if (pageError != null && source == null) {
        media = Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(pageError),
          TextButton(
              onPressed: () => controller.ensureMedia(item),
              child: const Text('重试')),
        ]));
      } else if (source == null) {
        media = const Center(
            child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2)));
      } else if (item.video) {
        media = Theme(
            data: AppTheme.media,
            child: VideoCanvas(
                key: ValueKey('detail-video-${item.id}'),
                api: controller.api,
                reader: data,
                source: source,
                active: active,
                hud: true,
                privacy: widget.privacy,
                controlsBottom: 0,
                onEnded: () => controller.videoEnded(item.id),
                onObservation: (position, duration, playing) => controller
                    .videoObservation(item.id, position, duration, playing),
                onFailure: (failure) {
                  widget.onFailure(failure);
                }));
      } else {
        media = MediaCanvas(
            key: ValueKey('detail-image-${item.id}'),
            api: controller.api,
            reader: data,
            item: item,
            source: source,
            active: active,
            highQuality: false,
            onReady: () {
              controller.mediaReady(item.id);
              widget.onReady();
            },
            onFailure: (failure) {
              widget.onFailure(failure);
            });
        if (widget.privacy) {
          media = ImageFiltered(
              imageFilter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
              child: media);
        }
      }
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      VisibilityDetector(
          key: ValueKey('detail-visible-${data.id}-${item.id}'),
          onVisibilityChanged: _visibility,
          child: AspectRatio(
              aspectRatio: ratio,
              child: Semantics(
                  button: true,
                  label: '预览第 ${item.index + 1} 张',
                  child: GestureDetector(
                      key: ValueKey('detail-preview-${item.id}'),
                      behavior: HitTestBehavior.opaque,
                      onTap: widget.onPreview,
                      onLongPress: widget.onActions,
                      onHorizontalDragStart: widget.onTurn == null
                          ? null
                          : (_) => _horizontalTravel = 0,
                      onHorizontalDragUpdate: widget.onTurn == null
                          ? null
                          : (details) => _horizontalTravel += details.delta.dx,
                      onHorizontalDragEnd: widget.onTurn == null
                          ? null
                          : (details) {
                              final velocity = details.primaryVelocity ?? 0;
                              if (_horizontalTravel.abs() >= 48 ||
                                  velocity.abs() > 500) {
                                widget.onTurn!((_horizontalTravel.abs() >= 48
                                            ? _horizontalTravel
                                            : velocity) <
                                        0
                                    ? 1
                                    : -1);
                              }
                            },
                      child: ColoredBox(
                          color: item.video
                              ? Colors.black
                              : Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHighest,
                          child: media))))),
    ]);
  }
}
