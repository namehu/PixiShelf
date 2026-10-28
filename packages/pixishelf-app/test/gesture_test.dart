import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/gesture_state.dart';

void main() {
  test('a single gesture locks one navigation axis', () {
    final state = ReaderGestureState()..start(const Offset(200, 300), 400);
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(180, 295), pointerCount: 1),
        const Size(400, 800));
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(110, 500), pointerCount: 1),
        const Size(400, 800));
    final turn = state.end(Velocity.zero)!;
    expect(turn.axis, TurnAxis.horizontal);
    expect(turn.direction, 1);
  });
  test('pinching then shrinking never turns a page', () {
    final state = ReaderGestureState()..start(const Offset(200, 300), 400);
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(200, 300), pointerCount: 2, scale: 2),
        const Size(400, 800));
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(20, 300), pointerCount: 1, scale: 1),
        const Size(400, 800));
    expect(
        state.end(const Velocity(pixelsPerSecond: Offset(-1200, 0))), isNull);
  });
  test('zoomed panning cannot change artwork, even at the edge', () {
    final state = ReaderGestureState()
      ..doubleTap(const Offset(200, 400), const Size(400, 800));
    state.start(const Offset(200, 300), 400);
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(200, 700), pointerCount: 1),
        const Size(400, 800));
    expect(state.end(Velocity.zero), isNull);
    expect(state.zoomed, isTrue);
    state.reset();
    expect(state.zoomed, isFalse);
  });
  test('reserves system back edges and ignores tiny movement', () {
    final state = ReaderGestureState()..start(const Offset(5, 300), 400);
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(200, 300), pointerCount: 1),
        const Size(400, 800));
    expect(state.end(Velocity.zero), isNull);
    state.start(const Offset(200, 300), 400);
    state.update(
        ScaleUpdateDetails(
            localFocalPoint: const Offset(205, 300), pointerCount: 1),
        const Size(400, 800));
    expect(state.end(Velocity.zero), isNull);
  });
}
