import 'package:flutter/material.dart';
import 'gallery_query.dart';

Future<GalleryQuery?> showGalleryFilters(
        BuildContext context, GalleryQuery query) =>
    showModalBottomSheet<GalleryQuery>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => GalleryFilters(query: query),
    );

class GalleryFilters extends StatefulWidget {
  final GalleryQuery query;
  const GalleryFilters({super.key, required this.query});
  @override
  State<GalleryFilters> createState() => _GalleryFiltersState();
}

class _GalleryFiltersState extends State<GalleryFilters> {
  late GalleryQuery _draft = widget.query;
  late final _search = TextEditingController(text: _draft.search);
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .78,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 8),
              child: Row(children: [
                Expanded(
                    child: Text('筛选作品', style: theme.textTheme.titleLarge)),
                IconButton(
                    tooltip: '关闭筛选',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close)),
              ])),
          Expanded(
              child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                          controller: _search,
                          maxLength: 200,
                          textInputAction: TextInputAction.done,
                          decoration: const InputDecoration(
                              labelText: '关键词', hintText: '搜索作品、艺术家或标签')),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                          value: _draft.sortBy,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: '排序方式'),
                          items: gallerySorts.entries
                              .map((v) => DropdownMenuItem(
                                  value: v.key, child: Text(v.value)))
                              .toList(),
                          onChanged: (v) {
                            if (v != null) {
                              setState(
                                  () => _draft = _draft.copyWith(sortBy: v));
                            }
                          }),
                      const SizedBox(height: 24),
                      Text('媒体类型', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: galleryMediaTypes.entries
                              .map((v) => ChoiceChip(
                                  label: Text(v.value),
                                  selected: _draft.mediaType == v.key,
                                  onSelected: (_) => setState(() => _draft =
                                      _draft.copyWith(mediaType: v.key))))
                              .toList()),
                      const SizedBox(height: 24),
                      Text('阅读状态', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: galleryReadingStates.entries
                              .map((v) => ChoiceChip(
                                  label: Text(v.value),
                                  selected: _draft.readingStatus == v.key,
                                  onSelected: (_) => setState(() => _draft =
                                      _draft.copyWith(readingStatus: v.key))))
                              .toList()),
                      const SizedBox(height: 16),
                      SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('只看我的喜欢'),
                          value: _draft.likedOnly,
                          onChanged: (v) => setState(
                              () => _draft = _draft.copyWith(likedOnly: v))),
                      const SizedBox(height: 16),
                    ],
                  ))),
          SafeArea(
              top: false,
              child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
                  child: Row(children: [
                    Expanded(
                        child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                                minimumSize: const Size(48, 56)),
                            onPressed: () {
                              _search.clear();
                              setState(() => _draft = const GalleryQuery());
                            },
                            child: const Text('清空筛选'))),
                    const SizedBox(width: 12),
                    Expanded(
                        child: FilledButton(
                            onPressed: () => Navigator.pop(context,
                                _draft.copyWith(search: _search.text.trim())),
                            child: const Text('应用筛选'))),
                  ]))),
        ]),
      ),
    );
  }
}
