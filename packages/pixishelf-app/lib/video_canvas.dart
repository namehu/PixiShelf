import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'api.dart';
import 'models.dart';

class VideoCanvas extends StatefulWidget {
  final MobileApi api;
  final ReaderData reader;
  final MediaSource source;
  final bool active, hud, privacy;
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
      this.createPlayer});
  @override
  State<VideoCanvas> createState() => _VideoCanvasState();
}

class _VideoCanvasState extends State<VideoCanvas> {
  VideoPlayerController? _player;
  String? _error;
  bool _muted = true,
      _userPaused = false,
      _loading = true,
      _wasPlaying = false,
      _handlingError = false;
  double? _scrub;
  int _epoch = 0;
  DateTime _lastReport = DateTime.fromMillisecondsSinceEpoch(0);
  @override
  void initState() {
    super.initState();
    _load();
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
      await player.setLooping(false);
      if (widget.active && !_userPaused) await player.play();
      if (mounted) setState(() => _loading = false);
    } catch (_) {
      if (mounted && epoch == _epoch) _handleError();
    }
  }

  Future<void> _handleError() async {
    if (_handlingError) return;
    _handlingError = true;
    try {
      await widget.api.request('session');
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '视频无法播放，请重试；设备可能不支持此编码';
        });
      }
    } on ApiFailure catch (e) {
      if (mounted) {
        widget.onFailure(e);
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    } finally {
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
    final ended = _wasPlaying &&
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
    }
    _wasPlaying = value.isPlaying;
    setState(() {});
  }

  @override
  void didUpdateWidget(VideoCanvas old) {
    super.didUpdateWidget(old);
    if (!widget.active) {
      _scrub = null;
      _wasPlaying = false;
      unawaited(_player?.pause());
    } else if (!old.active && !_userPaused && _error == null) {
      unawaited(_player?.play());
    }
  }

  @override
  void dispose() {
    ++_epoch;
    _player?.removeListener(_changed);
    unawaited(_player?.dispose());
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
    return Stack(fit: StackFit.expand, children: [
      Center(
          child: AspectRatio(
              aspectRatio: value.aspectRatio,
              child: ImageFiltered(
                  imageFilter: ImageFilter.blur(
                      sigmaX: widget.privacy ? 28 : 0,
                      sigmaY: widget.privacy ? 28 : 0),
                  child: VideoPlayer(player)))),
      if (value.isBuffering)
        const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      if (widget.hud)
        Positioned(
            left: 12,
            right: 12,
            bottom:
                MediaQuery.paddingOf(context).bottom + (widget.hud ? 140 : 12),
            child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {},
                child: DecoratedBox(
                    decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(12)),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Slider(
                          value: (_scrub ?? position)
                              .clamp(0, duration > 0 ? duration : 1),
                          max: duration > 0 ? duration : 1,
                          onChangeStart: duration > 0
                              ? (v) {
                                  setState(() => _scrub = v);
                                  player.pause();
                                }
                              : null,
                          onChanged: duration > 0
                              ? (v) => setState(() => _scrub = v)
                              : null,
                          onChangeEnd: duration > 0
                              ? (v) async {
                                  await player.seekTo(Duration(
                                      milliseconds: (v * 1000).round()));
                                  if (!mounted || !widget.active) return;
                                  setState(() => _scrub = null);
                                  if (!_userPaused) await player.play();
                                }
                              : null),
                      Row(children: [
                        IconButton(
                            tooltip: value.isPlaying ? '暂停' : '播放',
                            onPressed: () async {
                              if (value.isPlaying) {
                                _userPaused = true;
                                await player.pause();
                              } else {
                                _userPaused = false;
                                if (value.position >= value.duration) {
                                  await player.seekTo(Duration.zero);
                                }
                                await player.play();
                              }
                            },
                            icon: Icon(value.isPlaying
                                ? Icons.pause
                                : Icons.play_arrow)),
                        Expanded(
                            child: Text(
                                '${_time(position)} / ${_time(duration)}',
                                style: const TextStyle(fontSize: 12))),
                        IconButton(
                            tooltip: _muted ? '开启声音' : '静音',
                            onPressed: () {
                              setState(() => _muted = !_muted);
                              player.setVolume(_muted ? 0 : 1);
                            },
                            icon: Icon(
                                _muted ? Icons.volume_off : Icons.volume_up)),
                      ]),
                    ])))),
    ]);
  }
}
