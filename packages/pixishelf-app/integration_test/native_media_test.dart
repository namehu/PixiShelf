import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:image/image.dart' as img;
import 'package:video_player/video_player.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/system_ui.dart';
import 'package:pixishelf_app/models.dart';
import 'package:pixishelf_app/media_canvas.dart';
import 'package:pixishelf_app/video_canvas.dart';

class FixtureApi extends MobileApi {
  final Uint8List bytes;
  final List<String> paths = [];
  FixtureApi(this.bytes)
      : super(const Session(
            'https://fixture.invalid', 'synthetic-token', 'owner'));
  @override
  Future<Uint8List> media(String path, int revision) async {
    paths.add(path);
    return bytes;
  }
}

ReaderData reader() => ReaderData(
    id: 1,
    title: 'Synthetic media',
    author: 'Fixture',
    fingerprint: 'abc',
    revision: 1,
    media: [],
    resumeId: null,
    rating: null,
    seen: {});
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native immersive mode hides and restores Android system bars',
      (tester) async {
    await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('System bars fixture'))));
    await setReaderSystemUi(false);
    await tester.pump(const Duration(seconds: 1));
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    expect(view.viewPadding.top, greaterThan(0));
    await setReaderSystemUi(true);
    await tester.pump(const Duration(seconds: 1));
    expect(view.viewPadding.top, 0);
    expect(view.viewPadding.bottom, 0);
    await setReaderSystemUi(false);
    await tester.pump(const Duration(seconds: 1));
    expect(view.viewPadding.top, greaterThan(0));
  });
  testWidgets('APNG renders moving frames, pauses, and zoom does not reload',
      (tester) async {
    final a = img.Image(width: 32, height: 32, numChannels: 4)
      ..frameDuration = 600;
    img.fill(a, color: img.ColorRgba8(255, 0, 0, 255));
    final b = img.Image(width: 32, height: 32, numChannels: 4)
      ..frameDuration = 600;
    img.fill(b, color: img.ColorRgba8(0, 0, 255, 255));
    a.addFrame(b);
    final api = FixtureApi(Uint8List.fromList(img.encodePng(a)));
    var active = true, highQuality = false, ready = 0;
    late StateSetter update;
    await tester
        .pumpWidget(MaterialApp(home: StatefulBuilder(builder: (context, set) {
      update = set;
      return MediaCanvas(
          api: api,
          reader: reader(),
          item: const MediaItem(
              id: 2, index: 0, video: false, animated: true, members: [2]),
          source: const MediaSource(2, true, '/preview', '/original'),
          active: active,
          highQuality: highQuality,
          onReady: () => ready++,
          onFailure: (e) => fail(e.message));
    })));
    for (var i = 0; i < 50 && find.byType(RawImage).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byType(RawImage), findsOneWidget);
    final first = tester.widget<RawImage>(find.byType(RawImage)).image;
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump(const Duration(milliseconds: 100));
    expect(
        identical(tester.widget<RawImage>(find.byType(RawImage)).image, first),
        isFalse);
    update(() {
      active = false;
      highQuality = true;
    });
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    final paused = tester.widget<RawImage>(find.byType(RawImage)).image;
    await tester.pump(const Duration(seconds: 1));
    expect(
        identical(tester.widget<RawImage>(find.byType(RawImage)).image, paused),
        isTrue);
    expect(api.paths, ['/original']);
    expect(ready, greaterThan(0));
    await tester.pumpWidget(const SizedBox.shrink());
    api.close();
  });
  testWidgets('native video plays, seeks, mutes and pauses when covered',
      (tester) async {
    const encoded = String.fromEnvironment('SMOKE_VIDEO_BASE64');
    expect(encoded.isNotEmpty, isTrue,
        reason:
            'Supply a synthetic H.264 fixture using --dart-define-from-file');
    final folder = await Directory.systemTemp.createTemp('pixishelf-native-');
    final file = await File('${folder.path}/sample.mp4')
        .writeAsBytes(base64Decode(encoded));
    final api = FixtureApi(Uint8List(0));
    VideoPlayerController? player;
    Uri? requestedUri;
    Map<String, String>? requestedHeaders;
    var active = true;
    var observations = 0;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: StatefulBuilder(builder: (context, set) {
      update = set;
      return VideoCanvas(
          api: api,
          reader: reader(),
          source: const MediaSource(
              2,
              false,
              '/api/mobile/v1/media/2?variant=preview',
              '/api/mobile/v1/media/2?variant=original'),
          active: active,
          hud: true,
          privacy: false,
          createPlayer: (uri, headers) {
            requestedUri = uri;
            requestedHeaders = headers;
            return player = VideoPlayerController.file(file);
          },
          onObservation: (position, duration, playing) {
            if (position > 0 && playing) observations++;
          },
          onFailure: (e) => fail(e.message));
    }))));
    for (var i = 0; i < 100 && player?.value.isInitialized != true; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(requestedUri?.queryParameters['revision'], '1');
    expect(requestedHeaders?['Authorization'], 'Bearer synthetic-token');
    expect(player!.value.isInitialized, isTrue);
    expect(player!.value.volume, 0);
    await tester.pump(const Duration(seconds: 2));
    expect(player!.value.position, greaterThan(Duration.zero));
    expect(observations, greaterThan(0));
    await tester.tap(find.byTooltip('开启声音'));
    await tester.pump(const Duration(milliseconds: 200));
    expect(player!.value.volume, 1);
    await player!.seekTo(const Duration(seconds: 5));
    await tester.pump(const Duration(milliseconds: 500));
    expect(player!.value.position.inSeconds, greaterThanOrEqualTo(5));
    update(() => active = false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(player!.value.isPlaying, isFalse);
    final stopped = observations;
    await tester.pump(const Duration(seconds: 1));
    expect(observations, stopped);
    update(() => active = true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(player!.value.isPlaying, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 200));
    api.close();
    await folder.delete(recursive: true);
  });
}
