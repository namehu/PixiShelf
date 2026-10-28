import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Touch-friendly scrubbing: preview locally, navigate only when released.
class ReaderProgress extends StatefulWidget {
  final List<int> indices;
  final int current;
  final ValueChanged<int> onCommit;
  final VoidCallback onStart, onCancel;
  final bool active;
  const ReaderProgress(
      {super.key,
      required this.indices,
      required this.current,
      required this.onCommit,
      required this.onStart,
      required this.onCancel,
      this.active = true});
  @override
  State<ReaderProgress> createState() => _ReaderProgressState();
}

class _ReaderProgressState extends State<ReaderProgress> {
  int? _preview;
  bool _canceled = false;
  int _index(double x, double width) => ((x / width) * widget.indices.length)
      .floor()
      .clamp(0, widget.indices.length - 1);
  void _commit() {
    if (_canceled || !widget.active) return;
    final position = _preview;
    setState(() => _preview = null);
    if (position != null && position < widget.indices.length) {
      widget.onCommit(widget.indices[position]);
    }
  }

  @override
  void didUpdateWidget(ReaderProgress old) {
    super.didUpdateWidget(old);
    if (old.current != widget.current ||
        old.indices.length != widget.indices.length) {
      _preview = null;
    }
    if (!widget.active) {
      _preview = null;
      _canceled = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.indices.isEmpty) return const SizedBox();
    final selected = (_preview ?? widget.indices.indexOf(widget.current))
        .clamp(0, widget.indices.length - 1);
    return Semantics(
        label: '图片进度',
        value: '第 ${widget.indices[selected] + 1} 项',
        increasedValue: selected + 1 < widget.indices.length
            ? '第 ${widget.indices[selected + 1] + 1} 项'
            : null,
        decreasedValue:
            selected > 0 ? '第 ${widget.indices[selected - 1] + 1} 项' : null,
        onIncrease: selected + 1 < widget.indices.length
            ? () => widget.onCommit(widget.indices[selected + 1])
            : null,
        onDecrease: selected > 0
            ? () => widget.onCommit(widget.indices[selected - 1])
            : null,
        child: LayoutBuilder(
            builder: (context, constraints) => Listener(
                onPointerDown: (_) => _canceled = false,
                onPointerCancel: (_) {
                  _canceled = true;
                  setState(() => _preview = null);
                  widget.onCancel();
                },
                child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onHorizontalDragStart: (d) {
                      widget.onStart();
                      setState(() => _preview =
                          _index(d.localPosition.dx, constraints.maxWidth));
                    },
                    onHorizontalDragUpdate: (d) => setState(() => _preview =
                        _index(d.localPosition.dx, constraints.maxWidth)),
                    onHorizontalDragEnd: (_) => _commit(),
                    onHorizontalDragCancel: () {
                      setState(() => _preview = null);
                      if (!_canceled) widget.onCancel();
                    },
                    onTapDown: (d) => setState(() => _preview =
                        _index(d.localPosition.dx, constraints.maxWidth)),
                    onTapUp: (_) {
                      widget.onStart();
                      _commit();
                    },
                    onTapCancel: () {
                      setState(() => _preview = null);
                    },
                    child: SizedBox(
                        height: 48,
                        child:
                            Stack(alignment: Alignment.bottomCenter, children: [
                          if (_preview != null)
                            Positioned(
                                top: 0,
                                child: DecoratedBox(
                                    decoration: BoxDecoration(
                                        color: Colors.black87,
                                        borderRadius: BorderRadius.circular(6)),
                                    child: Padding(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 10, vertical: 2),
                                        child: Text(
                                            '第 ${widget.indices[selected] + 1} 项',
                                            style: const TextStyle(
                                                fontSize: 12))))),
                          Positioned(
                              left: 0,
                              right: 0,
                              bottom: 12,
                              height: 4,
                              child: CustomPaint(
                                  painter: _Segments(
                                      widget.indices.length, selected))),
                        ]))))));
  }
}

class _Segments extends CustomPainter {
  final int count, selected;
  _Segments(this.count, this.selected);
  @override
  void paint(Canvas canvas, Size size) {
    final unit = size.width / count;
    final gap = math.min(3.0, unit * .18);
    for (var i = 0; i < count; i++) {
      canvas.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(i * unit, 0, unit - gap, size.height),
              const Radius.circular(2)),
          Paint()
            ..color = i == selected
                ? Colors.white
                : i < selected
                    ? Colors.white60
                    : Colors.white24);
    }
  }

  @override
  bool shouldRepaint(_Segments old) =>
      count != old.count || selected != old.selected;
}
