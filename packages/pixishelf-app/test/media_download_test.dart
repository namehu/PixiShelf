import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';

class ControlledMediaAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final responses = <Completer<ResponseBody>>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) {
    requests.add(options);
    final response = Completer<ResponseBody>();
    responses.add(response);
    return response.future;
  }

  void reply(int index, {int status = 200}) => responses[index]
      .complete(ResponseBody.fromBytes([index + 1, 2, 3], status));

  @override
  void close({bool force = false}) {}
}

void main() {
  late ControlledMediaAdapter adapter;
  late MobileApi api;
  const path = '/api/mobile/v1/media/1?variant=preview';
  setUp(() {
    adapter = ControlledMediaAdapter();
    api = MobileApi(
        const Session('https://fixture.invalid', 'synthetic', 'owner'),
        client: Dio()..httpClientAdapter = adapter);
  });
  tearDown(() => api.close());

  Future<void> sent(int count) async {
    for (var i = 0; i < 100 && adapter.requests.length < count; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 1));
    }
    expect(adapter.requests.length, count);
  }

  test(
      'first response completes, concurrent callers share it, cache avoids I/O',
      () async {
    final first = api.media(path, 1);
    final second = api.media(path, 1);
    expect(identical(first, second), isTrue);
    await sent(1);
    adapter.reply(0);
    expect(await first.timeout(const Duration(seconds: 1)), [1, 2, 3]);
    expect(await second.timeout(const Duration(seconds: 1)), [1, 2, 3]);
    expect(await api.media(path, 1), [1, 2, 3]);
    expect(adapter.requests.length, 1);
  });

  test(
      'failed transfer completes with error and a retry starts a fresh request',
      () async {
    final first = api.media(path, 1);
    final failed = expectLater(first.timeout(const Duration(seconds: 1)),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 503)));
    await sent(1);
    adapter.reply(0, status: 503);
    await failed;
    final retry = api.media(path, 1);
    await sent(2);
    adapter.reply(1);
    expect(await retry.timeout(const Duration(seconds: 1)), [2, 2, 3]);
  });

  test('two active transfers release their slots for queued media', () async {
    final first = api.media(path, 1);
    final second = api.media('/api/mobile/v1/media/2?variant=thumbnail', 1);
    final third = api.media('/api/mobile/v1/media/3?variant=preview', 1);
    await sent(2);
    adapter.reply(0);
    expect(await first.timeout(const Duration(seconds: 1)), [1, 2, 3]);
    await sent(3);
    adapter.reply(1);
    adapter.reply(2);
    expect(await second.timeout(const Duration(seconds: 1)), [2, 2, 3]);
    expect(await third.timeout(const Duration(seconds: 1)), [3, 2, 3]);
  });
}
