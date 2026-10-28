import 'dart:async';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api.dart';
import 'app_theme.dart';
import 'gallery_query.dart';
import 'gallery_filters.dart';
import 'media_grid_sheet.dart';
import 'privacy_prompt.dart';
import 'gesture_state.dart';
import 'main.dart' show storageProvider;
import 'media_canvas.dart';
import 'video_canvas.dart';
import 'system_ui.dart';
import 'reader_controller.dart';
import 'reader_progress.dart';

final readerProvider = ChangeNotifierProvider.autoDispose
    .family<ReaderController, MobileApi>(
        (ref, api) => ReaderController(api, ref.read(storageProvider)));

class ReaderView extends ConsumerStatefulWidget {
  final MobileApi api;
  final ReaderEntry? entry;
  final bool? initialPrivacy;
  final bool sameWorkOnly, initialHighQuality;
  final List<int>? mediaIds;
  final ValueChanged<int>? onPositionChanged;
  final Future<void> Function(int artworkId, int mediaId)? onOpenDetail;
  final Future<void> Function(GalleryQuery query)? onBrowseQuery;
  final Future<void> Function() onLogout, onExpired;
  const ReaderView(
      {super.key,
      required this.api,
      this.entry,
      this.initialPrivacy,
      required this.onLogout,
      required this.onExpired,
      this.sameWorkOnly = false,
      this.initialHighQuality = false,
      this.mediaIds,
      this.onPositionChanged,
      this.onOpenDetail,
      this.onBrowseQuery});
  @override
  ConsumerState<ReaderView> createState() => ReaderViewState();
}

class ReaderViewState extends ConsumerState<ReaderView>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  final gestures = ReaderGestureState();
  final _mediaBoundary = GlobalKey();
  GlobalKey<VideoCanvasState> _videoKey = GlobalKey();
  late final AnimationController _motion, _zoomMotion;
  ReaderController? _localController;
  bool _hud = true,
      _privacy = true,
      _confirmed = false,
      _paused = false,
      _highQuality = false,
      _handlingExpiry = false,
      _allowPop = false,
      _leaving = false;
  bool _turnBusy = false, _waitingFrame = false;
  String? _key, _lastNotice;
  Offset _doubleTap = Offset.zero, _settleFrom = Offset.zero;
  ui.Image? _snapshot;
  Turn? _turn;
  double _zoomStart = 1, _zoomEnd = 1;
  Offset _zoomOffsetStart = Offset.zero, _zoomOffsetEnd = Offset.zero;
  ReaderController get controller =>
      _localController ?? ref.read(readerProvider(widget.api));
  @visibleForTesting
  ReaderController get debugController => controller;
  @visibleForTesting
  bool get debugTransitionBusy => _turnBusy;
  bool get _reduceMotion => MediaQuery.disableAnimationsOf(context);

  @override
  void initState() {
    super.initState();
    if (widget.sameWorkOnly) {
      _localController = ReaderController(widget.api, ref.read(storageProvider),
          sameWorkOnly: true, mediaIds: widget.mediaIds)
        ..addListener(_localChanged);
    }
    _motion = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 240))
      ..addListener(() {
        if (mounted) setState(() {});
      });
    _zoomMotion = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 220))
      ..addListener(() {
        final t = Curves.easeOutCubic.transform(_zoomMotion.value);
        if (mounted) {
          setState(() {
            gestures.scale = ui.lerpDouble(_zoomStart, _zoomEnd, t)!;
            gestures.offset = Offset.lerp(_zoomOffsetStart, _zoomOffsetEnd, t)!;
          });
        }
      });
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _enter());
  }

  void _localChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _enter() async {
    final choice = widget.initialPrivacy ??
        await confirmGalleryPrivacy(context, ref.read(storageProvider));
    if (!mounted || choice == null) return;
    setState(() {
      _privacy = choice;
      _confirmed = true;
    });
    await controller.start(entry: widget.entry);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    controller.setVisible(state == AppLifecycleState.resumed);
    if (state != AppLifecycleState.resumed) {
      _videoKey.currentState?.endBoost();
      if (controller.autoEnabled) setState(() => _paused = true);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _localController?.removeListener(_localChanged);
    _localController?.dispose();
    _motion.dispose();
    _zoomMotion.dispose();
    _snapshot?.dispose();
    unawaited(setReaderSystemUi(false));
    super.dispose();
  }

  void _toggleHud() {
    setState(() => _hud = !_hud);
    unawaited(setReaderSystemUi(!_hud));
  }

  void _back() {
    if (gestures.zoomed) {
      _animateZoom(reset: true);
      return;
    }
    if (!_hud) {
      _toggleHud();
      return;
    }
    unawaited(_leave());
  }

  Future<void> _leave() async {
    if (_leaving) return;
    _leaving = true;
    final c = controller;
    c.stopAuto();
    c.setCovered(true);
    await c.flush();
    if (!mounted) return;
    if (Navigator.of(context).canPop()) {
      setState(() => _allowPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          Navigator.pop(context, Map<int, String>.from(c.readingUpdates));
        }
      });
    } else {
      unawaited(SystemNavigator.pop());
    }
  }

  void _cover() {
    if (controller.autoEnabled) setState(() => _paused = true);
    controller.setCovered(true);
    _videoKey.currentState?.endBoost();
  }

  Future<void> _filter() async {
    final c = controller;
    _cover();
    final filters = await showGalleryFilters(context, c.filters);
    if (!mounted) return;
    if (filters != null) {
      await c.flush();
      c.filters = filters;
      await c.start(restore: false);
    }
    if (mounted) c.setCovered(false);
  }

  Future<void> _pickMedia() async {
    final c = controller, data = controller.current;
    if (data == null || data.media.isEmpty || c.loading) return;
    _cover();
    unawaited(c.flush());
    final index = await showModalBottomSheet<int>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => AnimatedBuilder(
            animation: c,
            builder: (context, _) => MediaGridSheet(
                api: widget.api,
                reader: data,
                current: c.mediaIndex,
                indices: c.allowedMediaIds == null ? null : c.mediaIndices,
                privacy: _privacy,
                onFailure: (failure) {
                  if (failure.status == 401 || failure.status == 403) {
                    c.fail(failure);
                  }
                })));
    if (!mounted) return;
    if (index != null && c.current == data) await c.selectMedia(index);
    if (mounted) c.setCovered(false);
  }

  Future<void> _openDetail() async {
    final c = controller;
    if (widget.onOpenDetail == null || c.current == null || c.media == null) {
      return;
    }
    _cover();
    await c.flush();
    await widget.onOpenDetail!(c.current!.id, c.media!.id);
    if (!mounted) return;
    await c.refreshOrganization();
    if (mounted) {
      c.setCovered(false);
      unawaited(setReaderSystemUi(!_hud));
    }
  }

  Future<void> _browse(GalleryQuery query) async {
    final c = controller;
    _cover();
    await c.flush();
    if (widget.onBrowseQuery != null) {
      await widget.onBrowseQuery!(query);
    } else if (!widget.sameWorkOnly) {
      c.filters = query;
      await c.start(restore: false);
    }
    if (mounted) c.setCovered(false);
  }

  Future<void> _rating() async {
    final c = controller;
    _cover();
    await showModalBottomSheet<void>(
        context: context,
        useSafeArea: true,
        builder: (context) => AnimatedBuilder(
            animation: c,
            builder: (context, _) => SafeArea(
                child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('作品评分',
                              style: Theme.of(context).textTheme.titleLarge),
                          const SizedBox(height: 12),
                          for (final entry in <int?, String>{
                            null: '清除评分',
                            1: '一般',
                            2: '喜欢',
                            3: '超爱',
                            4: '夯爆了'
                          }.entries)
                            ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: Icon(c.current?.rating == entry.key
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_off),
                                title: Text(entry.value),
                                enabled: !c.savingRating,
                                onTap: () async {
                                  await c.setRating(entry.key);
                                  if (context.mounted &&
                                      c.current?.rating == entry.key) {
                                    Navigator.pop(context);
                                  }
                                }),
                          if (c.savingRating) const LinearProgressIndicator(),
                        ])))));
    if (mounted) c.setCovered(false);
  }

  Future<void> _actions() async {
    final c = controller, data = controller.current;
    if (data == null) return;
    _cover();
    final action = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => AnimatedBuilder(
            animation: c,
            builder: (context, _) => SafeArea(
                child: ConstrainedBox(
                    constraints: BoxConstraints(
                        maxHeight: MediaQuery.sizeOf(context).height * .78),
                    child: SingleChildScrollView(
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                      ListTile(
                          title: Text(_privacy ? '内容已遮蔽' : data.title,
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                              '第 ${c.mediaIndex + 1} 项 · 共 ${data.media.length} 项')),
                      if (widget.onOpenDetail != null)
                        ListTile(
                            leading: const Icon(Icons.info_outline),
                            title: const Text('作品详情'),
                            onTap: () => Navigator.pop(context, 'detail')),
                      ListTile(
                          leading: const Icon(Icons.favorite_outline),
                          title: const Text('作品评分'),
                          trailing: Text(_ratingLabel(data.rating)),
                          onTap: () => Navigator.pop(context, 'rating')),
                      ListTile(
                          leading: Icon(c.mediaLiked
                              ? Icons.favorite
                              : Icons.favorite_border),
                          title: Text(c.mediaLiked ? '取消当前图片喜欢' : '喜欢当前图片'),
                          onTap: c.toggleMediaLike),
                      if (c.media?.animated == true && c.media?.video == false)
                        ListTile(
                            leading:
                                Icon(_paused ? Icons.play_arrow : Icons.pause),
                            title: Text(_paused ? '播放动图' : '暂停动图'),
                            onTap: () => Navigator.pop(context, 'animation')),
                      ListTile(
                          leading: const Icon(Icons.settings_outlined),
                          title: const Text('浏览设置'),
                          onTap: () => Navigator.pop(context, 'settings')),
                      const Divider(),
                      ListTile(
                          leading: const Icon(Icons.play_circle_outline),
                          title: Text(!c.autoEnabled
                              ? '开始自动浏览'
                              : c.autoPaused
                                  ? '继续自动浏览'
                                  : '暂停自动浏览'),
                          subtitle: Text('图片 ${c.autoSeconds} 秒 · 视频播完后继续'),
                          onTap: () => Navigator.pop(context, 'auto')),
                      if (c.autoEnabled)
                        ListTile(
                            leading: const Icon(Icons.stop_circle_outlined),
                            title: const Text('结束自动浏览'),
                            onTap: () => Navigator.pop(context, 'stop')),
                      for (final creator in c.detail?.creators ?? [])
                        ListTile(
                            leading: const Icon(Icons.person_outline),
                            title: Text(_privacy ? '创作者' : creator.name),
                            onTap: () => Navigator.pop(
                                context, 'creator:${creator.id}')),
                      if (c.detail?.tags.isNotEmpty == true)
                        Padding(
                            padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                            child: Align(
                                alignment: Alignment.centerLeft,
                                child: Wrap(spacing: 8, children: [
                                  for (final tag in c.detail!.tags)
                                    ActionChip(
                                        label:
                                            Text(_privacy ? '标签' : tag.label),
                                        onPressed: () => Navigator.pop(
                                            context, 'tag:${tag.id}'))
                                ]))),
                      const SizedBox(height: 12),
                    ]))))));
    if (!mounted) return;
    c.setCovered(false);
    if (action == 'detail') await _openDetail();
    if (action == 'rating') await _rating();
    if (action == 'settings') await _settings();
    if (action == 'animation') {
      c.pauseAuto();
      setState(() => _paused = !_paused);
    }
    if (action == 'auto') {
      setState(() => _paused = false);
      c.startAuto();
    }
    if (action == 'stop') c.stopAuto();
    if (action?.startsWith('creator:') == true) {
      final id = int.parse(action!.split(':').last);
      final creator = c.detail!.creators.firstWhere((item) => item.id == id);
      await _browse(GalleryQuery(artistId: id, artistName: creator.name));
    }
    if (action?.startsWith('tag:') == true) {
      final id = int.parse(action!.split(':').last);
      final tag = c.detail!.tags.firstWhere((item) => item.id == id);
      await _browse(GalleryQuery(tagIds: [id], tagLabels: [tag.label]));
    }
  }

  Future<void> _settings() async {
    final c = controller;
    _cover();
    final action = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        builder: (context) => StatefulBuilder(
            builder: (context, update) => SafeArea(
                child: SingleChildScrollView(
                    child: Padding(
                        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                        child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text('浏览设置',
                                  style:
                                      Theme.of(context).textTheme.titleLarge),
                              const SizedBox(height: 20),
                              const Text('自动浏览间隔'),
                              Wrap(spacing: 8, children: [
                                for (final seconds in [3, 5, 10, 15])
                                  ChoiceChip(
                                      label: Text('$seconds 秒'),
                                      selected: c.autoSeconds == seconds,
                                      onSelected: (_) =>
                                          update(() => c.autoSeconds = seconds))
                              ]),
                              const SizedBox(height: 16),
                              const Text('视频长按加速'),
                              Wrap(spacing: 8, children: [
                                for (final speed in [2, 3])
                                  ChoiceChip(
                                      label: Text('$speed×'),
                                      selected: c.longPressSpeed == speed,
                                      onSelected: (_) => update(
                                          () => c.longPressSpeed = speed))
                              ]),
                              SwitchListTile(
                                  contentPadding: EdgeInsets.zero,
                                  value: _privacy,
                                  title: const Text('隐私遮蔽'),
                                  onChanged: (_) =>
                                      Navigator.pop(context, 'privacy')),
                              ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.restart_alt),
                                  title: const Text('重新加载当前作品'),
                                  onTap: () => Navigator.pop(context, 'retry')),
                              ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.logout),
                                  title: const Text('退出账户／更换服务器'),
                                  onTap: () =>
                                      Navigator.pop(context, 'logout')),
                            ]))))));
    if (!mounted) return;
    c.setCovered(false);
    if (action == 'privacy') {
      setState(() => _privacy = !_privacy);
      await ref.read(storageProvider).changePrivacy(_privacy);
    }
    if (action == 'retry') await c.retry();
    if (action == 'logout') {
      c.setCovered(true);
      await c.flush();
      await widget.onLogout();
    }
  }

  void _animateZoom({bool reset = false, Size? viewport}) {
    if (controller.media?.video != false || _turnBusy) return;
    controller.pauseAuto();
    _zoomMotion.stop();
    _zoomStart = gestures.scale;
    _zoomOffsetStart = gestures.offset;
    if (reset) {
      gestures.reset();
    } else {
      gestures.doubleTap(_doubleTap, viewport ?? MediaQuery.sizeOf(context));
    }
    _zoomEnd = gestures.scale;
    _zoomOffsetEnd = gestures.offset;
    if (_zoomEnd > 1) _highQuality = true;
    if (_reduceMotion) {
      setState(() {});
      return;
    }
    gestures.scale = _zoomStart;
    gestures.offset = _zoomOffsetStart;
    unawaited(_zoomMotion.forward(from: 0));
  }

  Future<void> _turnPage(Turn? turn, Size viewport) async {
    if (_turnBusy || controller.covered) return;
    controller.pauseAuto();
    final drag = gestures.dragOffset;
    setState(gestures.finish);
    if (turn == null ||
        (widget.sameWorkOnly && turn.axis == TurnAxis.vertical)) {
      _settleFrom = drag;
      if (_reduceMotion) {
        _settleFrom = Offset.zero;
        return;
      }
      await _motion.forward(from: 0);
      if (mounted) setState(() => _settleFrom = Offset.zero);
      return;
    }
    final c = controller;
    final before = c.selectionKey;
    _turnBusy = true;
    c.setTransitioning(true);
    ui.Image? snapshot;
    if (!_reduceMotion && c.media?.video == false) {
      try {
        final boundary = _mediaBoundary.currentContext?.findRenderObject()
            as RenderRepaintBoundary?;
        if (boundary != null && !boundary.debugNeedsPaint) {
          snapshot = await boundary.toImage(pixelRatio: 1.25);
        }
      } catch (_) {
        /* The new image remains usable if a surface cannot be captured. */
      }
    }
    if (!mounted) {
      snapshot?.dispose();
      return;
    }
    setState(() {
      _snapshot?.dispose();
      _snapshot = snapshot;
      _turn = turn;
      _waitingFrame = true;
      _motion.value = 0;
      _settleFrom = drag;
    });
    if (turn.axis == TurnAxis.horizontal) {
      await c.horizontal(turn.direction, manual: false);
    } else {
      await c.vertical(turn.direction, manual: false);
    }
    if (!mounted) return;
    if (before == c.selectionKey || c.error != null) _finishTransition();
  }

  void _onFrameReady(String key) {
    final c = controller;
    if (key != c.selectionKey || !mounted) return;
    if (_waitingFrame) {
      _waitingFrame = false;
      if (_reduceMotion || _snapshot == null) {
        _finishTransition();
      } else {
        _motion.forward(from: 0).then((_) {
          if (!mounted || key != c.selectionKey) return;
          _finishTransition();
          c.mediaReady(key);
        });
      }
    }
  }

  void _onReady(String key) {
    if (!mounted || key != controller.selectionKey) return;
    if (_waitingFrame) _onFrameReady(key);
    if (!_turnBusy) {
      controller.mediaReady(key);
    }
  }

  void _finishTransition() {
    final old = _snapshot;
    setState(() {
      _snapshot = null;
      _turn = null;
      _turnBusy = false;
      _waitingFrame = false;
      _settleFrom = Offset.zero;
    });
    controller.setTransitioning(false);
    WidgetsBinding.instance.addPostFrameCallback((_) => old?.dispose());
  }

  String _ratingLabel(int? rating) =>
      const {1: '一般', 2: '喜欢', 3: '超爱', 4: '夯爆了'}[rating] ?? '未评分';
  String _date(String? value) =>
      value?.split('T').first.replaceAll('-', '.') ?? '';

  @override
  Widget build(BuildContext context) {
    final ReaderController c = _localController ??
        ref.watch<ReaderController>(readerProvider(widget.api));
    if (c.selectionKey != _key) {
      _key = c.selectionKey;
      gestures.reset();
      _highQuality = widget.initialHighQuality;
      _paused = false;
      _zoomMotion.stop();
      _videoKey = GlobalKey();
      final mediaId = c.media?.id;
      if (mediaId != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && c.media?.id == mediaId) {
            widget.onPositionChanged?.call(mediaId);
          }
        });
      }
    }
    if ((c.failureStatus == 401 || c.failureStatus == 403) &&
        !_handlingExpiry) {
      _handlingExpiry = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onExpired();
      });
    }
    if (c.notice != null && c.notice != _lastNotice) {
      _lastNotice = c.notice;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(c.notice!)));
        }
      });
    }
    final data = c.current,
        item = c.media,
        source = c.source,
        detail = c.detail;
    final key = c.selectionKey;
    return PopScope(
        canPop: _allowPop,
        onPopInvokedWithResult: (didPop, result) {
          if (!didPop) {
            _back();
          } else {
            unawaited(c.flush());
          }
        },
        child: AnnotatedRegion<SystemUiOverlayStyle>(
            value: AppTheme.mediaBars,
            child: Theme(
                data: AppTheme.media,
                child: Scaffold(
                    backgroundColor: Colors.black,
                    body: LayoutBuilder(builder: (context, constraints) {
                      final viewport = constraints.biggest;
                      final hudTop = MediaQuery.paddingOf(context)
                          .top
                          .clamp(12.0, double.infinity);
                      final quickButton = IconButton.styleFrom(
                          minimumSize: const Size.square(44),
                          maximumSize: const Size.square(44),
                          padding: EdgeInsets.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: const CircleBorder());
                      final chromeButton = quickButton.copyWith(
                          backgroundColor:
                              const WidgetStatePropertyAll(Color(0x73000000)));
                      final footerHeight = 52.0 +
                          (!_privacy && detail?.description?.isNotEmpty == true
                              ? 24
                              : 0) +
                          (detail?.tags.isNotEmpty == true ? 32 : 0);
                      Widget content;
                      if (!_confirmed) {
                        content = const SizedBox.expand();
                      } else if (c.error != null) {
                        content = _message(c.error!,
                            action: '重试',
                            onTap: c.retry,
                            secondary: c.autoEnabled ? '跳过并继续' : null,
                            onSecondary: c.skipAutoError);
                      } else if (c.loading) {
                        content = const Center(
                            child: CircularProgressIndicator(strokeWidth: 2));
                      } else if (data == null || item == null) {
                        content = _message('没有可浏览的作品',
                            action: widget.sameWorkOnly ? null : '调整筛选',
                            onTap: _filter);
                      } else if (source == null) {
                        content =
                            _message('媒体信息加载失败', action: '重试', onTap: c.retry);
                      } else {
                        content = item.video
                            ? VideoCanvas(
                                key: _videoKey,
                                api: widget.api,
                                reader: data,
                                source: source,
                                active: c.foreground && !c.covered && !_paused,
                                hud: _hud,
                                controlsBottom:
                                    MediaQuery.paddingOf(context).bottom +
                                        (_hud ? footerHeight + 64 : 48),
                                privacy: _privacy,
                                loop: !c.autoRunning,
                                playbackSpeed: c.videoSpeed,
                                initialPosition:
                                    c.videoPositions[key] ?? Duration.zero,
                                onPosition: (position) =>
                                    c.videoPositions[key] = position,
                                onSpeedChanged: (speed) =>
                                    setState(() => c.videoSpeed = speed),
                                onInteraction: c.pauseAuto,
                                onMore: _actions,
                                onReady: () => _onFrameReady(key),
                                onEnded: () => c.videoEnded(key),
                                onObservation: (position, duration, playing) =>
                                    c.videoObservation(
                                        key, position, duration, playing),
                                onFailure: (failure) {
                                  if (_turnBusy) _finishTransition();
                                  c.fail(failure);
                                })
                            : MediaCanvas(
                                key: ValueKey(key),
                                api: widget.api,
                                reader: data,
                                item: item,
                                source: source,
                                active: c.foreground && !c.covered && !_paused,
                                highQuality: _highQuality,
                                onReady: () => _onReady(key),
                                onFrameReady: () => _onFrameReady(key),
                                onCycleMode: (cycle) =>
                                    c.setAnimationCycleMode(key, cycle),
                                onCycleComplete: () =>
                                    c.animationCycleComplete(key),
                                onFailure: (failure) {
                                  if (_turnBusy) _finishTransition();
                                  c.fail(failure);
                                });
                        if (_privacy && !item.video) {
                          content = ImageFiltered(
                              imageFilter:
                                  ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                              child: content);
                        }
                      }
                      final progress =
                          Curves.easeOutCubic.transform(_motion.value);
                      final direction = _turn?.direction ?? 1;
                      final distance = _turn?.axis == TurnAxis.horizontal
                          ? viewport.width
                          : viewport.height;
                      final shift = _turn?.axis == TurnAxis.horizontal
                          ? Offset(direction * distance, 0)
                          : Offset(0, direction * distance);
                      final incoming = _snapshot != null
                          ? shift * (1 - progress)
                          : Offset.zero;
                      final settling =
                          _turn == null && _settleFrom != Offset.zero
                              ? _settleFrom * (1 - progress)
                              : Offset.zero;
                      return Stack(fit: StackFit.expand, children: [
                        ClipRect(
                            child: GestureDetector(
                                behavior: HitTestBehavior.opaque,
                                onTap: _toggleHud,
                                onDoubleTapDown: (d) =>
                                    _doubleTap = d.localPosition,
                                onDoubleTap: () {
                                  if (item?.video == true) {
                                    _videoKey.currentState?.doubleTap(
                                        _doubleTap.dx / viewport.width);
                                  } else {
                                    _animateZoom(viewport: viewport);
                                  }
                                },
                                onLongPressStart: (_) {
                                  if (item?.video == true) {
                                    _videoKey.currentState
                                        ?.beginBoost(c.longPressSpeed);
                                  } else {
                                    unawaited(_actions());
                                  }
                                },
                                onLongPressEnd: (_) =>
                                    _videoKey.currentState?.endBoost(),
                                onLongPressCancel: () =>
                                    _videoKey.currentState?.endBoost(),
                                onScaleStart: (d) {
                                  if (_turnBusy) return;
                                  c.pauseAuto();
                                  _zoomMotion.stop();
                                  gestures.start(
                                      d.localFocalPoint, viewport.width);
                                },
                                onScaleUpdate: (d) {
                                  if (_turnBusy) return;
                                  setState(() {
                                    if (item?.video == true &&
                                        d.pointerCount > 1) {
                                      gestures.cancelPaging();
                                      return;
                                    }
                                    gestures.update(d, viewport);
                                    if (gestures.zoomed) _highQuality = true;
                                  });
                                },
                                onScaleEnd: (d) {
                                  if (!_turnBusy) {
                                    unawaited(_turnPage(
                                        gestures.end(d.velocity), viewport));
                                  }
                                },
                                child: Stack(fit: StackFit.expand, children: [
                                  Transform(
                                      alignment: Alignment.center,
                                      transform: Matrix4.identity()
                                        ..translate(
                                            gestures.offset.dx +
                                                gestures.dragOffset.dx +
                                                incoming.dx +
                                                settling.dx,
                                            gestures.offset.dy +
                                                gestures.dragOffset.dy +
                                                incoming.dy +
                                                settling.dy)
                                        ..scale(gestures.scale),
                                      child: RepaintBoundary(
                                          key: _mediaBoundary, child: content)),
                                  if (_snapshot != null)
                                    IgnorePointer(
                                        child: Transform.translate(
                                            offset: Offset.lerp(
                                                _settleFrom, -shift, progress)!,
                                            child: RawImage(
                                                image: _snapshot,
                                                fit: BoxFit.fill))),
                                ]))),
                        if (_hud) ...[
                          Positioned(
                              top: hudTop,
                              left: 12,
                              child: IconButton(
                                  tooltip: '返回',
                                  onPressed: _back,
                                  style: chromeButton,
                                  icon: const Icon(Icons.chevron_left,
                                      size: 22))),
                          if (!widget.sameWorkOnly)
                            Positioned(
                                top: hudTop,
                                right: 12,
                                child: IconButton(
                                    tooltip: '筛选',
                                    onPressed: _confirmed ? _filter : null,
                                    style: chromeButton,
                                    icon: const Icon(Icons.tune, size: 20))),
                          if (data != null)
                            Positioned(
                                top: hudTop + (widget.sameWorkOnly ? 0 : 52),
                                right: 12,
                                child: TextButton(
                                    onPressed: c.loading ? null : _pickMedia,
                                    style: TextButton.styleFrom(
                                        foregroundColor: Colors.white,
                                        backgroundColor:
                                            const Color(0x73000000),
                                        minimumSize: const Size(64, 32),
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 10),
                                        tapTargetSize:
                                            MaterialTapTargetSize.shrinkWrap,
                                        shape: const StadiumBorder()),
                                    child: Text(
                                        '${c.mediaIndex + 1} / ${data.media.length}',
                                        style: const TextStyle(
                                            fontSize: 12,
                                            height: 1.5,
                                            fontFeatures: [
                                              ui.FontFeature.tabularFigures()
                                            ])))),
                        ],
                        if (_hud && data != null)
                          Positioned(
                              left: 0,
                              right: 0,
                              bottom: 56 + MediaQuery.paddingOf(context).bottom,
                              child: DecoratedBox(
                                  decoration: const BoxDecoration(
                                      gradient: LinearGradient(
                                          begin: Alignment.topCenter,
                                          end: Alignment.bottomCenter,
                                          colors: [
                                        Colors.transparent,
                                        Color(0xcc000000)
                                      ])),
                                  child: Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                          12, 8, 12, 0),
                                      child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.stretch,
                                          children: [
                                            Row(children: [
                                              Expanded(
                                                  child: Column(
                                                      mainAxisSize:
                                                          MainAxisSize.min,
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      children: [
                                                    InkWell(
                                                        onTap: detail?.creators
                                                                    .isNotEmpty ==
                                                                true
                                                            ? () {
                                                                final creator =
                                                                    detail!
                                                                        .creators
                                                                        .first;
                                                                _browse(GalleryQuery(
                                                                    artistId:
                                                                        creator
                                                                            .id,
                                                                    artistName:
                                                                        creator
                                                                            .name));
                                                              }
                                                            : null,
                                                        child: SizedBox(
                                                            height: 24,
                                                            child: Align(
                                                                alignment: Alignment
                                                                    .centerLeft,
                                                                child: Text(
                                                                    _privacy
                                                                        ? '隐私模式'
                                                                        : '${data.author}${detail?.sourceDate != null ? ' · ${_date(detail!.sourceDate)}' : ''}',
                                                                    maxLines: 1,
                                                                    overflow:
                                                                        TextOverflow
                                                                            .ellipsis,
                                                                    style: const TextStyle(
                                                                        fontSize:
                                                                            12,
                                                                        height:
                                                                            2,
                                                                        color: Colors
                                                                            .white70))))),
                                                    InkWell(
                                                        onTap:
                                                            widget.onOpenDetail ==
                                                                    null
                                                                ? null
                                                                : _openDetail,
                                                        child: Text(
                                                            _privacy
                                                                ? '内容已遮蔽'
                                                                : data.title,
                                                            maxLines: 1,
                                                            overflow:
                                                                TextOverflow
                                                                    .ellipsis,
                                                            style: const TextStyle(
                                                                fontSize: 14,
                                                                height: 20 / 14,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w600))),
                                                  ])),
                                              const SizedBox(width: 8),
                                              GestureDetector(
                                                  onLongPress: _rating,
                                                  child: IconButton(
                                                      tooltip: data.liked
                                                          ? '取消喜欢并清除评分'
                                                          : '喜欢作品',
                                                      style: quickButton,
                                                      onPressed: c.loading
                                                          ? null
                                                          : c.toggleLike,
                                                      icon: Column(
                                                          mainAxisSize:
                                                              MainAxisSize.min,
                                                          children: [
                                                            Icon(
                                                                data.liked
                                                                    ? Icons
                                                                        .favorite
                                                                    : Icons
                                                                        .favorite_border,
                                                                size: 18,
                                                                color: data
                                                                        .liked
                                                                    ? const Color(
                                                                        0xfff1a7b7)
                                                                    : Colors
                                                                        .white),
                                                            if ((data.rating ??
                                                                    0) >=
                                                                3)
                                                              Text(
                                                                  _ratingLabel(data
                                                                      .rating),
                                                                  style: const TextStyle(
                                                                      fontSize:
                                                                          9,
                                                                      height:
                                                                          1.1)),
                                                          ]))),
                                              const SizedBox(width: 4),
                                              IconButton(
                                                  tooltip: '更多操作',
                                                  style: quickButton,
                                                  onPressed: _actions,
                                                  icon: const Icon(
                                                      Icons.more_horiz,
                                                      size: 20)),
                                            ]),
                                            if (!_privacy &&
                                                detail?.description
                                                        ?.isNotEmpty ==
                                                    true) ...[
                                              const SizedBox(height: 4),
                                              Text(detail!.description!,
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                      fontSize: 12,
                                                      height: 20 / 12,
                                                      color: Colors.white70)),
                                            ],
                                            if (detail?.tags.isNotEmpty ==
                                                true) ...[
                                              const SizedBox(height: 4),
                                              SizedBox(
                                                  height: 28,
                                                  child: ListView(
                                                      scrollDirection:
                                                          Axis.horizontal,
                                                      children: [
                                                        for (final tag
                                                            in detail!.tags
                                                                .take(3))
                                                          Padding(
                                                              padding:
                                                                  const EdgeInsets.only(
                                                                      right: 6),
                                                              child: TextButton(
                                                                  style: TextButton.styleFrom(
                                                                      foregroundColor: Colors
                                                                          .white70,
                                                                      minimumSize:
                                                                          const Size(
                                                                              0, 28),
                                                                      padding: const EdgeInsets.symmetric(
                                                                          horizontal:
                                                                              4),
                                                                      tapTargetSize:
                                                                          MaterialTapTargetSize
                                                                              .shrinkWrap),
                                                                  onPressed: () =>
                                                                      _browse(GalleryQuery(tagIds: [tag.id], tagLabels: [tag.label])),
                                                                  child: Text(_privacy ? '#标签' : '#${tag.label}', maxLines: 1, style: const TextStyle(fontSize: 12, height: 16 / 12)))),
                                                        if (detail.tags.length >
                                                            3)
                                                          TextButton(
                                                              onPressed:
                                                                  _actions,
                                                              style: TextButton.styleFrom(
                                                                  foregroundColor:
                                                                      Colors
                                                                          .white70,
                                                                  minimumSize:
                                                                      const Size(
                                                                          0, 28),
                                                                  padding: const EdgeInsets.symmetric(
                                                                      horizontal:
                                                                          8),
                                                                  tapTargetSize:
                                                                      MaterialTapTargetSize
                                                                          .shrinkWrap),
                                                              child: Text(
                                                                  '+${detail.tags.length - 3}',
                                                                  style: const TextStyle(
                                                                      fontSize:
                                                                          12))),
                                                      ])),
                                            ],
                                          ])))),
                        if (data != null)
                          Positioned(
                              left: 12,
                              right: 12,
                              bottom: MediaQuery.paddingOf(context).bottom,
                              child: ReaderProgress(
                                  key: ValueKey('progress-${data.id}'),
                                  active: c.foreground && !c.loading,
                                  indices: c.mediaIndices,
                                  current: c.mediaIndex,
                                  onStart: () {
                                    c.pauseAuto();
                                    c.setCovered(true);
                                  },
                                  onCancel: () => c.setCovered(false),
                                  onCommit: (index) async {
                                    await c.selectMedia(index);
                                    if (mounted) c.setCovered(false);
                                  })),
                        if (c.autoEnabled)
                          Positioned(
                              top: MediaQuery.paddingOf(context).top +
                                  (_hud ? 64 : 8),
                              left: 16,
                              child: Material(
                                  color: Colors.black87,
                                  borderRadius: BorderRadius.circular(12),
                                  child: TextButton.icon(
                                      onPressed: () {
                                        if (c.autoPaused) {
                                          setState(() => _paused = false);
                                          c.startAuto();
                                        } else {
                                          c.pauseAuto();
                                          setState(() => _paused = true);
                                        }
                                      },
                                      icon: Icon(
                                          c.autoPaused
                                              ? Icons.play_arrow
                                              : Icons.pause,
                                          size: 18),
                                      label: Text(c.autoPaused
                                          ? '自动浏览已暂停 · 继续'
                                          : '自动浏览 · ${c.autoSeconds} 秒')))),
                      ]);
                    })))));
  }

  Widget _message(String text,
          {String? action,
          Future<void> Function()? onTap,
          String? secondary,
          Future<void> Function()? onSecondary}) =>
      Center(
          child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.photo_outlined,
                    color: Colors.white38, size: 36),
                const SizedBox(height: 16),
                Text(text, textAlign: TextAlign.center),
                if (action != null)
                  TextButton(onPressed: onTap, child: Text(action)),
                if (secondary != null)
                  TextButton(onPressed: onSecondary, child: Text(secondary)),
              ])));
}
