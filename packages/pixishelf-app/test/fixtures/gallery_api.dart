import 'dart:typed_data';
import 'package:image/image.dart' as img;
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';

// Synthetic test data only; the shipped app has no demo or anonymous entry.
class GalleryApiFixture extends MobileApi {
  final List<Map<String, dynamic>> queries = [], reports = [];
  final List<int> mediaPages = [];
  final List<String> imageRequests = [];
  final Map<int, Uint8List> _images = {};
  bool closed = false;
  final Map<int, Set<int>> seen = {};
  final Map<int, int?> ratings = {};
  final Map<int, MediaMark> marks = {};
  GalleryApiFixture()
      : super(const Session('https://fixture.invalid', 'synthetic', 'owner'));
  @override
  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    if (path == 'session') {
      return {
        'apiVersion': 1,
        'user': {'id': 'owner'}
      };
    }
    if (path == 'feed') {
      queries.add(Map.of(query ?? {}));
      final page = query?['page'] as int? ?? 1;
      return {
        'items': [
          for (var i = (page - 1) * 20 + 1; i <= page * 20 && i <= 40; i++)
            {
              'id': i,
              'title': '作品 $i',
              'author': '测试艺术家',
              'imageCount': 60,
              'mediaType': i % 4 == 0 ? 'video' : 'image',
              'mediaRevision': 1,
              'readingStatus': i % 3 == 0 ? 'IN_PROGRESS' : 'UNREAD',
              'coverUrl':
                  '/api/mobile/v1/media/${i * 1000 + 1}?variant=thumbnail',
            }
        ],
        'nextPage': page < 2 ? 2 : null,
        'nextCursor': page < 2 ? 'cursor-page-2' : null
      };
    }
    if (path == 'reading') {
      final report = Map<String, dynamic>.from(body as Map);
      reports.add(report);
      final id = report['artworkId'] as int;
      final read = seen.putIfAbsent(id, () => {});
      read.addAll(
          (report['events'] as List).map((event) => event['mediaId'] as int));
      return {
        'mediaRevision': 1,
        'seenMediaIds': read.toList(),
        'summary': {
          'status': 'IN_PROGRESS',
          'seenCount': read.length,
          'totalCount': 60,
          'viewCount': 1
        }
      };
    }
    return {};
  }

  @override
  Future<ReaderData> reader(int id) async => ReaderData(
      id: id,
      title: '作品 $id',
      author: '测试艺术家',
      fingerprint: 'fixture-$id',
      revision: 1,
      media: [
        for (var i = 0; i < 60; i++)
          MediaItem(
              id: id * 1000 + i + 1,
              index: i,
              video: false,
              animated: false,
              members: [id * 1000 + i + 1])
      ],
      resumeId: null,
      rating: ratings[id],
      seen: Set.of(seen[id] ?? {}),
      summary: ReadingSummary(
          totalCount: 60,
          seenCount: seen[id]?.length ?? 0,
          status: seen[id]?.isNotEmpty == true ? 'IN_PROGRESS' : 'UNREAD'),
      stackFingerprint: 'fixture-stack-$id',
      stacks: [
        for (var i = 0; i < 60; i += 4)
          ArtworkStackGroup(
              id: 'stack-v1-${id * 1000 + i + 1}-${id * 1000 + i + 4}',
              mediaIds: [for (var j = i; j < i + 4; j++) id * 1000 + j + 1],
              representativeMediaId: id * 1000 + i + 1,
              startIndex: i,
              endIndex: i + 3)
      ]);

  @override
  Future<ArtworkDetailData> detail(int id) async => ArtworkDetailData(
      id: id,
      title: '作品 $id',
      mediaCount: 60,
      createdAt: '2026-10-28T00:00:00Z',
      description: '用于验证作品详情与沉浸浏览的合成图片。',
      creators: const [ArtworkCreator(1, '测试艺术家')],
      tags: const [ArtworkTag(1, '色彩练习'), ArtworkTag(2, '测试图库')]);
  @override
  Future<List<FeedItem>> neighbors(int artworkId, int artistId,
          {String direction = 'both',
          String dateMode = 'source',
          int limit = 8}) async =>
      [];
  @override
  Future<List<MediaMark>> mediaMarks(int artworkId, List<int> mediaIds) async =>
      mediaIds
          .map(
              (id) => marks[id] ?? MediaMark(artworkId: artworkId, mediaId: id))
          .toList();
  @override
  Future<MediaMark> setMediaMark(
      int artworkId, int mediaId, String kind, bool value) async {
    final old = marks[mediaId];
    return marks[mediaId] = MediaMark(
        artworkId: artworkId,
        mediaId: mediaId,
        bookmarkedAt: kind == 'bookmark'
            ? (value ? '2026-10-28T00:00:00Z' : null)
            : old?.bookmarkedAt,
        likedAt: kind == 'like'
            ? (value ? '2026-10-28T00:00:00Z' : null)
            : old?.likedAt);
  }

  @override
  Future<int?> setRating(int artworkId, int? level) async =>
      ratings[artworkId] = level;
  @override
  Future<ReadingResult> markRead(ReaderData data, {int? mediaId}) async {
    final read = seen.putIfAbsent(data.id, () => {});
    read.addAll(mediaId == null ? data.media.map((v) => v.id) : [mediaId]);
    return ReadingResult(
        data.revision,
        Set.of(read),
        ReadingSummary(
            totalCount: 60,
            seenCount: read.length,
            status: read.length == 60 ? 'COMPLETED' : 'IN_PROGRESS'));
  }

  @override
  Future<void> mediaPage(ReaderData reader, int page) async {
    mediaPages.add(page);
    for (final item in reader.media.skip(page * 24).take(24)) {
      final path = '/api/mobile/v1/media/${item.id}';
      reader.sources[item.id] = MediaSource(
          item.id, false, '$path?variant=preview', '$path?variant=original',
          thumbnail: '$path?variant=thumbnail');
    }
  }

  @override
  Future<Uint8List> media(String path, int revision) async {
    imageRequests.add(path);
    final id = int.tryParse(Uri.parse(path).pathSegments.last) ?? 1;
    return _images.putIfAbsent(id % 6, () {
      final image = img.Image(width: 300, height: 400);
      const palette = [
        [97, 133, 147],
        [183, 132, 102],
        [116, 137, 99],
        [136, 128, 159],
        [105, 149, 161],
        [170, 152, 115]
      ];
      final color = palette[id % 6];
      for (var y = 0; y < 400; y++) {
        for (var x = 0; x < 300; x++) {
          final shade = .6 + .4 * (y / 400);
          image.setPixelRgb(x, y, (color[0] * shade).round(),
              (color[1] * shade).round(), (color[2] * shade).round());
        }
      }
      return Uint8List.fromList(img.encodeJpg(image));
    });
  }

  @override
  void close() {
    closed = true;
    super.close();
  }
}
