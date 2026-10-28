import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/video_canvas.dart';
import 'package:pixishelf_app/app_theme.dart';

class VideoApi extends MobileApi {
  VideoApi()
      : super(const Session('https://fixture.invalid', 'synthetic', 'owner'));
  @override
  Future<VideoNavigationData> videoNavigation(int id, int revision) async =>
      const VideoNavigationData(
          chapters: [VideoChapter(0, '第二段', 12, 25)],
          frames: [VideoKeyframe('frame-one', 20, 0)]);
}

class FakeVideo extends VideoPlayerController {
  FakeVideo()
      : super.networkUrl(Uri.parse('https://fixture.invalid/synthetic'));
  @override
  Future<void> initialize() async {
    value = const VideoPlayerValue(
        duration: Duration(seconds: 60),
        size: Size(1920, 1080),
        isInitialized: true);
  }

  @override
  Future<void> play() async {
    value = value.copyWith(isPlaying: true);
  }

  @override
  Future<void> pause() async {
    value = value.copyWith(isPlaying: false);
  }

  @override
  Future<void> setVolume(double v) async {
    value = value.copyWith(volume: v);
  }

  @override
  Future<void> setLooping(bool v) async {
    value = value.copyWith(isLooping: v);
  }

  @override
  Future<void> setPlaybackSpeed(double v) async {
    value = value.copyWith(playbackSpeed: v);
  }

  @override
  Future<void> seekTo(Duration v) async {
    value = value.copyWith(position: v);
  }
}

void main() {
  testWidgets(
      'hidden HUD retains video controls, gesture speed restores and chapters seek',
      (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = VideoApi(), player = FakeVideo();
    final key = GlobalKey<VideoCanvasState>();
    var speed = 1.0, active = true;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.media,
        home: Scaffold(body: StatefulBuilder(builder: (context, set) {
          update = set;
          return VideoCanvas(
              key: key,
              api: api,
              reader: ReaderData(
                  id: 1,
                  title: 'Video',
                  author: '',
                  fingerprint: 'fp',
                  revision: 3,
                  media: [],
                  resumeId: null,
                  rating: null,
                  seen: {}),
              source: const MediaSource(
                  10,
                  false,
                  '/api/mobile/v1/media/10?variant=preview',
                  '/api/mobile/v1/media/10?variant=original'),
              active: active,
              hud: false,
              privacy: false,
              playbackSpeed: speed,
              onSpeedChanged: (value) => set(() => speed = value),
              onObservation: (a, b, c) {},
              onFailure: (e) => fail(e.message),
              createPlayer: (uri, headers) {
                expect(uri.queryParameters['revision'], '3');
                expect(headers['Authorization'], 'Bearer synthetic');
                return player;
              });
        }))));
    await tester.pumpAndSettle();
    expect(find.byTooltip('暂停'), findsOneWidget);
    expect(find.byType(Slider), findsOneWidget);
    expect(find.byTooltip('开启声音'), findsOneWidget);
    await tester.tap(find.text('1.0×'));
    await tester.pump();
    expect(player.value.playbackSpeed, 1.25);
    key.currentState!.beginBoost(3);
    await tester.pump();
    expect(player.value.playbackSpeed, 3);
    key.currentState!.endBoost();
    await tester.pump();
    expect(player.value.playbackSpeed, 1.25);
    key.currentState!.doubleTap(.95);
    await tester.pump();
    expect(player.value.position, const Duration(seconds: 10));
    key.currentState!.doubleTap(.05);
    await tester.pump();
    expect(player.value.position, Duration.zero);
    key.currentState!.doubleTap(.5);
    await tester.pump();
    expect(player.value.isPlaying, isFalse);
    update(() => active = false);
    await tester.pump();
    update(() => active = true);
    await tester.pump();
    expect(player.value.isPlaying, isFalse,
        reason: 'explicit user pause survives covering');
    await tester.tap(find.byTooltip('视频导航'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('第二段'));
    await tester.pumpAndSettle();
    expect(player.value.position, const Duration(seconds: 12));
    expect(find.byTooltip('播放'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    api.close();
  });
}
