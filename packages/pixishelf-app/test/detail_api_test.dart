import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/gallery_query.dart';
import 'package:pixishelf_app/models.dart';

class DetailAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  Map<String, dynamic> response = {};
  int status = 200;
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    return ResponseBody.fromString(jsonEncode(response), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType]
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late MobileApi api;
  late DetailAdapter adapter;
  setUp(() {
    adapter = DetailAdapter();
    api = MobileApi(
        const Session('https://fixture.invalid', 'synthetic', 'owner'),
        client: Dio()..httpClientAdapter = adapter);
  });
  tearDown(() => api.close());

  test('reader preserves dimensions, shared stack identity and reading facts',
      () async {
    adapter.response = {
      'title': 'Fixture',
      'author': 'Author',
      'rating': {'level': 3},
      'index': {
        'fingerprint': 'version',
        'mediaRevision': 2,
        'items': [
          {
            'mediaId': 4,
            'index': 0,
            'memberMediaIds': [4, 5],
            'width': 800,
            'height': 1200,
            'reliableDimensions': true,
            'mediaType': 'image',
            'isAnimated': false
          }
        ]
      },
      'reading': {
        'seenMediaIds': [4],
        'resume': {'mediaId': 5},
        'summary': {
          'viewCount': 7,
          'seenCount': 1,
          'totalCount': 1,
          'status': 'COMPLETED',
          'stateVersion': 9
        }
      },
      'stack': {
        'ruleVersion': 1,
        'fingerprint': 'version',
        'groups': [
          {
            'id': 'stack-v1-4-4',
            'mediaIds': [4],
            'representativeMediaId': 4,
            'startIndex': 0,
            'endIndex': 0
          }
        ]
      }
    };
    final reader = await api.reader(1);
    expect(reader.media.single.height, 1200);
    expect(reader.media.single.reliableDimensions, isTrue);
    expect(reader.resolvePosition(5), 0);
    expect(reader.summary.viewCount, 7);
    expect(reader.summary.stateVersion, 9);
    expect(reader.stacks.single.mediaIds, [4]);
    expect(reader.stackFingerprint, reader.fingerprint);
    expect(adapter.requests.single.queryParameters['expectedUserId'], 'owner');
  });

  test(
      'manual completion sends revision and explicit target without observations',
      () async {
    adapter.response = {
      'mediaRevision': 2,
      'seenMediaIds': [4],
      'summary': {
        'viewCount': 7,
        'seenCount': 1,
        'totalCount': 1,
        'status': 'COMPLETED'
      }
    };
    final reader = ReaderData(
        id: 1,
        title: '',
        author: '',
        fingerprint: 'version',
        revision: 2,
        media: [],
        resumeId: null,
        rating: null,
        seen: {});
    final result = await api.markRead(reader, mediaId: 4);
    final request = adapter.requests.single;
    expect(request.method, 'PUT');
    expect(request.data, {
      'expectedUserId': 'owner',
      'artworkId': 1,
      'mediaRevision': 2,
      'target': {'kind': 'MEDIA', 'mediaId': 4}
    });
    expect(result.summary.viewCount, 7);
    expect(result.seen, {4});
  });

  test('media bookmark and like remain separate explicit writes', () async {
    adapter.response = {
      'artworkId': 1,
      'mediaId': 4,
      'markId': 'm',
      'bookmarkedAt': '2026-10-28T00:00:00Z',
      'likedAt': null,
      'available': true
    };
    final mark = await api.setMediaMark(1, 4, 'bookmark', true);
    expect(mark.bookmarked, isTrue);
    expect(mark.liked, isFalse);
    expect(adapter.requests.single.data['kind'], 'bookmark');
    expect(adapter.requests.single.data['expectedUserId'], 'owner');
    expect(adapter.requests.single.path, '/api/mobile/v1/media-marks');
  });

  test('stale media revision is an explicit reload failure', () async {
    adapter.status = 409;
    await expectLater(
        api.videoNavigation(4, 1),
        throwsA(
            isA<ApiFailure>().having((error) => error.status, 'status', 409)));
    expect(adapter.requests.single.queryParameters['revision'], 1);
  });

  test('creator and tag navigation survives stored filters and can be cleared',
      () {
    const selected = GalleryQuery(
        artistId: 7,
        artistName: 'Author',
        tagIds: [4, 9],
        tagLabels: ['Tag A', 'Tag B']);
    final restored =
        GalleryQuery.fromJson(jsonDecode(jsonEncode(selected.toJson())));
    expect(restored.parameters['artistId'], 7);
    expect(restored.parameters['tagIds'], '4,9');
    expect(restored.artistName, 'Author');
    expect(restored.active, isTrue);
    expect(
        restored.copyWith(clearArtist: true, tagIds: [], tagLabels: []).active,
        isFalse);
  });
}
