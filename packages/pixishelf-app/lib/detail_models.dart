class ArtworkCreator {
  final int id;
  final String name, kind;
  final String? pixivUserId;
  const ArtworkCreator(this.id, this.name,
      {this.kind = 'PERSON', this.pixivUserId});
  factory ArtworkCreator.fromJson(Map<String, dynamic> json) =>
      ArtworkCreator(json['id'] as int, json['name'] as String,
          kind: json['kind'] as String? ?? 'PERSON',
          pixivUserId: json['pixivUserId']?.toString());
}

class ArtworkTag {
  final int id;
  final String name;
  final String? nameZh;
  const ArtworkTag(this.id, this.name, {this.nameZh});
  String get label => nameZh?.isNotEmpty == true ? nameZh! : name;
  factory ArtworkTag.fromJson(Map<String, dynamic> json) =>
      ArtworkTag(json['id'] as int, json['name'] as String,
          nameZh: json['nameZh'] as String?);
}

class ArtworkLink {
  final int id;
  final String title;
  const ArtworkLink(this.id, this.title);
  factory ArtworkLink.fromJson(Map<String, dynamic> json) =>
      ArtworkLink(json['id'] as int, json['title'] as String);
}

class ArtworkSeries {
  final int id;
  final String title;
  final num? order;
  final ArtworkLink? prev, next;
  const ArtworkSeries(this.id, this.title, {this.order, this.prev, this.next});
  factory ArtworkSeries.fromJson(Map<String, dynamic> json) =>
      ArtworkSeries(json['id'] as int, json['title'] as String,
          order: json['order'] as num?,
          prev: json['prev'] is Map
              ? ArtworkLink.fromJson(Map<String, dynamic>.from(json['prev']))
              : null,
          next: json['next'] is Map
              ? ArtworkLink.fromJson(Map<String, dynamic>.from(json['next']))
              : null);
}

class ArtworkSource {
  final String id, label, url;
  const ArtworkSource(this.id, this.label, this.url);
  factory ArtworkSource.fromJson(Map<String, dynamic> json) => ArtworkSource(
      json['id'].toString(), json['label'] as String, json['url'] as String);
}

class ArtworkDetailData {
  final int id, mediaCount;
  final num totalMediaSize;
  final String title, createdAt;
  final String? description, sourceDate;
  final List<ArtworkCreator> creators;
  final List<ArtworkTag> tags;
  final List<ArtworkSeries> series;
  final List<ArtworkSource> sources;
  const ArtworkDetailData(
      {required this.id,
      required this.title,
      this.createdAt = '',
      this.description,
      this.sourceDate,
      this.mediaCount = 0,
      this.totalMediaSize = 0,
      this.creators = const [],
      this.tags = const [],
      this.series = const [],
      this.sources = const []});
  factory ArtworkDetailData.fromJson(Map<String, dynamic> json) =>
      ArtworkDetailData(
          id: json['id'] as int,
          title: json['title'] as String,
          createdAt: json['createdAt'] as String? ?? '',
          description: json['description'] as String?,
          sourceDate: json['sourceDate'] as String?,
          mediaCount: json['mediaCount'] as int? ?? 0,
          totalMediaSize: json['totalMediaSize'] as num? ?? 0,
          creators: _objects(json['creators'], ArtworkCreator.fromJson),
          tags: _objects(json['tags'], ArtworkTag.fromJson),
          series: _objects(json['series'], ArtworkSeries.fromJson),
          sources: _objects(json['sources'], ArtworkSource.fromJson));
}

List<T> _objects<T>(Object? value, T Function(Map<String, dynamic>) parse) =>
    (value as List? ?? [])
        .map((item) => parse(Map<String, dynamic>.from(item)))
        .toList();

class ReadingSummary {
  final int viewCount, seenCount, totalCount, stateVersion;
  final String status;
  final String? lastViewedAt;
  final int? lastMediaId, lastMediaIndex;
  const ReadingSummary(
      {this.viewCount = 0,
      this.seenCount = 0,
      this.totalCount = 0,
      this.stateVersion = 0,
      this.status = 'UNREAD',
      this.lastViewedAt,
      this.lastMediaId,
      this.lastMediaIndex});
  factory ReadingSummary.fromJson(Map<String, dynamic> json) => ReadingSummary(
      viewCount: json['viewCount'] as int? ?? 0,
      seenCount: json['seenCount'] as int? ?? 0,
      totalCount: json['totalCount'] as int? ?? 0,
      stateVersion: json['stateVersion'] as int? ?? 0,
      status: json['status'] as String? ?? 'UNREAD',
      lastViewedAt: json['lastViewedAt'] as String?,
      lastMediaId: json['lastMediaId'] as int?,
      lastMediaIndex: json['lastMediaIndex'] as int?);
}

class ReadingResult {
  final int revision;
  final Set<int> seen;
  final ReadingSummary summary;
  const ReadingResult(this.revision, this.seen, this.summary);
  factory ReadingResult.fromJson(Map<String, dynamic> json) => ReadingResult(
      json['mediaRevision'] as int,
      (json['seenMediaIds'] as List).cast<int>().toSet(),
      ReadingSummary.fromJson(
          Map<String, dynamic>.from(json['summary'] as Map)));
}

class ArtworkStackGroup {
  final String id;
  final List<int> mediaIds;
  final int representativeMediaId, startIndex, endIndex;
  const ArtworkStackGroup(
      {required this.id,
      required this.mediaIds,
      required this.representativeMediaId,
      required this.startIndex,
      required this.endIndex});
  factory ArtworkStackGroup.fromJson(Map<String, dynamic> json) =>
      ArtworkStackGroup(
          id: json['id'] as String,
          mediaIds: (json['mediaIds'] as List).cast<int>(),
          representativeMediaId: json['representativeMediaId'] as int,
          startIndex: json['startIndex'] as int,
          endIndex: json['endIndex'] as int);
}

class MediaMark {
  final int artworkId, mediaId;
  final String? markId, bookmarkedAt, likedAt;
  final bool available;
  const MediaMark(
      {required this.artworkId,
      required this.mediaId,
      this.markId,
      this.bookmarkedAt,
      this.likedAt,
      this.available = true});
  bool get bookmarked => bookmarkedAt != null;
  bool get liked => likedAt != null;
  factory MediaMark.fromJson(Map<String, dynamic> json) => MediaMark(
      artworkId: json['artworkId'] as int,
      mediaId: json['mediaId'] as int,
      markId: json['markId'] as String?,
      bookmarkedAt: json['bookmarkedAt'] as String?,
      likedAt: json['likedAt'] as String?,
      available: json['available'] as bool? ?? true);
}

class VideoChapter {
  final int index;
  final String title;
  final double start, end;
  const VideoChapter(this.index, this.title, this.start, this.end);
  factory VideoChapter.fromJson(Map<String, dynamic> json) => VideoChapter(
      json['index'] as int,
      json['title'] as String,
      (json['start'] as num).toDouble(),
      (json['end'] as num).toDouble());
}

class VideoKeyframe {
  final String id;
  final int selectedOrder;
  final double captureTime;
  const VideoKeyframe(this.id, this.captureTime, this.selectedOrder);
  factory VideoKeyframe.fromJson(Map<String, dynamic> json) => VideoKeyframe(
      json['id'] as String,
      (json['captureTime'] as num).toDouble(),
      json['selectedOrder'] as int? ?? 0);
}

class VideoNavigationData {
  final List<VideoChapter> chapters;
  final List<VideoKeyframe> frames;
  const VideoNavigationData({this.chapters = const [], this.frames = const []});
  bool get isEmpty => chapters.isEmpty && frames.isEmpty;
  factory VideoNavigationData.fromJson(Map<String, dynamic> json) =>
      VideoNavigationData(
          chapters: _objects(json['chapters'], VideoChapter.fromJson),
          frames: _objects(json['frames'], VideoKeyframe.fromJson));
}
