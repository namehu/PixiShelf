import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'api.dart';
import 'app_theme.dart';
import 'models.dart';
import 'storage.dart';
import 'gallery_controller.dart';
import 'gallery_query.dart';
import 'gallery_filters.dart';
import 'media_thumbnail.dart';
import 'privacy_prompt.dart';
import 'reader_view.dart';

class GalleryView extends StatefulWidget {
  final MobileApi api;
  final AppStorage storage;
  final Future<void> Function() onLogout, onExpired;
  const GalleryView(
      {super.key,
      required this.api,
      required this.storage,
      required this.onLogout,
      required this.onExpired});
  @override
  State<GalleryView> createState() => _GalleryViewState();
}

class _GalleryViewState extends State<GalleryView> {
  late final GalleryController _gallery;
  late final TextEditingController _search;
  final _scroll = ScrollController();
  bool _confirmed = false, _privacy = true, _expired = false, _opening = false;
  @override
  void initState() {
    super.initState();
    _gallery = GalleryController(widget.api, widget.storage)
      ..addListener(_changed);
    _search = TextEditingController(text: _gallery.query.search);
    _scroll.addListener(_nearEnd);
    WidgetsBinding.instance.addPostFrameCallback((_) => _enter());
  }

  Future<void> _enter() async {
    final privacy = await confirmGalleryPrivacy(context, widget.storage);
    if (!mounted || privacy == null) return;
    setState(() {
      _privacy = privacy;
      _confirmed = true;
    });
    await _gallery.start();
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    if (_gallery.failureStatus == 401 || _gallery.failureStatus == 403) {
      _expire();
    }
  }

  void _expire() {
    if (_expired || !mounted) return;
    _expired = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _accountExit(expired: true);
    });
  }

  void _thumbnailFailure(ApiFailure failure) {
    if (failure.status == 401 || failure.status == 403) _expire();
  }

  void _nearEnd() {
    if (_scroll.hasClients &&
        _scroll.position.extentAfter < 600 &&
        !_gallery.loading &&
        _gallery.pageError == null &&
        _gallery.error == null) {
      unawaited(_gallery.loadMore());
    }
  }

  Future<void> _apply(GalleryQuery query) async {
    _search.text = query.search;
    if (_scroll.hasClients) _scroll.jumpTo(0);
    await _gallery.start(filters: query);
  }

  Future<void> _filter() async {
    final query = await showGalleryFilters(
        context, _gallery.query.copyWith(search: _search.text.trim()));
    if (mounted && query != null) await _apply(query);
  }

  Future<void> _accountExit({bool expired = false}) async {
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (expired) {
      await widget.onExpired();
    } else {
      await widget.onLogout();
    }
  }

  Future<void> _open(ReaderEntry entry) async {
    if (_opening || !_confirmed) return;
    _opening = true;
    FocusManager.instance.primaryFocus?.unfocus();
    try {
      final updates = await Navigator.of(context).push<Map<int, String>>(
          MaterialPageRoute(
              builder: (_) => ReaderView(
                  api: widget.api,
                  entry: entry,
                  initialPrivacy: _privacy,
                  onLogout: () => _accountExit(),
                  onExpired: () => _accountExit(expired: true))));
      if (!mounted) return;
      _gallery.updateReading(updates ?? {});
      setState(() => _privacy =
          widget.storage.preferences.getBool('privacy-mode') ?? _privacy);
    } finally {
      _opening = false;
    }
  }

  void _continue() {
    final saved = widget.storage.position(widget.api.session.scope);
    if (saved == null || saved['artworkId'] is! int) return;
    final query = saved['filters'] is Map
        ? GalleryQuery.fromJson(
            Map<String, dynamic>.from(saved['filters'] as Map))
        : GalleryQuery(
            search: saved['search'] as String? ?? '',
            sortBy: saved['mode'] == 'random' ? 'random' : 'created_at_desc');
    _open(ReaderEntry(
        items: const [],
        query: query,
        seed: Random().nextInt(2147483647),
        nextPage: 1,
        artworkId: saved['artworkId'] as int,
        mediaId: saved['mediaId'] as int?));
  }

  Future<void> _settings() async {
    final action = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        builder: (context) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                    title: Text('图库设置',
                        style: Theme.of(context).textTheme.titleLarge),
                    subtitle: Text(widget.api.session.server)),
                SwitchListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                    title: const Text('隐私遮蔽'),
                    value: _privacy,
                    onChanged: (_) => Navigator.pop(context, 'privacy')),
                ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                    leading: const Icon(Icons.logout),
                    title: const Text('退出账户／更换服务器'),
                    onTap: () => Navigator.pop(context, 'logout')),
                const SizedBox(height: 16),
              ]),
            ));
    if (!mounted) return;
    if (action == 'privacy') {
      setState(() => _privacy = !_privacy);
      await widget.storage.changePrivacy(_privacy);
    }
    if (action == 'logout') await _accountExit();
  }

  @override
  void dispose() {
    _gallery.removeListener(_changed);
    _gallery.dispose();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _gallery.query;
    final saved = widget.storage.position(widget.api.session.scope);
    return Scaffold(
      appBar: AppBar(
          title: const Text('作品'),
          backgroundColor: AppTheme.canvas,
          surfaceTintColor: Colors.transparent,
          actions: [
            IconButton(
                tooltip: '沉浸浏览',
                onPressed: !_confirmed || _gallery.items.isEmpty
                    ? null
                    : () => _open(_gallery.entry(_gallery.items.first.id)),
                icon: const Icon(Icons.slideshow_outlined)),
            IconButton(
                tooltip: '筛选作品',
                onPressed: _confirmed ? _filter : null,
                icon: Badge(
                    isLabelVisible: query.active,
                    smallSize: 6,
                    child: const Icon(Icons.tune))),
            IconButton(
                tooltip: '图库设置',
                onPressed: _confirmed ? _settings : null,
                icon: const Icon(Icons.more_horiz)),
          ]),
      body: !_confirmed
          ? const SizedBox.expand()
          : Column(children: [
              Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                  child: TextField(
                      controller: _search,
                      maxLength: 200,
                      textInputAction: TextInputAction.search,
                      onSubmitted: (v) =>
                          _apply(query.copyWith(search: v.trim())),
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                          counterText: '',
                          hintText: '搜索作品、艺术家或标签',
                          prefixIcon: const Icon(Icons.search),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 12),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  tooltip: '清除关键词',
                                  onPressed: () =>
                                      _apply(query.copyWith(search: '')),
                                  icon: const Icon(Icons.close, size: 20))))),
              if (query.active)
                SizedBox(
                    height: 52,
                    child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        children: [
                          if (query.search.isNotEmpty)
                            _chip(_privacy ? '关键词已隐藏' : '关键词：${query.search}',
                                () => _apply(query.copyWith(search: ''))),
                          if (query.sortBy != 'source_date_desc')
                            _chip(
                                gallerySorts[query.sortBy]!,
                                () => _apply(query.copyWith(
                                    sortBy: 'source_date_desc'))),
                          if (query.mediaType != 'all')
                            _chip(galleryMediaTypes[query.mediaType]!,
                                () => _apply(query.copyWith(mediaType: 'all'))),
                          if (query.readingStatus != 'all')
                            _chip(
                                galleryReadingStates[query.readingStatus]!,
                                () => _apply(
                                    query.copyWith(readingStatus: 'all'))),
                          if (query.likedOnly)
                            _chip('我的喜欢',
                                () => _apply(query.copyWith(likedOnly: false))),
                        ])),
              Expanded(
                  child: RefreshIndicator(
                      onRefresh: () => _gallery.start(),
                      child: LayoutBuilder(builder: (context, constraints) {
                        final columns = constraints.maxWidth >= 900
                            ? 4
                            : constraints.maxWidth >= 600
                                ? 3
                                : 2;
                        final width =
                            (constraints.maxWidth - 32 - (columns - 1) * 12) /
                                columns;
                        final textScale =
                            MediaQuery.textScalerOf(context).scale(14) / 14;
                        return CustomScrollView(
                            controller: _scroll,
                            key: const PageStorageKey('gallery'),
                            physics: const AlwaysScrollableScrollPhysics(),
                            slivers: [
                              if (saved != null && saved['artworkId'] is int)
                                SliverToBoxAdapter(
                                    child: Padding(
                                        padding: const EdgeInsets.fromLTRB(
                                            16, 0, 16, 12),
                                        child: TextButton(
                                            onPressed: _continue,
                                            style: TextButton.styleFrom(
                                                alignment: Alignment.centerLeft,
                                                minimumSize:
                                                    const Size(48, 48)),
                                            child: Row(children: [
                                              const Icon(Icons.history,
                                                  size: 20),
                                              const SizedBox(width: 8),
                                              Expanded(
                                                  child: Text(
                                                      _privacy ||
                                                              saved['title'] ==
                                                                  null
                                                          ? '继续上次浏览'
                                                          : '继续上次：${saved['title']}',
                                                      maxLines: 1,
                                                      overflow: TextOverflow
                                                          .ellipsis)),
                                              const Icon(Icons.chevron_right,
                                                  size: 20)
                                            ])))),
                              if (_gallery.loading)
                                const SliverFillRemaining(
                                    hasScrollBody: false,
                                    child: Center(
                                        child: CircularProgressIndicator()))
                              else if (_gallery.items.isEmpty)
                                SliverFillRemaining(
                                    hasScrollBody: false, child: _empty())
                              else ...[
                                SliverPadding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 16),
                                    sliver: SliverGrid(
                                        gridDelegate:
                                            SliverGridDelegateWithFixedCrossAxisCount(
                                                crossAxisCount: columns,
                                                mainAxisExtent: width * 4 / 3 +
                                                    68 * textScale,
                                                crossAxisSpacing: 12,
                                                mainAxisSpacing: 16),
                                        delegate: SliverChildBuilderDelegate(
                                            (context, index) =>
                                                _card(_gallery.items[index]),
                                            childCount:
                                                _gallery.items.length))),
                                SliverToBoxAdapter(
                                    child: Padding(
                                        padding: EdgeInsets.fromLTRB(
                                            16,
                                            24,
                                            16,
                                            MediaQuery.paddingOf(
                                                        context)
                                                    .bottom +
                                                24),
                                        child: Center(
                                            child: _gallery.paging
                                                ? const SizedBox(
                                                    width: 24,
                                                    height: 24,
                                                    child:
                                                        CircularProgressIndicator(
                                                            strokeWidth: 2))
                                                : _gallery.pageError != null
                                                    ? TextButton(
                                                        onPressed:
                                                            _gallery.loadMore,
                                                        child: const Text(
                                                            '加载失败，点击重试'))
                                                    : _gallery.nextPage != null
                                                        ? TextButton(
                                                            onPressed: _gallery
                                                                .loadMore,
                                                            child: const Text(
                                                                '加载更多'))
                                                        : Text('已加载全部作品',
                                                            style: Theme.of(
                                                                    context)
                                                                .textTheme
                                                                .bodySmall
                                                                ?.copyWith(
                                                                    color: AppTheme
                                                                        .muted))))),
                              ],
                            ]);
                      }))),
            ]),
    );
  }

  Widget _chip(String label, VoidCallback remove) => Padding(
      padding: const EdgeInsets.only(right: 8, bottom: 8),
      child: InputChip(
          label: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 200),
              child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)),
          onDeleted: remove,
          deleteButtonTooltipMessage: '移除筛选：$label'));
  Widget _empty() => Padding(
      padding: const EdgeInsets.all(32),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(
            _gallery.error != null
                ? Icons.cloud_off_outlined
                : Icons.photo_library_outlined,
            size: 40,
            color: AppTheme.muted),
        const SizedBox(height: 16),
        Text(_gallery.error ?? '没有找到符合条件的作品', textAlign: TextAlign.center),
        const SizedBox(height: 12),
        TextButton(
            onPressed: _gallery.error != null
                ? () => _gallery.start()
                : () => _apply(const GalleryQuery()),
            child: Text(_gallery.error != null ? '重试' : '清空筛选')),
      ]));
  Widget _card(FeedItem item) => Semantics(
      button: true,
      label:
          '${_privacy ? '查看作品' : '查看作品：${item.title}'}，${galleryReadingStates[item.readingStatus] ?? '未读'}',
      child: InkWell(
        key: ValueKey('artwork-${item.id}'),
        onTap: () => _open(_gallery.entry(item.id)),
        borderRadius: BorderRadius.circular(8),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AspectRatio(
              aspectRatio: 3 / 4,
              child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Stack(fit: StackFit.expand, children: [
                    MediaThumbnail(
                        api: widget.api,
                        path: item.cover,
                        revision: item.revision,
                        privacy: _privacy,
                        video: item.mediaType == 'video',
                        onFailure: _thumbnailFailure),
                    if (item.readingStatus != 'COMPLETED')
                      Positioned(
                          top: 0,
                          left: 0,
                          child: IgnorePointer(
                              child: CustomPaint(
                                  size: const Size(14, 14),
                                  painter: _ReadingMarker(item.readingStatus ==
                                          'IN_PROGRESS'
                                      ? AppTheme.blue
                                      : Theme.of(context).colorScheme.error)))),
                    if (item.count > 1 || item.mediaType == 'video')
                      Positioned(
                          top: 8,
                          right: 8,
                          child: _badge(item.mediaType == 'video'
                              ? '视频'
                              : '${item.count} 张')),
                  ]))),
          const SizedBox(height: 8),
          Text(
              _privacy
                  ? '内容已遮蔽'
                  : item.title.isEmpty
                      ? '未命名作品'
                      : item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600, height: 1.4)),
          const SizedBox(height: 2),
          Text(_privacy ? '隐私模式' : item.author,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: AppTheme.muted)),
        ]),
      ));
  Widget _badge(String text) => DecoratedBox(
      decoration: BoxDecoration(
          color: const Color(0xb8000000),
          borderRadius: BorderRadius.circular(4)),
      child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          child: Text(text,
              style: const TextStyle(color: Colors.white, fontSize: 10))));
}

class _ReadingMarker extends CustomPainter {
  final Color color;
  const _ReadingMarker(this.color);
  @override
  void paint(Canvas canvas, Size size) => canvas.drawPath(
      Path()
        ..moveTo(0, 0)
        ..lineTo(size.width, 0)
        ..lineTo(0, size.height)
        ..close(),
      Paint()..color = color);
  @override
  bool shouldRepaint(_ReadingMarker old) => color != old.color;
}
