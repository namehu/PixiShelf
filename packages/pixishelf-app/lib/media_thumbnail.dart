import 'dart:typed_data';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'api.dart';

/// Loads protected, static thumbnails without creating playback or reading events.
class MediaThumbnail extends StatefulWidget {
  final MobileApi api;
  final String? path;
  final int revision;
  final bool privacy, video;
  final ValueChanged<ApiFailure>? onFailure;
  const MediaThumbnail(
      {super.key,
      required this.api,
      required this.path,
      required this.revision,
      this.privacy = false,
      this.video = false,
      this.onFailure});
  @override
  State<MediaThumbnail> createState() => _MediaThumbnailState();
}

class _MediaThumbnailState extends State<MediaThumbnail> {
  Future<Uint8List?>? _bytes;
  int _epoch = 0;
  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final epoch = ++_epoch;
    final path = widget.path;
    _bytes = path == null
        ? Future.value(null)
        : widget.api
            .media(path, widget.revision)
            .then<Uint8List?>((v) => v)
            .catchError((Object e) {
            if (mounted && epoch == _epoch && e is ApiFailure) {
              widget.onFailure?.call(e);
            }
            throw e;
          });
  }

  @override
  void didUpdateWidget(MediaThumbnail old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path ||
        old.revision != widget.revision ||
        old.api != widget.api) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: ExcludeSemantics(
            child: FutureBuilder<Uint8List?>(
                future: _bytes,
                builder: (context, snapshot) {
                  if (snapshot.hasData) {
                    final image = Image.memory(snapshot.data!,
                        fit: BoxFit.cover,
                        width: double.infinity,
                        height: double.infinity,
                        cacheWidth: 512,
                        gaplessPlayback: true,
                        errorBuilder: (_, __, ___) => _placeholder(context));
                    return widget.privacy
                        ? ImageFiltered(
                            imageFilter:
                                ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                            child: image)
                        : image;
                  }
                  return _placeholder(context,
                      loading:
                          snapshot.connectionState == ConnectionState.waiting);
                })),
      );
  Widget _placeholder(BuildContext context, {bool loading = false}) => Center(
      child: Icon(
          loading
              ? Icons.image_outlined
              : widget.video
                  ? Icons.videocam_outlined
                  : Icons.broken_image_outlined,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          size: 28));
}
