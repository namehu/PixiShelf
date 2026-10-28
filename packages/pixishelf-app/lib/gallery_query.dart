import 'models.dart';

const gallerySorts = <String, String>{
  'source_date_desc': '原始时间 ↓',
  'source_date_asc': '原始时间 ↑',
  'created_at_desc': '入库时间 ↓',
  'created_at_asc': '入库时间 ↑',
  'title_asc': '标题 A-Z',
  'title_desc': '标题 Z-A',
  'artist_asc': '艺术家 A-Z',
  'artist_desc': '艺术家 Z-A',
  'images_desc': '图片数量 ↓',
  'images_asc': '图片数量 ↑',
  'random': '随机排序',
};
const galleryMediaTypes = <String, String>{
  'all': '全部类型',
  'image': '仅图片',
  'animation': '包含动图',
  'video': '仅视频'
};
const galleryReadingStates = <String, String>{
  'all': '全部状态',
  'UNREAD': '未读',
  'IN_PROGRESS': '阅读中',
  'COMPLETED': '已读完'
};

class GalleryQuery {
  final String search, sortBy, mediaType, readingStatus;
  final bool likedOnly;
  const GalleryQuery(
      {this.search = '',
      this.sortBy = 'source_date_desc',
      this.mediaType = 'all',
      this.readingStatus = 'all',
      this.likedOnly = false});
  factory GalleryQuery.fromJson(Map<String, dynamic> json) {
    final value = json['search'];
    final search = value is String ? value.trim() : '';
    return GalleryQuery(
        search: search.length > 200 ? search.substring(0, 200) : search,
        sortBy: gallerySorts.containsKey(json['sortBy'])
            ? json['sortBy'] as String
            : 'source_date_desc',
        mediaType: galleryMediaTypes.containsKey(json['mediaType'])
            ? json['mediaType'] as String
            : 'all',
        readingStatus: galleryReadingStates.containsKey(json['readingStatus'])
            ? json['readingStatus'] as String
            : 'all',
        likedOnly: json['likedOnly'] == true);
  }
  GalleryQuery copyWith(
          {String? search,
          String? sortBy,
          String? mediaType,
          String? readingStatus,
          bool? likedOnly}) =>
      GalleryQuery(
          search: search ?? this.search,
          sortBy: sortBy ?? this.sortBy,
          mediaType: mediaType ?? this.mediaType,
          readingStatus: readingStatus ?? this.readingStatus,
          likedOnly: likedOnly ?? this.likedOnly);
  Map<String, dynamic> toJson() => {
        'search': search,
        'sortBy': sortBy,
        'mediaType': mediaType,
        'readingStatus': readingStatus,
        'likedOnly': likedOnly
      };
  Map<String, dynamic> get parameters => {
        'search': search,
        'sortBy': sortBy,
        'mediaType': mediaType,
        if (readingStatus != 'all') 'readingStatus': readingStatus,
        'likedOnly': '$likedOnly'
      };
  bool get active =>
      search.isNotEmpty ||
      sortBy != 'source_date_desc' ||
      mediaType != 'all' ||
      readingStatus != 'all' ||
      likedOnly;
}

class ReaderEntry {
  final List<FeedItem> items;
  final GalleryQuery query;
  final int seed, artworkId;
  final int? nextPage, mediaId;
  final String? cursor;
  ReaderEntry(
      {required List<FeedItem> items,
      required this.query,
      required this.seed,
      required this.artworkId,
      this.nextPage,
      this.cursor,
      this.mediaId})
      : items = List.unmodifiable(items);
}
