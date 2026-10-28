import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'models.dart';

class ApiFailure implements Exception {
  final int? status;
  final String code;
  const ApiFailure(this.code, [this.status]);
  String get message => switch (status) {
        401 => '登录已失效，请重新登录',
        403 => '账户已变化，请重新登录',
        404 => '内容已不存在',
        409 => '作品内容已更新，请重新加载',
        413 => '媒体过大，本版暂无法打开',
        429 => '请求较多，请稍后重试',
        _ => code == 'INVALID_SERVER'
            ? '请输入有效的 HTTPS 服务器地址'
            : code == 'API_VERSION'
                ? '服务器版本不兼容，请更新服务端'
                : '连接或加载失败，请重试',
      };
}

String normalizeServer(String value) {
  final uri = Uri.tryParse(value.trim());
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment ||
      (uri.path != '' && uri.path != '/')) {
    throw const ApiFailure('INVALID_SERVER');
  }
  return uri.origin;
}

class MobileApi {
  final Session session;
  final Dio dio;
  final LinkedHashMap<String, Uint8List> _cache = LinkedHashMap();
  final Map<String, Future<Uint8List>> _pending = {};
  int _cacheBytes = 0, _downloads = 0;
  final Queue<Completer<void>> _downloadQueue = Queue();
  bool _closed = false;
  MobileApi(this.session, {Dio? client})
      : dio = client ??
            Dio(BaseOptions(
              baseUrl: session.server,
              connectTimeout: const Duration(seconds: 15),
              receiveTimeout: const Duration(seconds: 40),
              followRedirects: false,
              headers: {'Authorization': 'Bearer ${session.token}'},
            ));
  static Future<Session> login(
      String server, String username, String password) async {
    server = normalizeServer(server);
    final client = Dio(BaseOptions(
        baseUrl: server,
        followRedirects: false,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30)));
    try {
      final result = await client.post<Map<String, dynamic>>(
          '/api/mobile/v1/session',
          data: {'username': username, 'password': password});
      final json = result.data!;
      if (json['apiVersion'] != 1) throw const ApiFailure('API_VERSION');
      return Session(server, json['token'] as String,
          (json['user'] as Map)['id'] as String);
    } on DioException catch (error) {
      throw ApiFailure('LOGIN_FAILED', error.response?.statusCode);
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, dynamic>> request(String path,
      {String method = 'GET',
      Map<String, dynamic>? query,
      Object? body}) async {
    if (_closed) throw const ApiFailure('CLOSED');
    try {
      final result = await dio.request<Map<String, dynamic>>(
          '/api/mobile/v1/$path',
          queryParameters: {'expectedUserId': session.userId, ...?query},
          data: body,
          options: Options(method: method, followRedirects: false));
      return result.data!;
    } on DioException catch (error) {
      throw ApiFailure('REQUEST_FAILED', error.response?.statusCode);
    }
  }

  Future<ReaderData> reader(int id) async =>
      ReaderData.fromJson(id, await request('artworks/$id/reader'));
  final Map<String, Future<Map<String, dynamic>>> _mediaPages = {};
  Future<void> mediaPage(ReaderData reader, int page) async {
    final key = '${reader.id}:${reader.revision}:${reader.fingerprint}:$page';
    final pending = _mediaPages.putIfAbsent(
        key,
        () => request('artworks/${reader.id}/media',
            query: {'fingerprint': reader.fingerprint, 'page': page}));
    late Map<String, dynamic> result;
    try {
      result = await pending;
    } finally {
      if (identical(_mediaPages[key], pending)) _mediaPages.remove(key);
    }
    if (result['fingerprint'] != reader.fingerprint) {
      throw const ApiFailure('MEDIA_CHANGED', 409);
    }
    for (final json in result['images'] as List) {
      final source = MediaSource.fromJson(Map<String, dynamic>.from(json));
      reader.sources[source.id] = source;
    }
  }

  Future<Uint8List> media(String path, int revision) {
    final uri = Uri.parse(session.server).resolve(path);
    if (uri.origin != session.server ||
        !uri.path.startsWith('/api/mobile/v1/media/') ||
        uri.userInfo.isNotEmpty) {
      return Future.error(const ApiFailure('INVALID_MEDIA_URL'));
    }
    final url = uri.replace(queryParameters: {
      ...uri.queryParameters,
      'revision': '$revision'
    }).toString();
    final hit = _cache.remove(url);
    if (hit != null) {
      _cache[url] = hit;
      return Future.value(hit);
    }
    return _pending[url] ??=
        _download(url).whenComplete(() => _pending.remove(url));
  }

  Future<Uint8List> _download(String url) async {
    if (_downloads >= 2) {
      final turn = Completer<void>();
      _downloadQueue.add(turn);
      await turn.future;
    } else {
      _downloads++;
    }
    final cancel = CancelToken();
    try {
      if (_closed) throw const ApiFailure('CLOSED');
      final response = await dio.get<ResponseBody>(url,
          cancelToken: cancel,
          options: Options(
              responseType: ResponseType.stream, followRedirects: false));
      final builder = BytesBuilder(copy: false);
      await for (final chunk in response.data!.stream) {
        if (builder.length + chunk.length > 64 * 1024 * 1024) {
          throw const ApiFailure('MEDIA_TOO_LARGE', 413);
        }
        builder.add(chunk);
      }
      final bytes = builder.takeBytes();
      if (_closed) throw const ApiFailure('CLOSED');
      if (bytes.length <= 32 * 1024 * 1024) {
        while (_cacheBytes + bytes.length > 32 * 1024 * 1024 &&
            _cache.isNotEmpty) {
          _cacheBytes -= _cache.remove(_cache.keys.first)!.length;
        }
        _cache[url] = bytes;
        _cacheBytes += bytes.length;
      }
      return bytes;
    } on DioException catch (error) {
      throw ApiFailure('MEDIA_FAILED', error.response?.statusCode);
    } finally {
      cancel.cancel();
      if (_downloadQueue.isNotEmpty) {
        _downloadQueue.removeFirst().complete();
      } else {
        _downloads--;
      }
    }
  }

  void close() {
    _closed = true;
    dio.close(force: true);
    _cache.clear();
    _cacheBytes = 0;
  }
}
