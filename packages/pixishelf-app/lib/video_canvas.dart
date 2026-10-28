import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'api.dart';
import 'models.dart';

class VideoCanvas extends StatefulWidget {
  final MobileApi api;
  final ReaderData reader;
  final MediaSource source;
  final bool active, hud, privacy, loop;
  final double playbackSpeed;
  final double? controlsBottom;
  final Duration initialPosition;
  final ValueChanged<double>? onSpeedChanged;
  final ValueChanged<Duration>? onPosition;
  final VoidCallback? onEnded, onReady, onInteraction, onMore;
  final void Function(double position, double duration, bool playing)
      onObservation;
  final ValueChanged<ApiFailure> onFailure;
  @visibleForTesting
  final VideoPlayerController Function(Uri uri, Map<String, String> headers)?
      createPlayer;
  const VideoCanvas(
      {super.key,
      required this.api,
      required this.reader,
      required this.source,
      required this.active,
      required this.hud,
      required this.privacy,
      required this.onObservation,
      required this.onFailure,
      this.createPlayer,
      this.controlsBottom,
      this.playbackSpeed = 1,
      this.onSpeedChanged,
      this.initialPosition = Duration.zero,
      this.onPosition,
      this.loop = false,
      this.onEnded,
      this.onReady,
      this.onInteraction,
      this.onMore});
  @override
  State<VideoCanvas> createState() => VideoCanvasState();
}

class VideoCanvasState extends State<VideoCanvas> {
  VideoPlayerController? _player;
  VideoNavigationData? _navigation;
  String? _error, _gestureHint;
  bool _muted = true,
      _userPaused = false,
      _loading = true,
      _wasPlaying = false,
      _handlingError = false,
      _boosted = false,
      _ended = false;
  double? _scrub;
  double _zoom = 1;
  int _epoch = 0;
  Timer? _hintTimer;
  DateTime _lastReport = DateTime.fromMillisecondsSinceEpoch(0);
  bool get playing => _player?.value.isPlaying == true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadNavigation());
  }

  Future<void> _loadNavigation() async {
    try {
      final data = await widget.api
          .videoNavigation(widget.source.id, widget.reader.revision);
      if (mounted) setState(() => _navigation = data);
    } on ApiFailure catch (failure) {
      if (mounted && (failure.status == 401 || failure.status == 403)) {
        widget.onFailure(failure);
      }
    } catch (_) {/* Optional navigation never blocks playback. */}
  }

  Future<void> _load() async {
    final epoch = ++_epoch;
    final old = _player;
    _player = null;
    old?.removeListener(_changed);
    await old?.dispose();
    if (!mounted || epoch != _epoch) return;
    setState(() {
      _error = null;
      _loading = true;
      _ended = false;
    });
    final uri =
        Uri.parse(widget.api.session.server).resolve(widget.source.original);
    if (uri.origin != widget.api.session.server ||
        !uri.path.startsWith('/api/mobile/v1/media/')) {
      setState(() {
        _error = '媒体地址无效';
        _loading = false;
      });
      return;
    }
    final videoUri = uri.replace(queryParameters: {
      ...uri.queryParameters,
      'revision': '${widget.reader.revision}'
    });
    final headers = {'Authorization': 'Bearer ${widget.api.session.token}'};
    final player = widget.createPlayer?.call(videoUri, headers) ??
        VideoPlayerController.networkUrl(videoUri,
            httpHeaders: headers,
            videoPlayerOptions: VideoPlayerOptions(mixWithOthers: false));
    _player = player;
    player.addListener(_changed);
    try {
      await player.initialize();
      if (!mounted || epoch != _epoch) return;
      await player.setVolume(_muted ? 0 : 1);
      await player.setLooping(widget.loop);
      await player.setPlaybackSpeed(widget.playbackSpeed);
      if (widget.initialPosition > Duration.zero &&
          widget.initialPosition < player.value.duration) {
        await player.seekTo(widget.initialPosition);
      }
      if (widget.active && !_userPaused) await player.play();
      if (mounted && epoch == _epoch) {
        setState(() => _loading = false);
        widget.onReady?.call();
      }
    } catch (_) {
      if (mounted && epoch == _epoch) unawaited(_handleError());
    }
  }

  Future<void> _handleError() async {
    if (_handlingError) return;
    _handlingError = true;
    var failure = const ApiFailure('VIDEO_FAILED');
    try {
      await widget.api.request('session');
    } on ApiFailure catch (e) {
      failure = e;
    } finally {
      if (mounted) {
        widget.onFailure(failure);
        setState(() {
          _loading = false;
          _error = failure.status == null
              ? '视频无法播放，请重试；设备可能不支持此编码'
              : failure.message;
        });
      }
      _handlingError = false;
    }
  }

  void _changed() {
    final player = _player;
    if (!mounted || player == null) return;
    final value = player.value;
    if (value.hasError) {
      if (_error == null) unawaited(_handleError());
      return;
    }
    final now = DateTime.now();
    final ended = !widget.loop &&
        !_ended &&
        _wasPlaying &&
        !value.isPlaying &&
        value.duration > Duration.zero &&
        value.position >= value.duration;
    if (widget.active &&
        !value.isBuffering &&
        _scrub == null &&
        (value.isPlaying || ended) &&
        value.position > Duration.zero &&
        (ended || now.difference(_lastReport).inMilliseconds >= 1000)) {
      _lastReport = now;
      widget.onObservation(value.position.inMilliseconds / 1000,
          value.duration.inMilliseconds / 1000, value.isPlaying);
      widget.onPosition?.call(value.position);
    }
    _wasPlaying = value.isPlaying;
    if (ended) {
      _ended = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.active) widget.onEnded?.call();
      });
    }
    if (value.position < value.duration) _ended = false;
    setState(() {});
  }

  @override
  void didUpdateWidget(VideoCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.active) {
      _scrub = null;
      _wasPlaying = false;
      endBoost();
      unawaited(_player?.pause());
    } else if (!oldWidget.active && !_userPaused && _error == null) {
      unawaited(_player?.play());
    }
    if (oldWidget.loop != widget.loop) {
      unawaited(_player?.setLooping(widget.loop));
    }
    if (oldWidget.playbackSpeed != widget.playbackSpeed && !_boosted) {
      unawaited(_player?.setPlaybackSpeed(widget.playbackSpeed));
    }
  }

  void _hint(String text) {
    _hintTimer?.cancel();
    setState(() => _gestureHint = text);
    _hintTimer = Timer(const Duration(milliseconds: 900), () {
      if (mounted && !_boosted) setState(() => _gestureHint = null);
    });
  }

  Future<void> togglePlayback() async {
    final player = _player;
    if (player == null || !player.value.isInitialized || !widget.active) return;
    widget.onInteraction?.call();
    if (player.value.isPlaying) {
      _userPaused = true;
      await player.pause();
    } else {
      _userPaused = false;
      if (player.value.position >= player.value.duration) {
        await player.seekTo(Duration.zero);
      }
      await player.play();
    }
  }

  void doubleTap(double horizontalFraction) {
    if (horizontalFraction > .2 && horizontalFraction < .8) {
      unawaited(togglePlayback());
    } else {
      final delta = horizontalFraction <= .2 ? -10 : 10;
      unawaited(
          seek((_player?.value.position.inMilliseconds ?? 0) / 1000 + delta));
      _hint(delta > 0 ? '快进 10 秒' : '快退 10 秒');
    }
  }

  void beginBoost(int preference) {
    if (!playing) {
      widget.onMore?.call();
      return;
    }
    _boosted = true;
    final speed = math.max(widget.playbackSpeed, preference.toDouble());
    unawaited(_player?.setPlaybackSpeed(speed));
    _hint(
        '${speed.toStringAsFixed(speed.truncateToDouble() == speed ? 0 : 2)}× 加速播放');
  }

  void endBoost() {
    if (!_boosted) return;
    _boosted = false;
    unawaited(_player?.setPlaybackSpeed(widget.playbackSpeed));
    if (mounted) setState(() => _gestureHint = null);
  }

  Future<void> seek(double seconds) async {
    final player = _player;
    if (player == null || !player.value.isInitialized) return;
    widget.onInteraction?.call();
    final target =
        (seconds * 1000).round().clamp(0, player.value.duration.inMilliseconds);
    await player.seekTo(Duration(milliseconds: target));
    widget.onPosition?.call(Duration(milliseconds: target));
  }

  Future<void> _showNavigation() async {
    final nav = _navigation;
    final player = _player;
    if (nav == null || player == null) return;
    widget.onInteraction?.call();
    final resume = player.value.isPlaying;
    await player.pause();
    if (!mounted) return;
    final target = await showModalBottomSheet<double>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => SafeArea(
            child: SizedBox(
                height: MediaQuery.sizeOf(context).height * .65,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 24, vertical: 12),
                          child: Text('视频导航',
                              style: Theme.of(context).textTheme.titleLarge)),
                      Expanded(
                          child: ListView(children: [
                        for (final chapter in nav.chapters)
                          ListTile(
                              leading: const Icon(Icons.bookmark_outline),
                              title: Text(chapter.title.isEmpty
                                  ? '章节 ${chapter.index + 1}'
                                  : chapter.title),
                              subtitle: Text(_time(chapter.start)),
                              onTap: () =>
                                  Navigator.pop(context, chapter.start)),
                        if (nav.frames.isNotEmpty)
                          const Padding(
                              padding: EdgeInsets.fromLTRB(24, 16, 24, 8),
                              child: Text('关键帧')),
                        for (final frame in nav.frames)
                          ListTile(
                              leading: const Icon(Icons.movie_outlined),
                              title: Text('关键帧 ${frame.selectedOrder + 1}'),
                              subtitle: Text(_time(frame.captureTime)),
                              onTap: () =>
                                  Navigator.pop(context, frame.captureTime)),
                      ])),
                    ]))));
    if (!mounted) return;
    if (target != null) await seek(target);
    if (resume && widget.active && !_userPaused) await player.play();
  }

  @override
  void dispose() {
    ++_epoch;
    _hintTimer?.cancel();
    final player = _player;
    if (player != null && player.value.isInitialized) {
      widget.onPosition?.call(player.value.position);
    }
    player?.removeListener(_changed);
    unawaited(player?.dispose());
    super.dispose();
  }

  String _time(double seconds) {
    final value = seconds.floor();
    return '${value ~/ 60}:${(value % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    if (_error != null) {
      return Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_error!, textAlign: TextAlign.center),
        TextButton(onPressed: _load, child: const Text('重试'))
      ]));
    }
    if (_loading || player == null || !player.value.isInitialized) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    final value = player.value;
    final duration = value.duration.inMilliseconds / 1000;
    final position = value.position.inMilliseconds / 1000;
    final nav = _navigation;
    return Stack(fit: StackFit.expand, children: [
      ClipRect(
          child: Center(
              child: Transform.scale(
                  scale: _zoom,
                  child: AspectRatio(
                      aspectRatio: value.aspectRatio,
                      child: ImageFiltered(
                          imageFilter: ImageFilter.blur(
                              sigmaX: widget.privacy ? 28 : 0,
                              sigmaY: widget.privacy ? 28 : 0),
                          child: VideoPlayer(player)))))),
      if (value.isBuffering)
        const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      if (_gestureHint != null)
        Align(
            alignment: const Alignment(0, -.65),
            child: DecoratedBox(
                decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(12)),
                child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 12),
                    child: Text(_gestureHint!)))),
      // Playback remains directly operable after hiding the artwork information.
      Positioned(
          left: 8,
          right: 8,
          bottom: widget.controlsBottom ??
              MediaQuery.paddingOf(context).bottom + (widget.hud ? 210 : 48),
          child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {},
              child: DecoratedBox(
                  decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: .72),
                      borderRadius: BorderRadius.circular(12)),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Slider(
                        value: (_scrub ?? position)
                            .clamp(0, duration > 0 ? duration : 1),
                        max: duration > 0 ? duration : 1,
                        onChangeStart: duration > 0
                            ? (v) {
                                widget.onInteraction?.call();
                                setState(() => _scrub = v);
                                player.pause();
                              }
                            : null,
                        onChanged: duration > 0
                            ? (v) => setState(() => _scrub = v)
                            : null,
                        onChangeEnd: duration > 0
                            ? (v) async {
                                await seek(v);
                                if (!mounted || !widget.active) return;
                                setState(() => _scrub = null);
                                if (!_userPaused) await player.play();
                              }
                            : null),
                    Row(children: [
                      IconButton(
                          tooltip: value.isPlaying ? '暂停' : '播放',
                          onPressed: togglePlayback,
                          icon: Icon(value.isPlaying
                              ? Icons.pause
                              : Icons.play_arrow)),
                      Expanded(
                          child: Text('${_time(position)} / ${_time(duration)}',
                              style: const TextStyle(fontSize: 12))),
                      IconButton(
                          tooltip: _muted ? '开启声音' : '静音',
                          onPressed: () {
                            setState(() => _muted = !_muted);
                            player.setVolume(_muted ? 0 : 1);
                          },
                          icon: Icon(
                              _muted ? Icons.volume_off : Icons.volume_up)),
                      if (widget.onSpeedChanged != null)
                        TextButton(
                            onPressed: () {
                              const speeds = [1.0, 1.25, 1.5, 2.0, 3.0];
                              final next = speeds[
                                  (speeds.indexOf(widget.playbackSpeed) + 1) %
                                      speeds.length];
                              widget.onSpeedChanged!(next);
                            },
                            child: Text('${widget.playbackSpeed}×')),
                      IconButton(
                          tooltip: _zoom == 1 ? '放大视频' : '视频缩放 $_zoom×',
                          onPressed: () => setState(
                              () => _zoom = _zoom >= 3 ? 1 : _zoom + .5),
                          icon: Icon(
                              _zoom == 1 ? Icons.zoom_in : Icons.fit_screen)),
                      if (nav != null &&
                          (nav.chapters.isNotEmpty || nav.frames.isNotEmpty))
                        IconButton(
                            tooltip: '视频导航',
                            onPressed: _showNavigation,
                            icon: const Icon(Icons.list_alt)),
                    ]),
                  ])))),
    ]);
  }
}
