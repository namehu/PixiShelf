import 'package:flutter/widgets.dart';

enum TurnAxis { horizontal, vertical }

class Turn {
  final TurnAxis axis;
  final int direction;
  const Turn(this.axis, this.direction);
}

class ReaderGestureState {
  double scale = 1, _baseScale = 1;
  Offset offset = Offset.zero, _baseOffset = Offset.zero, _start = Offset.zero;
  Offset _travel = Offset.zero;
  TurnAxis? _axis;
  bool _pinched = false, _edge = false;
  Offset get dragOffset =>
      _pinched || _edge || _baseScale > 1.01 || _axis == null
          ? Offset.zero
          : _axis == TurnAxis.horizontal
              ? Offset(_travel.dx * 0.16, 0)
              : Offset(0, _travel.dy * 0.16);
  void finish() {
    _travel = Offset.zero;
    _axis = null;
  }

  void cancelPaging() {
    _pinched = true;
  }

  bool get zoomed => scale > 1.01;
  void reset() {
    scale = 1;
    offset = Offset.zero;
    finish();
  }

  void start(Offset point, double width) {
    _start = point;
    _baseScale = scale;
    _baseOffset = offset;
    _travel = Offset.zero;
    _axis = null;
    _pinched = false;
    _edge = point.dx < 20 || point.dx > width - 20;
  }

  void update(ScaleUpdateDetails details, Size viewport) {
    if (details.pointerCount > 1) _pinched = true;
    _travel = details.localFocalPoint - _start;
    if (_pinched || _baseScale > 1.01) {
      scale = (_baseScale * details.scale).clamp(1.0, 5.0);
      final anchor = _start - viewport.center(Offset.zero);
      final ratio = scale / _baseScale;
      offset = _baseOffset * ratio + anchor * (1 - ratio) + _travel;
      final limitX = viewport.width * (scale - 1) / 2;
      final limitY = viewport.height * (scale - 1) / 2;
      offset = Offset(
          offset.dx.clamp(-limitX, limitX), offset.dy.clamp(-limitY, limitY));
      if (scale <= 1.01) reset();
    } else if (_axis == null && _travel.distance > 12) {
      _axis = _travel.dx.abs() > _travel.dy.abs()
          ? TurnAxis.horizontal
          : TurnAxis.vertical;
    }
  }

  Turn? end(Velocity velocity) {
    if (_pinched || _baseScale > 1.01 || _edge || _axis == null) return null;
    final distance = _axis == TurnAxis.horizontal ? _travel.dx : _travel.dy;
    final speed = _axis == TurnAxis.horizontal
        ? velocity.pixelsPerSecond.dx
        : velocity.pixelsPerSecond.dy;
    if (distance.abs() < 64 && (speed.abs() < 650 || distance.abs() < 16)) {
      return null;
    }
    return Turn(_axis!, distance < 0 ? 1 : -1);
  }

  void doubleTap(Offset point, Size viewport) {
    if (zoomed) {
      reset();
      return;
    }
    scale = 2.5;
    offset = (viewport.center(Offset.zero) - point) * (scale - 1);
  }
}
