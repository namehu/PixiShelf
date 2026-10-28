import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
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

final readerProvider = ChangeNotifierProvider.autoDispose
    .family<ReaderController, MobileApi>(
        (ref, api) => ReaderController(api, ref.read(storageProvider)));

class ReaderView extends ConsumerStatefulWidget {
  final MobileApi api;
  final ReaderEntry? entry;
  final bool? initialPrivacy;
  final Future<void> Function() onLogout, onExpired;
  const ReaderView(
      {super.key,
      required this.api,
      this.entry,
      this.initialPrivacy,
      required this.onLogout,
      required this.onExpired});
  @override
  ConsumerState<ReaderView> createState() => _ReaderViewState();
}

class _ReaderViewState extends ConsumerState<ReaderView>
    with WidgetsBindingObserver {
  final gestures = ReaderGestureState();
  bool _hud = true,
      _privacy = true,
      _confirmed = false,
      _paused = false,
      _highQuality = false;
  String? _key, _lastNotice;
  Offset _doubleTap = Offset.zero;
  bool _handlingExpiry = false, _allowPop = false, _leaving = false;
  ReaderController get controller => ref.read(readerProvider(widget.api));
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _enter());
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
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(setReaderSystemUi(false));
    super.dispose();
  }

  void _toggleHud() {
    setState(() => _hud = !_hud);
    unawaited(setReaderSystemUi(!_hud));
  }

  void _back() {
    if (gestures.zoomed) {
      setState(gestures.reset);
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

  Future<void> _filter() async {
    final c = controller;
    c.setCovered(true);
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
    final c = controller;
    final data = c.current;
    if (data == null || data.media.isEmpty || c.loading) return;
    c.setCovered(true);
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

  Future<void> _settings() async {
    final c = controller;
    c.setCovered(true);
    final action = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        builder: (context) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  contentPadding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
                  title: Text('浏览设置',
                      style: Theme.of(context).textTheme.titleLarge),
                  subtitle: Text(widget.api.session.server)),
              SwitchListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                  value: _privacy,
                  title: const Text('隐私遮蔽'),
                  subtitle: const Text('仅遮蔽显示，不改变加载和阅读记录'),
                  onChanged: (_) => Navigator.pop(context, 'privacy')),
              ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                  leading: const Icon(Icons.restart_alt),
                  title: const Text('重新加载当前作品'),
                  onTap: () => Navigator.pop(context, 'retry')),
              ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                  leading: const Icon(Icons.logout),
                  title: const Text('退出账户／更换服务器'),
                  onTap: () => Navigator.pop(context, 'logout')),
              const SizedBox(height: 16),
            ])));
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

  @override
  Widget build(BuildContext context) {
    final c = ref.watch(readerProvider(widget.api));
    if (c.selectionKey != _key) {
      _key = c.selectionKey;
      gestures.reset();
      _highQuality = false;
      _paused = false;
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
    final data = c.current, item = c.media, source = c.source;
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
                      Widget content;
                      if (!_confirmed) {
                        content = const SizedBox.expand();
                      } else if (c.error != null) {
                        content =
                            _message(c.error!, action: '重试', onTap: c.retry);
                      } else if (c.loading) {
                        content = const Center(
                            child: CircularProgressIndicator(strokeWidth: 2));
                      } else if (data == null || item == null) {
                        content = _message('没有可浏览的作品',
                            action: '调整筛选', onTap: _filter);
                      } else if (source == null) {
                        content =
                            _message('媒体信息加载失败', action: '重试', onTap: c.retry);
                      } else {
                        content = item.video
                            ? VideoCanvas(
                                key: ValueKey(c.selectionKey),
                                api: widget.api,
                                reader: data,
                                source: source,
                                active: c.foreground && !c.covered,
                                hud: _hud,
                                privacy: _privacy,
                                onObservation: (position, duration, playing) =>
                                    c.videoObservation(
                                        '${data.id}:${data.revision}:${item.id}',
                                        position,
                                        duration,
                                        playing),
                                onFailure: (failure) {
                                  c.ready = false;
                                  if (failure.status == 401 ||
                                      failure.status == 403) {
                                    c.fail(failure);
                                  }
                                },
                              )
                            : MediaCanvas(
                                key: ValueKey(c.selectionKey),
                                api: widget.api,
                                reader: data,
                                item: item,
                                source: source,
                                active: c.foreground && !c.covered && !_paused,
                                highQuality: _highQuality,
                                onReady: () => c.mediaReady(
                                    '${data.id}:${data.revision}:${item.id}'),
                                onFailure: (failure) {
                                  c.ready = false;
                                  if (failure.status == 401 ||
                                      failure.status == 403) {
                                    c.fail(failure);
                                  }
                                });
                        if (_privacy && !item.video) {
                          content = ImageFiltered(
                              imageFilter:
                                  ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                              child: content);
                        }
                      }
                      return Stack(fit: StackFit.expand, children: [
                        ClipRect(
                            child: GestureDetector(
                                behavior: HitTestBehavior.opaque,
                                onTap: _toggleHud,
                                onDoubleTapDown: (details) =>
                                    _doubleTap = details.localPosition,
                                onDoubleTap: () {
                                  if (item == null || item.video) return;
                                  setState(() {
                                    gestures.doubleTap(_doubleTap, viewport);
                                    if (gestures.zoomed) _highQuality = true;
                                  });
                                },
                                onScaleStart: (details) => gestures.start(
                                    details.localFocalPoint, viewport.width),
                                onScaleUpdate: (details) {
                                  setState(() {
                                    if (item?.video == true &&
                                        details.pointerCount > 1) {
                                      gestures.cancelPaging();
                                      return;
                                    }
                                    gestures.update(details, viewport);
                                    if (gestures.zoomed) _highQuality = true;
                                  });
                                },
                                onScaleEnd: (details) {
                                  final turn = gestures.end(details.velocity);
                                  setState(gestures.finish);
                                  if (turn != null && !c.covered) {
                                    if (turn.axis == TurnAxis.horizontal) {
                                      c.horizontal(turn.direction);
                                    } else {
                                      c.vertical(turn.direction);
                                    }
                                  }
                                },
                                child: Transform(
                                    alignment: Alignment.center,
                                    transform: Matrix4.identity()
                                      ..translate(
                                          gestures.offset.dx +
                                              gestures.dragOffset.dx,
                                          gestures.offset.dy +
                                              gestures.dragOffset.dy)
                                      ..scale(gestures.scale),
                                    child: content))),
                        if (_hud) ...[
                          Positioned(
                              top: 0,
                              left: 0,
                              right: 0,
                              child: DecoratedBox(
                                  decoration: const BoxDecoration(
                                      gradient: LinearGradient(
                                          begin: Alignment.topCenter,
                                          end: Alignment.bottomCenter,
                                          colors: [
                                        Colors.black87,
                                        Colors.transparent
                                      ])),
                                  child: SafeArea(
                                      bottom: false,
                                      child: Padding(
                                          padding: const EdgeInsets.fromLTRB(
                                              8, 6, 8, 24),
                                          child: Row(children: [
                                            IconButton(
                                                tooltip: '返回',
                                                onPressed: _back,
                                                icon: const Icon(
                                                    Icons.arrow_back)),
                                            const Expanded(
                                                child: Text('PixiShelf',
                                                    style: TextStyle(
                                                        fontSize: 20,
                                                        fontWeight:
                                                            FontWeight.w600))),
                                            IconButton(
                                                tooltip: '搜索与排序',
                                                onPressed:
                                                    _confirmed ? _filter : null,
                                                icon: const Icon(Icons.tune)),
                                            IconButton(
                                                tooltip: '设置',
                                                onPressed: _settings,
                                                icon: const Icon(
                                                    Icons.more_horiz)),
                                          ]))))),
                          if (data != null)
                            Positioned(
                                bottom: 0,
                                left: 0,
                                right: 0,
                                child: DecoratedBox(
                                    decoration: const BoxDecoration(
                                        gradient: LinearGradient(
                                            begin: Alignment.topCenter,
                                            end: Alignment.bottomCenter,
                                            colors: [
                                          Colors.transparent,
                                          Colors.black87
                                        ])),
                                    child: SafeArea(
                                        top: false,
                                        child: Padding(
                                            padding: const EdgeInsets.fromLTRB(
                                                20, 48, 12, 24),
                                            child: Row(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.end,
                                                children: [
                                                  Expanded(
                                                      child: Column(
                                                          crossAxisAlignment:
                                                              CrossAxisAlignment
                                                                  .start,
                                                          mainAxisSize:
                                                              MainAxisSize.min,
                                                          children: [
                                                        Text(
                                                            _privacy
                                                                ? '隐私模式'
                                                                : data.author,
                                                            maxLines: 1,
                                                            overflow:
                                                                TextOverflow
                                                                    .ellipsis,
                                                            style: const TextStyle(
                                                                fontSize: 12,
                                                                color: Colors
                                                                    .white70)),
                                                        const SizedBox(
                                                            height: 6),
                                                        Text(
                                                            _privacy
                                                                ? '内容已遮蔽'
                                                                : data.title,
                                                            maxLines: 2,
                                                            overflow:
                                                                TextOverflow
                                                                    .ellipsis,
                                                            style: const TextStyle(
                                                                fontSize: 18,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w500)),
                                                        const SizedBox(
                                                            height: 8),
                                                        TextButton(
                                                            onPressed: c.loading
                                                                ? null
                                                                : _pickMedia,
                                                            style: TextButton.styleFrom(
                                                                foregroundColor:
                                                                    Colors
                                                                        .white70,
                                                                padding:
                                                                    EdgeInsets
                                                                        .zero,
                                                                minimumSize:
                                                                    const Size(
                                                                        72, 48),
                                                                alignment: Alignment
                                                                    .centerLeft),
                                                            child: Row(
                                                                mainAxisSize:
                                                                    MainAxisSize
                                                                        .min,
                                                                children: [
                                                                  Text(
                                                                      '${data.media.isEmpty ? 0 : c.mediaIndex + 1} / ${data.media.length}',
                                                                      style: const TextStyle(
                                                                          fontSize:
                                                                              12,
                                                                          color: Colors.white60,
                                                                          fontFeatures: [
                                                                            FontFeature.tabularFigures()
                                                                          ])),
                                                                  const SizedBox(
                                                                      width: 8),
                                                                  const Icon(
                                                                      Icons
                                                                          .grid_view_outlined,
                                                                      size: 16),
                                                                ])),
                                                      ])),
                                                  if (item?.animated == true &&
                                                      item?.video == false)
                                                    IconButton(
                                                        tooltip: _paused
                                                            ? '播放动图'
                                                            : '暂停动图',
                                                        onPressed: () =>
                                                            setState(() =>
                                                                _paused =
                                                                    !_paused),
                                                        icon: Icon(_paused
                                                            ? Icons.play_arrow
                                                            : Icons.pause)),
                                                  IconButton(
                                                      tooltip: data.liked
                                                          ? '取消喜欢并清除评分'
                                                          : '喜欢作品',
                                                      onPressed: c.loading
                                                          ? null
                                                          : c.toggleLike,
                                                      icon: Icon(
                                                          data.liked
                                                              ? Icons.favorite
                                                              : Icons
                                                                  .favorite_border,
                                                          color: data.liked
                                                              ? const Color(
                                                                  0xfff1a7b7)
                                                              : Colors.white)),
                                                ]))))),
                        ],
                        if (!_hud && data != null && data.media.length > 1)
                          Positioned(
                              bottom: MediaQuery.paddingOf(context).bottom + 6,
                              left: 24,
                              right: 24,
                              child: IgnorePointer(
                                  child: LinearProgressIndicator(
                                      value: (c.mediaIndex + 1) /
                                          data.media.length,
                                      minHeight: 2,
                                      color: Colors.white60,
                                      backgroundColor: Colors.white12))),
                      ]);
                    })))));
  }

  Widget _message(String text,
          {String? detail, String? action, VoidCallback? onTap}) =>
      Center(
          child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.photo_outlined,
                    color: Colors.white38, size: 36),
                const SizedBox(height: 16),
                Text(text, textAlign: TextAlign.center),
                if (detail != null)
                  Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(detail,
                          style: const TextStyle(color: Colors.white54),
                          textAlign: TextAlign.center)),
                if (action != null)
                  TextButton(onPressed: onTap, child: Text(action)),
              ])));
}
