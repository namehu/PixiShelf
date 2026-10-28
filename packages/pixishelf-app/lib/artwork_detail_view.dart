import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'api.dart';
import 'app_theme.dart';
import 'app_navigation.dart';
import 'artwork_detail_controller.dart';
import 'artwork_detail_media.dart';
import 'gallery_query.dart';
import 'media_grid_sheet.dart';
import 'media_thumbnail.dart';
import 'models.dart';
import 'reader_view.dart';
import 'storage.dart';

class ArtworkDetailView extends StatefulWidget {
  final MobileApi api;
  final AppStorage storage;
  final int artworkId;
  final int? initialMediaId;
  final ReaderEntry? entry;
  final bool initialPrivacy;
  final Future<void> Function() onLogout, onExpired;
  final Future<void> Function(GalleryQuery query)? onBrowseQuery;
  const ArtworkDetailView(
      {super.key,
      required this.api,
      required this.storage,
      required this.artworkId,
      this.initialMediaId,
      this.entry,
      this.initialPrivacy = false,
      required this.onLogout,
      required this.onExpired,
      this.onBrowseQuery});
  @override
  State<ArtworkDetailView> createState() => ArtworkDetailViewState();
}

class _DetailBlock {
  final String id;
  final List<MediaItem> items;
  const _DetailBlock(this.id, this.items);
}

class ArtworkDetailViewState extends State<ArtworkDetailView>
    with WidgetsBindingObserver {
  late final ArtworkDetailController c;
  late final Duration _visibilityInterval;
  @visibleForTesting
  ArtworkDetailController get debugController => c;
  @visibleForTesting
  int? get debugCurrentMediaId => _currentMediaId;
  final _itemScroll = ItemScrollController();
  final _offsetScroll = ScrollOffsetController();
  final _positions = ItemPositionsListener.create();
  final _timelineScroll = ScrollController();
  final Map<String, int> _stackPositions = {};
  bool _privacy = false, _allowPop = false, _leaving = false, _expiring = false;
  bool _resumeVisible = false, _auto = false, _autoBusy = false;
  int? _currentMediaId;
  int _currentBlock = 0, _autoSeconds = 5;
  String? _lastNotice;
  Timer? _resumeTimer, _autoTimer;
  DateTime? _autoReadyAt;
  int? _creatorId;
  String _dateMode = 'source';
  List<FeedItem> _neighbors = [];
  bool _neighborsLoading = false;
  String? _neighborsError;
  int _neighborEpoch = 0;

  List<_DetailBlock> get _blocks {
    final displayed = c.displayed;
    if (!c.stacked || c.reader!.stacks.isEmpty) {
      return displayed
          .map((item) => _DetailBlock('media-${item.id}', [item]))
          .toList();
    }
    final byId = {for (final item in displayed) item.id: item};
    return c.reader!.stacks
        .map((group) => _DetailBlock(
            group.id,
            group.mediaIds
                .where(byId.containsKey)
                .map((id) => byId[id]!)
                .toList()))
        .where((group) => group.items.isNotEmpty)
        .toList();
  }

  MediaItem _active(_DetailBlock block) => block
      .items[(_stackPositions[block.id] ?? 0).clamp(0, block.items.length - 1)];

  @override
  void initState() {
    super.initState();
    _visibilityInterval = VisibilityDetectorController.instance.updateInterval;
    if (_visibilityInterval > const Duration(milliseconds: 100)) {
      VisibilityDetectorController.instance.updateInterval =
          const Duration(milliseconds: 100);
    }
    _privacy = widget.initialPrivacy;
    c = ArtworkDetailController(widget.api, widget.artworkId)
      ..initialCount =
          (widget.storage.preferences.getInt('detail-initial-count') ?? 10)
              .clamp(1, 100)
      ..locating = widget.initialMediaId != null
      ..addListener(_changed);
    WidgetsBinding.instance.addObserver(this);
    _positions.itemPositions.addListener(_positionChanged);
    unawaited(_load());
  }

  Future<void> _load() async {
    _pauseAuto();
    await c.load();
    if (!mounted || c.reader == null || c.error != null) return;
    final data = c.reader!;
    _currentMediaId = data.media.isEmpty ? null : data.media.first.id;
    if (widget.initialMediaId != null) {
      WidgetsBinding.instance.addPostFrameCallback(
          (_) => _jumpToMedia(widget.initialMediaId!, animated: false));
    } else {
      final resume = data.resolvePosition(data.resumeId);
      if (data.resumeId != null && resume > 0) {
        setState(() => _resumeVisible = true);
        _resumeTimer?.cancel();
        _resumeTimer = Timer(const Duration(seconds: 8), () {
          if (mounted) setState(() => _resumeVisible = false);
        });
      }
    }
    if (c.detail!.creators.isNotEmpty) {
      _creatorId = c.detail!.creators.first.id;
      unawaited(_loadNeighbors());
    }
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    if (c.failureStatus == 401 || c.failureStatus == 403) {
      if (!_expiring) {
        _expiring = true;
        _pauseAuto();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) widget.onExpired();
        });
      }
    }
    if (c.error != null) _pauseAuto();
    if (c.notice != null && c.notice != _lastNotice) {
      _pauseAuto();
      _lastNotice = c.notice;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(c.notice!)));
        }
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _pauseAuto();
    c.setForeground(state == AppLifecycleState.resumed);
  }

  void _positionChanged() {
    if (!mounted || c.reader == null) return;
    final blocks = _blocks;
    final visible = _positions.itemPositions.value
        .where((p) =>
            p.index > 0 &&
            p.index <= blocks.length &&
            p.itemTrailingEdge > 0 &&
            p.itemLeadingEdge < 1)
        .toList();
    if (visible.isEmpty) return;
    visible.sort((a, b) {
      double distance(ItemPosition p) => p.itemLeadingEdge <= .5 &&
              p.itemTrailingEdge >= .5
          ? 0
          : min(
              (p.itemLeadingEdge - .5).abs(), (p.itemTrailingEdge - .5).abs());
      return distance(a).compareTo(distance(b));
    });
    final index = visible.first.index - 1;
    final id = _active(blocks[index]).id;
    if (_currentBlock != index || _currentMediaId != id) {
      setState(() {
        _currentBlock = index;
        _currentMediaId = id;
      });
      _autoReadyAt = null;
    }
  }

  Future<void> _jumpToMedia(int id, {bool animated = true}) async {
    final data = c.reader;
    if (data == null || data.media.isEmpty || !mounted) return;
    _pauseAuto();
    c.locating = true;
    final canonical = data.media[data.resolvePosition(id)].id;
    if (c.unreadOnly && !c.candidates.any((item) => item.id == canonical)) {
      c.toggleUnread();
    }
    c.expanded = true;
    final blocks = _blocks;
    final index = blocks
        .indexWhere((block) => block.items.any((item) => item.id == canonical));
    if (index < 0) {
      c.locating = false;
      c.emit();
      return;
    }
    _stackPositions[blocks[index].id] =
        blocks[index].items.indexWhere((item) => item.id == canonical);
    setState(() {
      _currentMediaId = canonical;
      _currentBlock = index;
      _resumeVisible = false;
    });
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    if (_itemScroll.isAttached) {
      if (animated && !MediaQuery.disableAnimationsOf(context)) {
        await _itemScroll.scrollTo(
            index: index + 1,
            alignment: .02,
            duration: const Duration(milliseconds: 320),
            curve: Curves.easeOutCubic);
      } else {
        _itemScroll.jumpTo(index: index + 1, alignment: .02);
      }
    }
    if (!mounted) return;
    c.locating = false;
    c.emit();
  }

  Future<void> _leave() async {
    if (_leaving) return;
    _leaving = true;
    _pauseAuto();
    c.setCovered(true);
    await c.flush();
    if (!mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.pop(context, Map<int, String>.from(c.readingUpdates));
      }
    });
  }

  ReaderEntry _readerEntry(int mediaId) => ReaderEntry(
      items:
          widget.entry?.items ?? [FeedItem(widget.artworkId, c.reader!.title)],
      query: widget.entry?.query ?? const GalleryQuery(),
      seed: widget.entry?.seed ?? Random().nextInt(2147483647),
      artworkId: widget.artworkId,
      mediaId: mediaId,
      nextPage: widget.entry?.nextPage,
      cursor: widget.entry?.cursor);

  Future<void> _preview(int id,
      {bool sameWork = true, bool original = false}) async {
    _pauseAuto();
    c.setCovered(true);
    await c.flush();
    if (!mounted) return;
    var lastId = id;
    final updates = await Navigator.push<Map<int, String>>(
        context,
        appPageRoute(
            ReaderView(
                api: widget.api,
                entry: _readerEntry(id),
                initialPrivacy: _privacy,
                initialHighQuality: original,
                sameWorkOnly: sameWork,
                mediaIds: sameWork
                    ? c.candidates.map((item) => item.id).toList()
                    : null,
                onPositionChanged: (mediaId) => lastId = mediaId,
                onOpenDetail: (artworkId, mediaId) =>
                    _openArtwork(artworkId, mediaId: mediaId),
                onBrowseQuery: widget.onBrowseQuery,
                onLogout: widget.onLogout,
                onExpired: widget.onExpired),
            fullscreen: true));
    if (!mounted) return;
    c.readingUpdates.addAll(updates ?? {});
    await c.refreshReading();
    if (!mounted) return;
    _privacy = widget.storage.preferences.getBool('privacy-mode') ?? _privacy;
    if (c.reader!.media
        .any((item) => item.id == lastId || item.members.contains(lastId))) {
      await _jumpToMedia(lastId, animated: false);
    }
    c.setCovered(false);
  }

  Future<void> _openArtwork(int artworkId, {int? mediaId}) async {
    final wasCovered = c.covered;
    _pauseAuto();
    c.setCovered(true);
    await c.flush();
    if (!mounted) return;
    final updates = await Navigator.push<Map<int, String>>(
        context,
        appPageRoute(ArtworkDetailView(
            api: widget.api,
            storage: widget.storage,
            artworkId: artworkId,
            initialMediaId: mediaId,
            initialPrivacy: _privacy,
            onLogout: widget.onLogout,
            onExpired: widget.onExpired,
            onBrowseQuery: widget.onBrowseQuery)));
    if (!mounted) return;
    c.readingUpdates.addAll(updates ?? {});
    c.setCovered(wasCovered);
  }

  Future<void> _browse(GalleryQuery query) async {
    if (widget.onBrowseQuery == null) return;
    final wasCovered = c.covered;
    _pauseAuto();
    c.setCovered(true);
    await c.flush();
    await widget.onBrowseQuery!(query);
    if (mounted) c.setCovered(wasCovered);
  }

  Future<T?> _sheet<T>(WidgetBuilder builder) async {
    _pauseAuto();
    c.setCovered(true);
    final value = await showModalBottomSheet<T>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: builder);
    if (mounted) c.setCovered(false);
    return value;
  }

  Future<void> _pickMedia() async {
    final data = c.reader;
    if (data == null || data.media.isEmpty) return;
    final chosen = await _sheet<int>((context) => MediaGridSheet(
        api: widget.api,
        reader: data,
        current: data.resolvePosition(_currentMediaId),
        privacy: _privacy,
        onFailure: c.fail));
    if (chosen != null && mounted) await _jumpToMedia(data.media[chosen].id);
  }

  Future<void> _rating() async {
    var value = c.reader!.rating ?? 0;
    await _sheet<void>((context) => StatefulBuilder(
        builder: (context, update) => SafeArea(
            child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('作品评分',
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 16),
                      Text(_ratingLabel(value),
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.titleMedium),
                      Slider(
                          value: value.toDouble(),
                          max: 4,
                          divisions: 4,
                          label: _ratingLabel(value),
                          onChanged: (next) =>
                              update(() => value = next.round()),
                          onChangeEnd: (next) async {
                            await c.setRating(next == 0 ? null : next.round());
                            if (context.mounted) {
                              update(() => value = c.reader?.rating ?? 0);
                            }
                          }),
                      Wrap(alignment: WrapAlignment.spaceBetween, children: [
                        for (var level = 0; level <= 4; level++)
                          TextButton(
                              onPressed: c.savingRating
                                  ? null
                                  : () async {
                                      update(() => value = level);
                                      await c
                                          .setRating(level == 0 ? null : level);
                                      if (context.mounted) {
                                        update(() =>
                                            value = c.reader?.rating ?? 0);
                                      }
                                    },
                              child: Text(_ratingLabel(level)))
                      ]),
                      if (c.notice != null)
                        Text(c.notice!,
                            style: TextStyle(
                                color: Theme.of(context).colorScheme.error)),
                      const SizedBox(height: 12),
                      FilledButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('完成')),
                    ])))));
  }

  String _ratingLabel(int? level) => switch (level) {
        1 => '一般',
        2 => '喜欢',
        3 => '超爱',
        4 => '夯爆了',
        _ => '未评分',
      };

  Future<void> _mediaActions(MediaItem item) async {
    _pauseAuto();
    c.setCovered(true);
    await c.ensureMedia(item);
    if (!mounted) return;
    final action = await _sheet<String>((context) => AnimatedBuilder(
        animation: c,
        builder: (context, _) {
          final bookmarked = c.markValue(item.id, 'bookmark');
          final liked = c.markValue(item.id, 'like');
          return SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(
                title: Text('第 ${item.index + 1} 张',
                    style: Theme.of(context).textTheme.titleLarge)),
            ListTile(
                leading:
                    Icon(bookmarked ? Icons.bookmark : Icons.bookmark_border),
                title: Text(bookmarked ? '取消书签' : '添加书签'),
                onTap: () => c.setMark(item.id, 'bookmark', !bookmarked)),
            ListTile(
                leading: Icon(liked ? Icons.favorite : Icons.favorite_border),
                title: Text(liked ? '取消单图喜欢' : '喜欢这张图片'),
                onTap: () => c.setMark(item.id, 'like', !liked)),
            if (!c.reader!.seen.contains(item.id))
              ListTile(
                  leading: const Icon(Icons.done),
                  title: const Text('标为已读'),
                  onTap: () => c.markRead(mediaId: item.id)),
            ListTile(
                leading: const Icon(Icons.fullscreen),
                title: const Text('适配预览'),
                onTap: () => Navigator.pop(context, 'preview')),
            if (!item.video)
              ListTile(
                  leading: const Icon(Icons.photo_size_select_large),
                  title: const Text('查看原始文件'),
                  onTap: () => Navigator.pop(context, 'original')),
            ListTile(
                leading: const Icon(Icons.play_circle_outline),
                title: Text(c.stacked ? '自动翻阅' : '自动滚动'),
                onTap: () => Navigator.pop(context, 'auto')),
            if (c.notice != null)
              Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                  child: Text(c.notice!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error))),
            const SizedBox(height: 16),
          ]));
        }));
    if (!mounted) return;
    if (action == 'preview') await _preview(item.id);
    if (action == 'original') await _preview(item.id, original: true);
    if (action == 'auto') _startAuto();
  }

  Future<void> _more() async {
    final action = await _sheet<String>((context) => SafeArea(
            child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
              title:
                  Text('作品操作', style: Theme.of(context).textTheme.titleLarge)),
          ListTile(
              leading: const Icon(Icons.filter_alt_outlined),
              title: Text(c.unreadOnly ? '查看全部' : '只看未读'),
              onTap: () => Navigator.pop(context, 'unread')),
          if (c.unreadOnly)
            ListTile(
                leading: const Icon(Icons.refresh),
                title: const Text('刷新未读'),
                subtitle: const Text('按最新阅读记录更新当前列表'),
                onTap: () => Navigator.pop(context, 'refresh-unread')),
          ListTile(
              leading: const Icon(Icons.done_all),
              title: const Text('标记全部已读'),
              enabled:
                  !c.marking && c.reader!.seen.length < c.reader!.media.length,
              onTap: () => Navigator.pop(context, 'mark-all')),
          ListTile(
              leading: const Icon(Icons.play_circle_outline),
              title: Text(c.stacked ? '自动翻阅' : '自动滚动'),
              onTap: () => Navigator.pop(context, 'auto')),
          ListTile(
              leading: const Icon(Icons.tune),
              title: const Text('阅读设置'),
              onTap: () => Navigator.pop(context, 'settings')),
          ListTile(
              leading: const Icon(Icons.refresh),
              title: const Text('重新加载'),
              onTap: () => Navigator.pop(context, 'reload')),
          const SizedBox(height: 16),
        ]))));
    if (!mounted) return;
    if (action == 'unread') {
      c.toggleUnread();
      _top();
    }
    if (action == 'refresh-unread') {
      await c.refreshUnread();
      _top();
    }
    if (action == 'mark-all') await c.markRead();
    if (action == 'auto') _startAuto();
    if (action == 'settings') await _settings();
    if (action == 'reload') await _load();
  }

  Future<void> _settings() async {
    await _sheet<void>((context) => StatefulBuilder(
        builder: (context, update) => SafeArea(
            child: SingleChildScrollView(
                child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('阅读设置',
                              style: Theme.of(context).textTheme.titleLarge),
                          const SizedBox(height: 16),
                          SwitchListTile(
                              contentPadding: EdgeInsets.zero,
                              title: const Text('隐私遮蔽'),
                              value: _privacy,
                              onChanged: (v) {
                                update(() => _privacy = v);
                                setState(() {});
                                widget.storage.changePrivacy(v);
                              }),
                          Text('首次展示 ${c.initialCount} 张'),
                          Slider(
                              value: c.initialCount.toDouble(),
                              min: 1,
                              max: 100,
                              divisions: 99,
                              label: '${c.initialCount}',
                              onChanged: (v) =>
                                  update(() => c.initialCount = v.round()),
                              onChangeEnd: (v) {
                                widget.storage.preferences
                                    .setInt('detail-initial-count', v.round());
                                c.emit();
                              }),
                          const SizedBox(height: 12),
                          const Text('自动翻阅间隔'),
                          Wrap(spacing: 8, children: [
                            for (final seconds in [3, 5, 10, 15])
                              ChoiceChip(
                                  label: Text('$seconds 秒'),
                                  selected: _autoSeconds == seconds,
                                  onSelected: (_) =>
                                      update(() => _autoSeconds = seconds))
                          ]),
                        ]))))));
  }

  Future<void> _top() async {
    _pauseAuto();
    if (_itemScroll.isAttached) {
      c.locating = true;
      c.emit();
      try {
        await _itemScroll.scrollTo(
            index: 0,
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 300),
            curve: Curves.easeOutCubic);
      } finally {
        c.locating = false;
        c.emit();
      }
    }
  }

  void _toggleStack() {
    final id = _currentMediaId;
    _pauseAuto();
    c.stacked = !c.stacked;
    c.emit();
    if (id != null) unawaited(_jumpToMedia(id, animated: false));
  }

  void _pauseAuto() {
    _autoTimer?.cancel();
    _autoTimer = null;
    _autoReadyAt = null;
    if (_auto && mounted) {
      setState(() => _auto = false);
    } else {
      _auto = false;
    }
  }

  void _startAuto() {
    if (c.reader == null || c.candidates.isEmpty || c.error != null) return;
    c.expanded = true;
    setState(() => _auto = true);
    _autoReadyAt = null;
    _autoTimer?.cancel();
    _autoTimer =
        Timer.periodic(const Duration(milliseconds: 100), (_) => _autoTick());
  }

  Future<void> _autoTick() async {
    if (!_auto || _autoBusy || !mounted || !c.canObserve) return;
    final blocks = _blocks;
    if (blocks.isEmpty) {
      _pauseAuto();
      return;
    }
    final block = blocks[_currentBlock.clamp(0, blocks.length - 1)];
    final item = _active(block);
    final hasVisibleMedia = _positions.itemPositions.value.any((p) =>
        p.index > 0 &&
        p.index <= blocks.length &&
        p.itemLeadingEdge < .8 &&
        p.itemTrailingEdge > 0);
    if (!hasVisibleMedia && _itemScroll.isAttached) {
      _autoBusy = true;
      c.locating = true;
      c.emit();
      try {
        await _itemScroll.scrollTo(
            index: _currentBlock + 1,
            duration: const Duration(milliseconds: 300),
            alignment: .02);
      } finally {
        _autoBusy = false;
        c.locating = false;
        c.emit();
      }
      return;
    }
    if (item.video
        ? !c.finishedVideos.contains(item.id)
        : !c.isReady(item.id)) {
      return;
    }
    if (c.stacked || item.video) {
      _autoReadyAt ??= DateTime.now();
      if (!item.video &&
          DateTime.now().difference(_autoReadyAt!).inSeconds < _autoSeconds) {
        return;
      }
      if (_currentBlock >= blocks.length - 1) {
        _pauseAuto();
        return;
      }
      _autoBusy = true;
      c.locating = true;
      c.emit();
      try {
        await _itemScroll.scrollTo(
            index: _currentBlock + 2,
            duration: const Duration(milliseconds: 350),
            alignment: .02,
            curve: Curves.easeOutCubic);
      } finally {
        _autoBusy = false;
        _autoReadyAt = null;
        c.locating = false;
        c.emit();
      }
    } else {
      final last = _positions.itemPositions.value
          .where((p) => p.index == blocks.length + 1);
      if (last.isNotEmpty && last.first.itemLeadingEdge < .8) {
        _pauseAuto();
        return;
      }
      _autoBusy = true;
      try {
        await _offsetScroll.animateScroll(
            offset: 4.8,
            duration: const Duration(milliseconds: 100),
            curve: Curves.linear);
      } finally {
        _autoBusy = false;
      }
    }
  }

  Future<void> _loadNeighbors({String direction = 'both'}) async {
    final creator = _creatorId;
    if (creator == null) return;
    final epoch = ++_neighborEpoch;
    setState(() {
      _neighborsLoading = true;
      _neighborsError = null;
    });
    try {
      final pivot = direction == 'older' && _neighbors.isNotEmpty
          ? _neighbors.last.id
          : direction == 'newer' && _neighbors.isNotEmpty
              ? _neighbors.first.id
              : widget.artworkId;
      final result = await widget.api.neighbors(pivot, creator,
          direction: direction, dateMode: _dateMode, limit: 8);
      if (!mounted || epoch != _neighborEpoch) return;
      setState(() {
        if (direction == 'both') {
          _neighbors = result;
        } else {
          final combined = direction == 'newer'
              ? [...result, ..._neighbors]
              : [..._neighbors, ...result];
          final ids = <int>{};
          _neighbors = combined.where((v) => ids.add(v.id)).take(80).toList();
        }
      });
      if (direction == 'both') {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted ||
              !_timelineScroll.hasClients ||
              epoch != _neighborEpoch) {
            return;
          }
          final current =
              _neighbors.indexWhere((item) => item.id == widget.artworkId);
          if (current < 0) return;
          final offset = current * 124.0 -
              (MediaQuery.sizeOf(context).width - 40 - 112) / 2;
          _timelineScroll.jumpTo(
              offset.clamp(0, _timelineScroll.position.maxScrollExtent));
        });
      }
    } catch (e) {
      if (mounted && epoch == _neighborEpoch) {
        setState(
            () => _neighborsError = e is ApiFailure ? e.message : '相邻作品加载失败');
      }
    } finally {
      if (mounted && epoch == _neighborEpoch) {
        setState(() => _neighborsLoading = false);
      }
    }
  }

  Future<void> _source(ArtworkSource source) async {
    final uri = Uri.tryParse(source.url);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return;
    }
    _pauseAuto();
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
          mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('无法打开原站链接')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('无法打开原站链接')));
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _positions.itemPositions.removeListener(_positionChanged);
    _timelineScroll.dispose();
    VisibilityDetectorController.instance.updateInterval = _visibilityInterval;
    _resumeTimer?.cancel();
    _autoTimer?.cancel();
    c.removeListener(_changed);
    c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = c.reader, detail = c.detail;
    final blocks = data == null ? <_DetailBlock>[] : _blocks;
    return PopScope(
        canPop: _allowPop,
        onPopInvokedWithResult: (didPop, result) {
          if (!didPop) _leave();
        },
        child: AnnotatedRegion<SystemUiOverlayStyle>(
            value: AppTheme.lightBars,
            child: Scaffold(
              appBar: AppBar(
                  leading: IconButton(
                      tooltip: '返回作品列表',
                      icon: const Icon(Icons.arrow_back),
                      onPressed: _leave),
                  title: Text(_privacy ? '作品详情' : detail?.title ?? '作品详情',
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                  actions: [
                    IconButton(
                        tooltip: '沉浸浏览',
                        onPressed: data == null || data.media.isEmpty
                            ? null
                            : () => _preview(
                                _currentMediaId ?? data.media.first.id,
                                sameWork: false),
                        icon: const Icon(Icons.slideshow_outlined)),
                    IconButton(
                        tooltip: '作品操作',
                        onPressed: data == null ? null : _more,
                        icon: const Icon(Icons.more_horiz)),
                  ]),
              body: c.loading
                  ? const Center(child: CircularProgressIndicator())
                  : c.error != null
                      ? _errorState(c.error!)
                      : data == null || detail == null
                          ? _errorState('作品不存在')
                          : Listener(
                              onPointerDown: (_) => _pauseAuto(),
                              child: Column(children: [
                                if (_resumeVisible && data.resumeId != null)
                                  _resume(data),
                                if (_auto) _autoBar(),
                                Expanded(
                                    child: ScrollablePositionedList.builder(
                                        key: ValueKey('detail-list-${data.id}'),
                                        itemScrollController: _itemScroll,
                                        scrollOffsetController: _offsetScroll,
                                        itemPositionsListener: _positions,
                                        minCacheExtent: 250,
                                        itemCount: blocks.length + 2,
                                        padding:
                                            const EdgeInsets.only(bottom: 24),
                                        itemBuilder: (context, index) {
                                          if (index == 0) {
                                            return _header(detail, data);
                                          }
                                          if (index == blocks.length + 1) {
                                            return _footer(detail, data);
                                          }
                                          final block = blocks[index - 1],
                                              item = _active(block);
                                          return Padding(
                                              key: ValueKey(
                                                  'detail-block-${block.id}'),
                                              padding: c.stacked
                                                  ? const EdgeInsets.fromLTRB(
                                                      12, 0, 12, 16)
                                                  : EdgeInsets.zero,
                                              child: Column(children: [
                                                if (c.stacked &&
                                                    block.items.length > 1)
                                                  _stackHeader(block),
                                                ArtworkDetailMedia(
                                                    key: ValueKey(
                                                        'detail-media-${block.id}'),
                                                    controller: c,
                                                    item: item,
                                                    privacy: _privacy,
                                                    playbackActive: index - 1 ==
                                                        _currentBlock,
                                                    onPreview: () =>
                                                        _preview(item.id),
                                                    onActions: () =>
                                                        _mediaActions(item),
                                                    onTurn: !c.stacked ||
                                                            block.items.length <
                                                                2
                                                        ? null
                                                        : (delta) => _changeStack(
                                                            block,
                                                            ((_stackPositions[block.id] ??
                                                                        0) +
                                                                    delta)
                                                                .clamp(
                                                                    0,
                                                                    block.items
                                                                            .length -
                                                                        1)),
                                                    onReady: () {},
                                                    onFailure: (failure) {
                                                      _pauseAuto();
                                                      c.fail(failure);
                                                    }),
                                              ]));
                                        })),
                              ])),
              bottomNavigationBar: data == null || c.loading || c.error != null
                  ? null
                  : _bottomBar(data),
            )));
  }

  Widget _errorState(String message) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 36),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center),
            TextButton(onPressed: _load, child: const Text('重新加载'))
          ])));

  Widget _resume(ReaderData data) => Material(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Row(children: [
            Expanded(
                child:
                    Text('上次看到第 ${data.resolvePosition(data.resumeId) + 1} 张')),
            TextButton(
                onPressed: () => _jumpToMedia(data.resumeId!),
                child: const Text('继续')),
            IconButton(
                tooltip: '从头开始',
                onPressed: () => setState(() => _resumeVisible = false),
                icon: const Icon(Icons.close)),
          ])));
  Widget _autoBar() => Material(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Row(children: [
        const SizedBox(width: 16),
        const Icon(Icons.play_arrow, size: 20),
        const SizedBox(width: 8),
        Expanded(child: Text(c.stacked ? '正在自动翻阅' : '正在自动滚动')),
        TextButton(onPressed: _pauseAuto, child: const Text('暂停'))
      ]));

  Widget _header(ArtworkDetailData detail, ReaderData data) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_privacy ? '内容已遮蔽' : detail.title,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (!_privacy)
          Wrap(spacing: 8, children: [
            for (final creator in detail.creators)
              TextButton.icon(
                  icon: Icon(
                      creator.kind == 'GROUP'
                          ? Icons.groups_outlined
                          : Icons.account_circle_outlined,
                      size: 24),
                  label: Text(creator.name),
                  onPressed: () => _browse(GalleryQuery(
                      artistId: creator.id, artistName: creator.name)))
          ]),
        const SizedBox(height: 8),
        Text(
            '${_date(detail.sourceDate ?? detail.createdAt)} · ${data.media.length} 张${detail.totalMediaSize > 0 ? ' · ${_size(detail.totalMediaSize)}' : ''}',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: AppTheme.muted)),
        if (!_privacy && detail.tags.isNotEmpty)
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Wrap(spacing: 8, runSpacing: 4, children: [
                for (final tag in detail.tags)
                  ActionChip(
                      label: Text(tag.label),
                      onPressed: () => _browse(GalleryQuery(
                          tagIds: [tag.id], tagLabels: [tag.label])))
              ])),
        const SizedBox(height: 16),
        _reading(data),
        if (c.unreadOnly)
          Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [
                Expanded(
                    child: Text('只看未读 · 本轮 ${c.candidates.length} 张',
                        style: Theme.of(context).textTheme.bodySmall)),
                TextButton(
                    onPressed: c.refreshUnread, child: const Text('刷新未读'))
              ])),
        if (data.media.isEmpty)
          const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Text('作品还没有媒体')),
        if (data.media.isNotEmpty && c.candidates.isEmpty)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(children: [
                const Text('本轮未读已经全部看完'),
                TextButton(onPressed: c.toggleUnread, child: const Text('查看全部'))
              ])),
      ]));

  Widget _reading(ReaderData data, {bool markAll = false}) => Row(children: [
        Expanded(
            child: Wrap(spacing: 12, runSpacing: 6, children: [
          Text('已读 ${data.seen.length} / ${data.media.length}',
              style: Theme.of(context).textTheme.bodySmall),
          Text('剩余 ${max(0, data.media.length - data.seen.length)}',
              style: Theme.of(context).textTheme.bodySmall),
          if (data.summary.viewCount > 0)
            Text('阅读 ${data.summary.viewCount} 次',
                style: Theme.of(context).textTheme.bodySmall),
        ])),
        if (markAll)
          IconButton(
              tooltip: '标记全部已读',
              onPressed: c.marking || data.seen.length >= data.media.length
                  ? null
                  : () => c.markRead(),
              icon: const Icon(Icons.done_all)),
      ]);

  Widget _stackHeader(_DetailBlock block) {
    final position =
        (_stackPositions[block.id] ?? 0).clamp(0, block.items.length - 1);
    return Material(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
        child: Row(children: [
          const SizedBox(width: 12),
          const Icon(Icons.layers_outlined, size: 18),
          const SizedBox(width: 8),
          Expanded(
              child: Text(
                  '第 ${block.items.first.index + 1}–${block.items.last.index + 1} 张 · ${position + 1}/${block.items.length}',
                  style: Theme.of(context).textTheme.bodySmall)),
          IconButton(
              tooltip: '上一张',
              onPressed: position == 0
                  ? null
                  : () => _changeStack(block, position - 1),
              icon: const Icon(Icons.chevron_left)),
          IconButton(
              tooltip: '下一张',
              onPressed: position == block.items.length - 1
                  ? null
                  : () => _changeStack(block, position + 1),
              icon: const Icon(Icons.chevron_right)),
        ]));
  }

  void _changeStack(_DetailBlock block, int position) {
    _pauseAuto();
    setState(() {
      _stackPositions[block.id] = position;
      _currentMediaId = block.items[position].id;
    });
    HapticFeedback.selectionClick();
  }

  Widget _footer(ArtworkDetailData detail, ReaderData data) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (c.canCollapse && !c.stacked)
          OutlinedButton.icon(
              onPressed: () {
                _pauseAuto();
                setState(() => c.expanded = !c.expanded);
              },
              icon: Icon(c.expanded ? Icons.unfold_less : Icons.unfold_more),
              label: Text(c.expanded
                  ? '收起到 ${c.initialCount} 张'
                  : '展开全部 ${c.candidates.length} 张')),
        const SizedBox(height: 16),
        _reading(data, markAll: true),
        if (!_privacy && detail.description?.trim().isNotEmpty == true) ...[
          const Divider(height: 40),
          SelectableText(detail.description!,
              style: Theme.of(context).textTheme.bodyMedium),
        ],
        if (!_privacy && detail.sources.isNotEmpty)
          Wrap(spacing: 8, children: [
            for (final source in detail.sources)
              TextButton.icon(
                  onPressed: () => _source(source),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: Text(source.label))
          ]),
        if (detail.series.isNotEmpty) ...[
          const Divider(height: 40),
          for (final series in detail.series) _series(series),
        ],
        if (detail.creators.isNotEmpty) ...[
          const Divider(height: 40),
          _timeline(detail),
        ],
      ]));

  Widget _series(ArtworkSeries series) => Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_privacy ? '系列' : series.title,
            style: Theme.of(context).textTheme.titleMedium),
        if (series.order != null)
          Text('第 ${series.order} 话',
              style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
              child: OutlinedButton.icon(
                  onPressed: series.prev == null
                      ? null
                      : () => _openArtwork(series.prev!.id),
                  icon: const Icon(Icons.chevron_left),
                  label: const Text('上一篇'))),
          const SizedBox(width: 12),
          Expanded(
              child: OutlinedButton.icon(
                  onPressed: series.next == null
                      ? null
                      : () => _openArtwork(series.next!.id),
                  icon: const Icon(Icons.chevron_right),
                  label: const Text('下一篇'))),
        ]),
      ]));

  Widget _timeline(ArtworkDetailData detail) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('作者的相邻作品', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        if (detail.creators.length > 1)
          Wrap(spacing: 8, children: [
            for (final creator in detail.creators)
              ChoiceChip(
                  label: Text(_privacy
                      ? '创作者 ${detail.creators.indexOf(creator) + 1}'
                      : creator.name),
                  selected: _creatorId == creator.id,
                  onSelected: (_) {
                    _creatorId = creator.id;
                    _loadNeighbors();
                  })
          ]),
        Row(children: [
          ChoiceChip(
              label: const Text('原始时间'),
              selected: _dateMode == 'source',
              onSelected: (_) {
                _dateMode = 'source';
                _loadNeighbors();
              }),
          const SizedBox(width: 8),
          ChoiceChip(
              label: const Text('入库时间'),
              selected: _dateMode == 'created',
              onSelected: (_) {
                _dateMode = 'created';
                _loadNeighbors();
              }),
        ]),
        const SizedBox(height: 12),
        if (_neighborsError != null)
          TextButton(
              onPressed: _loadNeighbors, child: Text('$_neighborsError · 重试')),
        if (_neighborsLoading && _neighbors.isEmpty)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
        if (_neighbors.isNotEmpty)
          SizedBox(
              height: 200,
              child: ListView.separated(
                  controller: _timelineScroll,
                  scrollDirection: Axis.horizontal,
                  itemCount: _neighbors.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 12),
                  itemBuilder: (context, index) {
                    final item = _neighbors[index];
                    return SizedBox(
                        width: 112,
                        child: InkWell(
                            onTap: item.id == widget.artworkId
                                ? null
                                : () => _openArtwork(item.id),
                            borderRadius: BorderRadius.circular(12),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Expanded(
                                      child: ClipRRect(
                                          borderRadius:
                                              BorderRadius.circular(12),
                                          child: MediaThumbnail(
                                              api: widget.api,
                                              path: item.cover,
                                              revision: item.revision,
                                              privacy: _privacy,
                                              onFailure: c.fail))),
                                  const SizedBox(height: 8),
                                  Text(
                                      item.id == widget.artworkId
                                          ? '当前作品'
                                          : _privacy
                                              ? '内容已遮蔽'
                                              : item.title,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall),
                                ])));
                  })),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          TextButton.icon(
              onPressed: _neighborsLoading
                  ? null
                  : () => _loadNeighbors(direction: 'newer'),
              icon: const Icon(Icons.chevron_left),
              label: const Text('更新作品')),
          TextButton.icon(
              onPressed: _neighborsLoading
                  ? null
                  : () => _loadNeighbors(direction: 'older'),
              icon: const Icon(Icons.chevron_right),
              label: const Text('更早作品')),
        ]),
      ]);

  Widget _bottomBar(ReaderData data) {
    final position =
        data.media.indexWhere((item) => item.id == _currentMediaId);
    return Material(
        color: Theme.of(context).colorScheme.surface,
        child: SafeArea(
            top: false,
            child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Row(children: [
                  TextButton.icon(
                      onPressed: data.media.isEmpty ? null : _pickMedia,
                      icon: const Icon(Icons.grid_view_outlined, size: 18),
                      label: Text(
                          '${max(0, position) + 1} / ${data.media.length}')),
                  const Spacer(),
                  IconButton(
                      tooltip: '回到顶部',
                      onPressed: _top,
                      icon: const Icon(Icons.vertical_align_top)),
                  IconButton(
                      tooltip: c.stacked ? '切换完整浏览' : '切换堆叠浏览',
                      onPressed: data.stacks.isEmpty ? null : _toggleStack,
                      icon: Icon(c.stacked
                          ? Icons.view_agenda_outlined
                          : Icons.layers_outlined),
                      color: c.stacked ? AppTheme.blue : null),
                  IconButton(
                      tooltip: '作品评分：${_ratingLabel(data.rating)}',
                      onPressed: _rating,
                      icon: Icon(
                          data.liked ? Icons.favorite : Icons.favorite_border),
                      color: data.liked ? AppTheme.blue : null),
                ]))));
  }

  String _date(String? raw) {
    final date = raw == null ? null : DateTime.tryParse(raw)?.toLocal();
    return date == null
        ? '时间未知'
        : '${date.year}.${date.month.toString().padLeft(2, '0')}.${date.day.toString().padLeft(2, '0')}';
  }

  String _size(num bytes) => bytes >= 1024 * 1024 * 1024
      ? '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB'
      : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
