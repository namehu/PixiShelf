import 'package:flutter_test/flutter_test.dart';
import 'package:pixishelf_app/api.dart';
import 'package:pixishelf_app/models.dart';

void main() {
  test('accepts HTTPS origins only and never credential-bearing URLs', () {
    expect(normalizeServer(' https://gallery.test/ '), 'https://gallery.test');
    for (final value in [
      'http://gallery.test',
      'https://u:p@gallery.test',
      'https://gallery.test/path',
      'https://gallery.test?token=secret',
      'bad'
    ]) {
      expect(() => normalizeServer(value), throwsA(isA<ApiFailure>()));
    }
  });
  test('never forwards authentication to cross-origin media', () async {
    final api =
        MobileApi(const Session('https://gallery.test', 'secret', 'owner'));
    await expectLater(
        api.media('https://evil.test/media', 1), throwsA(isA<ApiFailure>()));
    await expectLater(
        api.media('/api/trpc/artwork.delete', 1), throwsA(isA<ApiFailure>()));
    api.close();
  });
  test('USB HTTP is opt-in, loopback-only and checked on restored sessions',
      () {
    if (usbDevEnabled) {
      expect(normalizeServer(usbDevServer), usbDevServer);
      final api = MobileApi(const Session(usbDevServer, 'secret', 'owner'));
      api.close();
    } else {
      expect(() => normalizeServer(usbDevServer), throwsA(isA<ApiFailure>()));
      expect(() => MobileApi(const Session(usbDevServer, 'secret', 'owner')),
          throwsA(isA<ApiFailure>()));
    }
    for (final value in [
      'http://192.168.1.2:5430',
      'http://localhost:5430',
      'http://127.0.0.1:80',
      'http://127.0.0.1:5430/private',
      'http://user:secret@127.0.0.1:5430',
      'http://127.0.0.1:5430?token=secret',
      'http://127.0.0.1:5430#fragment',
    ]) {
      expect(() => normalizeServer(value), throwsA(isA<ApiFailure>()));
      expect(() => MobileApi(Session(value, 'secret', 'owner')),
          throwsA(isA<ApiFailure>()));
    }
  });
}
