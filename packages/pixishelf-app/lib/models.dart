class Session {
  final String server, token, userId;
  const Session(this.server, this.token, this.userId);
  Map<String, dynamic> toJson() =>
      {'server': server, 'token': token, 'userId': userId};
  factory Session.fromJson(Map<String, dynamic> json) => Session(
      json['server'] as String,
      json['token'] as String,
      json['userId'] as String);
  String get scope => '$server|$userId';
}

class FeedItem {
  final int id, count, revision;
  final String title, author, mediaType, readingStatus;
  final String? cover;
  const FeedItem(this.id, this.title,
      {this.author = '',
      this.count = 0,
      this.revision = 1,
      this.mediaType = 'image',
      this.readingStatus = 'UNREAD',
      this.cover});
  factory FeedItem.fromJson(Map<String, dynamic> json) =>
      FeedItem(json['id'] as int, json['title'] as String,
          author: json['author'] as String? ?? '',
          count: json['imageCount'] as int? ?? 0,
          revision: json['mediaRevision'] as int? ?? 1,
          mediaType: json['mediaType'] as String? ?? 'image',
          readingStatus: json['readingStatus'] as String? ?? 'UNREAD',
          cover: json['coverUrl'] as String?);
  FeedItem withReading(String status) => FeedItem(id, title,
      author: author,
      count: count,
      revision: revision,
      mediaType: mediaType,
      readingStatus: status,
      cover: cover);
}

class MediaItem {
  final int id, index;
  final bool video, animated;
  final List<int> members;
  const MediaItem(
      {required this.id,
      required this.index,
      required this.video,
      required this.animated,
      required this.members});
  factory MediaItem.fromJson(Map<String, dynamic> json) => MediaItem(
      id: json['mediaId'] as int,
      index: json['index'] as int,
      video: json['mediaType'] == 'video',
      animated: json['isAnimated'] == true,
      members: (json['memberMediaIds'] as List).cast<int>());
}

class MediaSource {
  final int id;
  final bool apng;
  final String preview, original;
  final String? thumbnail;
  const MediaSource(this.id, this.apng, this.preview, this.original,
      {this.thumbnail});
  factory MediaSource.fromJson(Map<String, dynamic> json) => MediaSource(
      json['id'] as int,
      json['isApng'] == true,
      json['previewUrl'] as String,
      json['originalUrl'] as String,
      thumbnail: json['thumbnailUrl'] as String?);
}

class ReaderData {
  final int id, revision;
  final String title, author, fingerprint;
  final List<MediaItem> media;
  final int? resumeId;
  int? rating;
  final Set<int> seen;
  final Map<int, MediaSource> sources = {};
  ReaderData(
      {required this.id,
      required this.title,
      required this.author,
      required this.fingerprint,
      required this.revision,
      required this.media,
      required this.resumeId,
      required this.rating,
      required this.seen});
  factory ReaderData.fromJson(int id, Map<String, dynamic> json) {
    final index = json['index'] as Map<String, dynamic>;
    final reading = json['reading'] as Map<String, dynamic>;
    return ReaderData(
        id: id,
        title: json['title'] as String,
        author: json['author'] as String,
        fingerprint: index['fingerprint'] as String,
        revision: index['mediaRevision'] as int,
        media: (index['items'] as List)
            .map((v) => MediaItem.fromJson(Map<String, dynamic>.from(v)))
            .toList(),
        resumeId: (reading['resume'] as Map?)?['mediaId'] as int?,
        rating: (json['rating'] as Map)['level'] as int?,
        seen: (reading['seenMediaIds'] as List).cast<int>().toSet());
  }
  bool get liked => (rating ?? 0) >= 2;
  int resolvePosition(int? mediaId) {
    final found = media.indexWhere(
        (item) => item.id == mediaId || item.members.contains(mediaId));
    if (found >= 0) return found;
    final resumed = media.indexWhere(
        (item) => item.id == resumeId || item.members.contains(resumeId));
    return resumed < 0 ? 0 : resumed;
  }
}
