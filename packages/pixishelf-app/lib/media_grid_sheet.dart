import 'package:flutter/material.dart';
import 'api.dart';
import 'models.dart';
import 'media_thumbnail.dart';

class MediaGridSheet extends StatefulWidget {
  final MobileApi api;
  final ReaderData reader;
  final int current;
  final bool privacy;
  final ValueChanged<ApiFailure> onFailure;
  const MediaGridSheet(
      {super.key,
      required this.api,
      required this.reader,
      required this.current,
      required this.privacy,
      required this.onFailure});
  @override
  State<MediaGridSheet> createState() => _MediaGridSheetState();
}

class _MediaGridSheetState extends State<MediaGridSheet> {
  ScrollController? _scroll;
  final Map<int, Future<void>> _pages = {};
  Future<MediaSource?> _source(int index) async {
    final item = widget.reader.media[index];
    if (!widget.reader.sources.containsKey(item.id)) {
      final page = index ~/ 24;
      await _pages.putIfAbsent(
          page,
          () =>
              widget.api.mediaPage(widget.reader, page).catchError((Object e) {
                _pages.remove(page);
                if (mounted && e is ApiFailure) widget.onFailure(e);
                throw e;
              }));
    }
    return widget.reader.sources[item.id];
  }

  @override
  void dispose() {
    _scroll?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .78,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
              child: Row(children: [
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('作品内选图',
                          style: Theme.of(context).textTheme.titleLarge),
                      Text(
                          '第 ${widget.current + 1} 项 · 共 ${widget.reader.media.length} 项',
                          style: Theme.of(context).textTheme.bodySmall),
                    ])),
                IconButton(
                    tooltip: '关闭选图',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close)),
              ])),
          Expanded(child: LayoutBuilder(builder: (context, constraints) {
            final columns = constraints.maxWidth >= 600 ? 5 : 3;
            final width =
                (constraints.maxWidth - 40 - (columns - 1) * 8) / columns;
            final extent = width * 4 / 3 + 8;
            final target = (widget.current ~/ columns) * extent;
            final maximum =
                (((widget.reader.media.length + columns - 1) ~/ columns) *
                            extent -
                        constraints.maxHeight +
                        MediaQuery.paddingOf(context).bottom +
                        16)
                    .clamp(0.0, double.infinity);
            _scroll ??= ScrollController(
                initialScrollOffset: target.clamp(0.0, maximum));
            return GridView.builder(
              controller: _scroll,
              padding: EdgeInsets.fromLTRB(
                  20, 8, 20, MediaQuery.paddingOf(context).bottom + 16),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                  childAspectRatio: 3 / 4),
              itemCount: widget.reader.media.length,
              itemBuilder: (context, index) {
                final item = widget.reader.media[index];
                final selected = index == widget.current;
                final seen = widget.reader.seen.contains(item.id) ||
                    item.members.any(widget.reader.seen.contains);
                return Semantics(
                  button: true,
                  selected: selected,
                  label:
                      '第 ${index + 1} 项，${item.video ? '视频' : item.animated ? '动图' : '图片'}${seen ? '，已读' : ''}',
                  child: InkWell(
                      key: ValueKey('media-pick-${item.id}'),
                      onTap: () => Navigator.pop(context, index),
                      borderRadius: BorderRadius.circular(8),
                      child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Stack(fit: StackFit.expand, children: [
                            FutureBuilder<MediaSource?>(
                                future: _source(index),
                                builder: (context, snapshot) => MediaThumbnail(
                                    api: widget.api,
                                    path: snapshot.data?.thumbnail ??
                                        snapshot.data?.preview,
                                    revision: widget.reader.revision,
                                    video: item.video,
                                    privacy: widget.privacy,
                                    onFailure: widget.onFailure)),
                            if (selected)
                              IgnorePointer(
                                  child: DecoratedBox(
                                      decoration: BoxDecoration(
                                          border: Border.all(
                                              color: Theme.of(context)
                                                  .colorScheme
                                                  .primary,
                                              width: 3),
                                          borderRadius:
                                              BorderRadius.circular(8)))),
                            Positioned(
                                left: 0,
                                right: 0,
                                bottom: 0,
                                child: ColoredBox(
                                    color: selected
                                        ? Theme.of(context).colorScheme.primary
                                        : const Color(0xb8000000),
                                    child: Padding(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 8, vertical: 5),
                                        child: Row(children: [
                                          Expanded(
                                              child: Text('${index + 1}',
                                                  style: const TextStyle(
                                                      color: Colors.white,
                                                      fontSize: 12))),
                                          if (seen)
                                            const Icon(Icons.check,
                                                size: 14, color: Colors.white),
                                          if (item.video || item.animated) ...[
                                            const SizedBox(width: 4),
                                            Icon(
                                                item.video
                                                    ? Icons.play_arrow
                                                    : Icons.motion_photos_on,
                                                size: 14,
                                                color: Colors.white)
                                          ],
                                        ])))),
                          ]))),
                );
              },
            );
          })),
        ]),
      );
}
