import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'models.dart';
import 'gallery_query.dart';

class AppStorage {
  final FlutterSecureStorage secure;
  final SharedPreferences preferences;
  AppStorage(this.preferences, {this.secure = const FlutterSecureStorage()});
  Future<Session?> readSession() async {
    final raw = await secure.read(key: 'session-v1');
    if (raw == null) return null;
    try {
      return Session.fromJson(Map<String, dynamic>.from(jsonDecode(raw)));
    } catch (_) {
      await clearSession();
      return null;
    }
  }

  Future<void> saveSession(Session session) =>
      secure.write(key: 'session-v1', value: jsonEncode(session.toJson()));
  Future<void> clearSession() => secure.delete(key: 'session-v1');
  Map<String, dynamic>? position(String scope) {
    try {
      return jsonDecode(preferences.getString('position:$scope') ?? 'null')
          as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<void> savePosition(String scope, Map<String, dynamic> value) async {
    await preferences.setString('position:$scope', jsonEncode(value));
  }

  Future<void> clearPosition(String scope) async {
    await preferences.remove('position:$scope');
  }

  GalleryQuery galleryQuery(String scope) {
    try {
      final value = jsonDecode(preferences.getString('gallery:$scope') ?? '{}');
      return GalleryQuery.fromJson(Map<String, dynamic>.from(value as Map));
    } catch (_) {
      return const GalleryQuery();
    }
  }

  Future<void> saveGalleryQuery(String scope, GalleryQuery query) async {
    await preferences.setString('gallery:$scope', jsonEncode(query.toJson()));
  }

  bool? get rememberedPrivacy {
    final expiry = preferences.getInt('privacy-until') ?? 0;
    return expiry > DateTime.now().millisecondsSinceEpoch
        ? preferences.getBool('privacy-mode')
        : null;
  }

  Future<void> rememberPrivacy(bool mode, bool remember) async {
    await preferences.setBool('privacy-mode', mode);
    if (remember) {
      await preferences.setInt('privacy-until',
          DateTime.now().add(const Duration(days: 30)).millisecondsSinceEpoch);
    } else {
      await preferences.remove('privacy-until');
    }
  }

  Future<void> changePrivacy(bool mode) async {
    await preferences.setBool('privacy-mode', mode);
  }
}
