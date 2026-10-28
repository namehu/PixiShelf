import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api.dart';
import 'app_theme.dart';
import 'app_navigation.dart';
import 'artwork_detail_view.dart';
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
  final GalleryQuery? initialQuery;
  final String title;
  final bool? initialPrivacy;
  final Future<void> Function() onLogout, onExpired;
  const GalleryView(
      {super.key,
      required this.api,
      required this.storage,
      this.initialQuery,
      this.title = '作品',
      this.initialPrivacy,
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
    if (widget.initialQuery != null) _gallery.query = widget.initialQuery!;
    _search = TextEditingController(text: _gallery.query.search);
    _scroll.addListener(_nearEnd);
    WidgetsBinding.instance.addPostFrameCallback((_) => _enter());
  }

  Future<void> _enter() async {
    final privacy = widget.initialPrivacy ??
        await confirmGalleryPrivacy(context, widget.storage);
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
          appPageRoute(
              ReaderView(
                  api: widget.api,
                  entry: entry,
                  initialPrivacy: _privacy,
                  onOpenDetail: (artworkId, mediaId) =>
                      _detail(artworkId, mediaId: mediaId),
                  onBrowseQuery: _browse,
                  onLogout: () => _accountExit(),
                  onExpired: () => _accountExit(expired: true)),
              fullscreen: true));
      if (!mounted) return;
      _gallery.updateReading(updates ?? {});
      setState(() => _privacy =
          widget.storage.preferences.getBool('privacy-mode') ?? _privacy);
    } finally {
      _opening = false;
    }
  }

  Future<void> _detail(int artworkId, {int? mediaId}) async {
    if (!_confirmed) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final updates = await Navigator.of(context).push<Map<int, String>>(
        appPageRoute(ArtworkDetailView(
            api: widget.api,
            storage: widget.storage,
            artworkId: artworkId,
            initialMediaId: mediaId,
            entry: _gallery.entry(artworkId),
            initialPrivacy: _privacy,
            onBrowseQuery: _browse,
            onLogout: () => _accountExit(),
            onExpired: () => _accountExit(expired: true))));
    if (!mounted) return;
    _gallery.updateReading(updates ?? {});
    setState(() => _privacy =
        widget.storage.preferences.getBool('privacy-mode') ?? _privacy);
  }

  Future<void> _browse(GalleryQuery query) async {
    await Navigator.of(context).push(appPageRoute(GalleryView(
        api: widget.api,
        storage: widget.storage,
        initialQuery: query,
        title: query.artistName ??
            (query.tagLabels.isEmpty ? '作品' : query.tagLabels.join(' · ')),
        initialPrivacy: _privacy,
        onLogout: widget.onLogout,
        onExpired: widget.onExpired)));
    if (mounted) {
      await widget.storage
          .saveGalleryQuery(widget.api.session.scope, _gallery.query);
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
    final saved = widget.storage.position(widget.api.session.scope);
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
                if (saved != null && saved['artworkId'] is int)
                  ListTile(
                      leading: const Icon(Icons.history),
                      title: const Text('继续上次浏览'),
                      onTap: () => Navigator.pop(context, 'continue')),
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
    if (action == 'continue') _continue();
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
    return AnnotatedRegion<SystemUiOverlayStyle>(
        value:
            AppTheme.lightBars.copyWith(systemNavigationBarColor: Colors.white),
        child: Scaffold(
          backgroundColor: Colors.white,
          bottomNavigationBar: _confirmed ? _navigation() : null,
          body: SafeArea(
              bottom: false,
              child: !_confirmed
                  ? const SizedBox.expand()
                  : Column(children: [
                      _toolbar(query),
                      if (query.active)
                        Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 10),
                            decoration: const BoxDecoration(
                                color: Color(0xfffafafa),
                                border: Border(
                                    bottom:
                                        BorderSide(color: Color(0xffe5e5e5)))),
                            child: Wrap(spacing: 8, runSpacing: 8, children: [
                              Container(
                                  height: 28,
                                  alignment: Alignment.center,
                                  width: 72,
                                  decoration: BoxDecoration(
                                      border: Border.all(
                                          color: const Color(0xffdddddd)),
                                      borderRadius: BorderRadius.circular(14)),
                                  child: const Text('当前筛选',
                                      style: TextStyle(
                                          fontSize: 12,
                                          color: Color(0xff66727d)))),
                              if (query.search.isNotEmpty)
                                _chip(
                                    _privacy ? '关键词已隐藏' : '关键词：${query.search}',
                                    () => _apply(query.copyWith(search: ''))),
                              if (query.sortBy != 'source_date_desc')
                                _chip(
                                    gallerySorts[query.sortBy]!,
                                    () => _apply(query.copyWith(
                                        sortBy: 'source_date_desc'))),
                              if (query.mediaType != 'all')
                                _chip(
                                    galleryMediaTypes[query.mediaType]!,
                                    () => _apply(
                                        query.copyWith(mediaType: 'all'))),
                              if (query.readingStatus != 'all')
                                _chip(
                                    galleryReadingStates[query.readingStatus]!,
                                    () => _apply(
                                        query.copyWith(readingStatus: 'all'))),
                              if (query.likedOnly)
                                _chip(
                                    '我的喜欢',
                                    () => _apply(
                                        query.copyWith(likedOnly: false))),
                              if (query.artistId != null)
                                _chip(
                                    query.artistName ?? '艺术家',
                                    () => _apply(
                                        query.copyWith(clearArtist: true))),
                              for (var i = 0; i < query.tagIds.length; i++)
                                _chip(
                                    i < query.tagLabels.length
                                        ? query.tagLabels[i]
                                        : '标签',
                                    () => _apply(query.copyWith(
                                          tagIds: [
                                            for (var j = 0;
                                                j < query.tagIds.length;
                                                j++)
                                              if (j != i) query.tagIds[j]
                                          ],
                                          tagLabels: [
                                            for (var j = 0;
                                                j < query.tagLabels.length;
                                                j++)
                                              if (j != i) query.tagLabels[j]
                                          ],
                                        ))),
                              SizedBox(
                                  height: 28,
                                  child: TextButton(
                                      style: TextButton.styleFrom(
                                          minimumSize: const Size(48, 28),
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 8)),
                                      onPressed: () =>
                                          _apply(const GalleryQuery()),
                                      child: const Text('清空全部',
                                          style: TextStyle(fontSize: 12)))),
                            ])),
                      Expanded(
                          child: RefreshIndicator(
                              onRefresh: () => _gallery.start(),
                              child: LayoutBuilder(
                                  builder: (context, constraints) {
                                final width = constraints.maxWidth;
                                final columns = width >= 1536
                                    ? 7
                                    : width >= 1280
                                        ? 6
                                        : width >= 1024
                                            ? 5
                                            : width >= 768
                                                ? 4
                                                : width >= 640
                                                    ? 3
                                                    : 2;
                                final gap = _gallery.displayMode == 'minimal'
                                    ? 2.0
                                    : 12.0;
                                return CustomScrollView(
                                    controller: _scroll,
                                    key: const PageStorageKey('gallery'),
                                    physics:
                                        const AlwaysScrollableScrollPhysics(),
                                    slivers: [
                                      const SliverToBoxAdapter(
                                          child: SizedBox(height: 16)),
                                      if (_gallery.loading)
                                        const SliverFillRemaining(
                                            hasScrollBody: false,
                                            child: Center(
                                                child:
                                                    CircularProgressIndicator()))
                                      else if (_gallery.items.isEmpty)
                                        SliverFillRemaining(
                                            hasScrollBody: false,
                                            child: _empty())
                                      else ...[
                                        SliverPadding(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 16),
                                            sliver: SliverList(
                                                delegate:
                                                    SliverChildBuilderDelegate(
                                                        (context, row) =>
                                                            Padding(
                                                                padding: EdgeInsets
                                                                    .only(
                                                                        bottom:
                                                                            gap),
                                                                child: Row(
                                                                    crossAxisAlignment:
                                                                        CrossAxisAlignment
                                                                            .start,
                                                                    children: [
                                                                      for (var column =
                                                                              0;
                                                                          column <
                                                                              columns;
                                                                          column++) ...[
                                                                        if (column >
                                                                            0)
                                                                          SizedBox(
                                                                              width: gap),
                                                                        Expanded(
                                                                            child: row * columns + column < _gallery.items.length
                                                                                ? _card(_gallery.items[row * columns + column])
                                                                                : const SizedBox()),
                                                                      ]
                                                                    ])),
                                                        childCount: (_gallery
                                                                    .items
                                                                    .length /
                                                                columns)
                                                            .ceil()))),
                                        SliverToBoxAdapter(
                                            child: Padding(
                                                padding: EdgeInsets.fromLTRB(
                                                    16,
                                                    24,
                                                    16,
                                                    MediaQuery.paddingOf(context)
                                                            .bottom +
                                                        24),
                                                child: Center(
                                                    child: _gallery.paging
                                                        ? const SizedBox(
                                                            width: 24,
                                                            height: 24,
                                                            child: CircularProgressIndicator(
                                                                strokeWidth: 2))
                                                        : _gallery.pageError !=
                                                                null
                                                            ? TextButton(
                                                                onPressed:
                                                                    _gallery
                                                                        .loadMore,
                                                                child: const Text(
                                                                    '加载失败，点击重试'))
                                                            : _gallery.nextPage !=
                                                                    null
                                                                ? TextButton(
                                                                    onPressed:
                                                                        _gallery
                                                                            .loadMore,
                                                                    child: const Text(
                                                                        '加载更多'))
                                                                : Text(
                                                                    '已加载全部作品',
                                                                    style: Theme.of(
                                                                            context)
                                                                        .textTheme
                                                                        .bodySmall
                                                                        ?.copyWith(
                                                                            color: AppTheme.muted))))),
                                      ],
                                    ]);
                              }))),
                    ])),
        ));
  }

  Widget _toolbar(GalleryQuery query) => Container(
      key: const ValueKey('gallery-toolbar'),
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(bottom: BorderSide(color: Color(0xffe5e5e5)))),
      child: Row(children: [
        Expanded(
            child: SizedBox(
                height: 36,
                child: TextField(
                    controller: _search,
                    maxLength: 200,
                    textInputAction: TextInputAction.search,
                    style: const TextStyle(
                        fontSize: 16, color: Color(0xff333333), height: 1.2),
                    textAlignVertical: TextAlignVertical.center,
                    onSubmitted: (value) =>
                        _apply(query.copyWith(search: value.trim())),
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      counterText: '',
                      isDense: true,
                      filled: true,
                      fillColor: Colors.white,
                      hintText: '搜索作品、艺术家或标签',
                      hintStyle: const TextStyle(
                          fontSize: 16, color: Color(0xff66727d), height: 1.2),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 8),
                      prefixIcon: const Icon(Icons.search,
                          size: 16, color: Color(0xff66727d)),
                      prefixIconConstraints:
                          const BoxConstraints(minWidth: 34, minHeight: 34),
                      suffixIconConstraints:
                          const BoxConstraints(minWidth: 34, minHeight: 34),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: '清除关键词',
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints.tightFor(
                                  width: 34, height: 34),
                              onPressed: () =>
                                  _apply(query.copyWith(search: '')),
                              icon: const Icon(Icons.close, size: 16)),
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8)),
                      enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide:
                              const BorderSide(color: Color(0xffdddddd))),
                      focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: const BorderSide(color: AppTheme.blue)),
                    )))),
        const SizedBox(width: 8),
        _toolbarButton(
            '沉浸浏览',
            Icons.slideshow_outlined,
            _gallery.items.isEmpty
                ? null
                : () => _open(_gallery.entry(_gallery.items.first.id))),
        const SizedBox(width: 8),
        _toolbarButton('筛选作品', Icons.tune, _filter, active: query.active),
      ]));

  Widget _toolbarButton(String label, IconData icon, VoidCallback? onPressed,
          {bool active = false}) =>
      SizedBox(
          width: 44,
          height: 44,
          child: IconButton.outlined(
              tooltip: label,
              onPressed: onPressed,
              style: IconButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  padding: EdgeInsets.zero,
                  foregroundColor: const Color(0xff333333),
                  backgroundColor:
                      active ? const Color(0xfff0f0f0) : Colors.white,
                  side: const BorderSide(color: Color(0xffdddddd)),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8))),
              icon: Icon(icon, size: 20)));

  Widget _navigation() => DecoratedBox(
      decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xffe5e5e5)))),
      child: SafeArea(
          top: false,
          child: Row(children: [
            _navItem('作品', Icons.photo_library_outlined, () {
              if (_scroll.hasClients) {
                _scroll.animateTo(0,
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOutCubic);
              }
            }, active: true),
            _navItem(
                '沉浸',
                Icons.slideshow_outlined,
                _gallery.items.isEmpty
                    ? null
                    : () => _open(_gallery.entry(_gallery.items.first.id))),
            _navItem('更多', Icons.more_horiz, _settings),
          ])));

  Widget _navItem(String label, IconData icon, VoidCallback? onTap,
          {bool active = false}) =>
      Expanded(
          child: Semantics(
              selected: active,
              button: true,
              child: InkWell(
                  onTap: onTap,
                  child: SizedBox(
                      height: 64,
                      child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(icon,
                                size: 20,
                                color: active
                                    ? AppTheme.blue
                                    : const Color(0xff66727d)),
                            const SizedBox(height: 4),
                            Text(label,
                                style: TextStyle(
                                    fontSize: 11,
                                    height: 1.2,
                                    color: active
                                        ? AppTheme.blue
                                        : const Color(0xff66727d),
                                    fontWeight: FontWeight.w500)),
                          ])))));

  Widget _chip(String label, VoidCallback remove) => SizedBox(
      height: 28,
      child: InputChip(
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          labelPadding: EdgeInsets.zero,
          backgroundColor: const Color(0xfff0f2f4),
          side: BorderSide.none,
          shape: const StadiumBorder(),
          deleteIcon: const Icon(Icons.close, size: 14),
          label: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 220),
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontSize: 12, color: Color(0xff333333)))),
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
  Widget _card(FeedItem item) => LayoutBuilder(
      builder: (context, constraints) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                    button: true,
                    label:
                        '${_privacy ? '浏览作品' : '浏览作品：${item.title}'}，${galleryReadingStates[item.readingStatus] ?? '未读'}',
                    child: InkWell(
                        key: ValueKey('artwork-${item.id}'),
                        onTap: () => _open(_gallery.entry(item.id)),
                        borderRadius: BorderRadius.circular(
                            _gallery.displayMode == 'minimal' ? 0 : 8),
                        child: AspectRatio(
                            aspectRatio: 3 / 4,
                            child: ClipRRect(
                                borderRadius: BorderRadius.circular(
                                    _gallery.displayMode == 'minimal' ? 0 : 8),
                                child: Stack(fit: StackFit.expand, children: [
                                  MediaThumbnail(
                                      api: widget.api,
                                      path: item.cover,
                                      revision: item.revision,
                                      privacy: _privacy,
                                      video: item.mediaType == 'video',
                                      onFailure: _thumbnailFailure),
                                  if (item.preferredTag != null)
                                    Positioned(
                                        top: 8,
                                        left: 8,
                                        child: ConstrainedBox(
                                            constraints: BoxConstraints(
                                                maxWidth:
                                                    constraints.maxWidth * .72),
                                            child: Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                        horizontal: 8,
                                                        vertical: 2),
                                                decoration: BoxDecoration(
                                                    color:
                                                        const Color(0xffc8323c),
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            2)),
                                                child: Text(
                                                    _privacy
                                                        ? '已遮蔽'
                                                        : item.preferredTag!,
                                                    maxLines: 1,
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                    style: const TextStyle(
                                                        color: Colors.white,
                                                        fontSize: 10,
                                                        height: 1.2,
                                                        fontWeight: FontWeight.w600))))),
                                  if (_gallery.showReadingStatus &&
                                      item.readingStatus != 'COMPLETED')
                                    Positioned(
                                        top: 0,
                                        left: 0,
                                        child: IgnorePointer(
                                            child: CustomPaint(
                                                size: const Size(12, 12),
                                                painter: _ReadingMarker(
                                                    item.readingStatus ==
                                                            'IN_PROGRESS'
                                                        ? AppTheme.blue
                                                        : const Color(
                                                            0xffc8323c))))),
                                  if (item.count > 1 ||
                                      item.mediaType == 'video')
                                    Positioned(
                                        top: 8,
                                        right: 8,
                                        child: _badge(
                                            item.mediaType == 'video'
                                                ? item.totalMediaSize > 0
                                                    ? _fileSize(
                                                        item.totalMediaSize)
                                                    : '视频'
                                                : '${item.count}',
                                            item.mediaType == 'video'
                                                ? Icons.videocam_outlined
                                                : Icons
                                                    .photo_library_outlined)),
                                ]))))),
                if (_gallery.displayMode != 'minimal') ...[
                  const SizedBox(height: 8),
                  Semantics(
                      button: true,
                      label: _privacy ? '作品详情' : '作品详情：${item.title}',
                      child: InkWell(
                          key: ValueKey('artwork-detail-${item.id}'),
                          onTap: () => _detail(item.id),
                          child: Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 2),
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                        _privacy
                                            ? '内容已遮蔽'
                                            : item.title.isEmpty
                                                ? '未命名作品'
                                                : item.title,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: 14,
                                            height: 20 / 14,
                                            fontWeight: FontWeight.w600,
                                            color: Color(0xff333333))),
                                    const SizedBox(height: 2),
                                    Text(_privacy ? '隐私模式' : item.author,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: 12,
                                            height: 20 / 12,
                                            color: Color(0xff66727d))),
                                  ])))),
                ],
              ]));
  String _fileSize(int bytes) => bytes >= 1024 * 1024 * 1024
      ? '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB'
      : bytes >= 1024 * 1024
          ? '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB'
          : '${(bytes / 1024).toStringAsFixed(1)} KB';
  Widget _badge(String text, IconData icon) => DecoratedBox(
      decoration: BoxDecoration(
          color: const Color(0xb8000000),
          borderRadius: BorderRadius.circular(4)),
      child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: Colors.white, size: 10),
            const SizedBox(width: 4),
            Text(text,
                style: const TextStyle(
                    color: Colors.white, fontSize: 10, height: 1.2)),
          ])));
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
