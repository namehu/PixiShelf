import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'models.dart';
import 'storage.dart';
import 'gallery_view.dart';

final storageProvider =
    Provider<AppStorage>((ref) => throw UnimplementedError());
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  PaintingBinding.instance.imageCache.maximumSizeBytes = 64 * 1024 * 1024;
  final storage = AppStorage(await SharedPreferences.getInstance());
  runApp(ProviderScope(
      overrides: [storageProvider.overrideWithValue(storage)],
      child: const PixiShelfApp()));
}

class PixiShelfApp extends StatelessWidget {
  const PixiShelfApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
      title: 'PixiShelf',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
          value: AppTheme.lightBars, child: child!),
      home: const AppShell());
}

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});
  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  MobileApi? _api;
  bool _booting = true;
  String? _message;
  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final session = await ref.read(storageProvider).readSession();
      if (mounted) {
        setState(() {
          _api = session == null ? null : MobileApi(session);
          _booting = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _booting = false;
          _message = '安全存储不可用，请重新登录';
        });
      }
    }
  }

  Future<void> _login(Session session) async {
    await ref.read(storageProvider).saveSession(session);
    if (mounted) {
      setState(() {
        _api = MobileApi(session);
        _message = null;
      });
    }
  }

  Future<void> _logout({bool expired = false}) async {
    final api = _api;
    if (!expired) {
      try {
        await api?.request('session', method: 'DELETE');
      } catch (_) {}
    }
    api?.close();
    var cleared = true;
    try {
      await ref.read(storageProvider).clearSession();
    } catch (_) {
      cleared = false;
    }
    if (mounted) {
      setState(() {
        _api = null;
        _message = !cleared
            ? '本机安全存储清除失败，请在系统设置中清除此 App 的数据'
            : expired
                ? '登录已失效，请重新登录'
                : null;
      });
    }
  }

  @override
  void dispose() {
    _api?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_api != null) {
      return GalleryView(
          key: ValueKey(_api),
          api: _api!,
          storage: ref.read(storageProvider),
          onLogout: () => _logout(),
          onExpired: () => _logout(expired: true));
    }
    return LoginView(message: _message, onLogin: _login);
  }
}

class LoginView extends StatefulWidget {
  final String? message;
  final Future<void> Function(Session) onLogin;
  const LoginView({super.key, this.message, required this.onLogin});
  @override
  State<LoginView> createState() => _LoginViewState();
}

class _LoginViewState extends State<LoginView> {
  final _server = TextEditingController(),
      _username = TextEditingController(),
      _password = TextEditingController();
  bool _busy = false, _showPassword = false;
  String? _error;
  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = await MobileApi.login(
          _server.text, _username.text.trim(), _password.text);
      await widget.onLogin(session);
      _password.clear();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e is ApiFailure
            ? (e.status == 401 ? '用户名或密码不正确' : e.message)
            : '无法安全保存登录，请重试');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _server.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final message = _error ?? widget.message;
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(builder: (context, constraints) {
          return SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
            child: Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(
                    maxWidth: 420,
                    minHeight:
                        (constraints.maxHeight - 48).clamp(0, double.infinity)),
                child: AutofillGroup(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(children: [
                        const Icon(Icons.photo_library_outlined,
                            size: 28, color: AppTheme.blue),
                        const SizedBox(width: 12),
                        Expanded(
                            child: Text('PixiShelf',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.titleLarge?.copyWith(
                                    fontSize: 26, letterSpacing: -0.6))),
                      ]),
                      const SizedBox(height: 40),
                      Text('回到你的收藏', style: theme.textTheme.headlineMedium),
                      const SizedBox(height: 10),
                      Text('连接你的图库，继续发现喜欢的作品。',
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(color: AppTheme.muted)),
                      const SizedBox(height: 32),
                      _field('服务器地址',
                          child: TextField(
                            controller: _server,
                            enabled: !_busy,
                            keyboardType: TextInputType.url,
                            autocorrect: false,
                            decoration: const InputDecoration(
                                hintText: 'https://gallery.example.com'),
                            textInputAction: TextInputAction.next,
                          )),
                      const SizedBox(height: 20),
                      _field('用户名',
                          child: TextField(
                            controller: _username,
                            enabled: !_busy,
                            autofillHints: const [AutofillHints.username],
                            autocorrect: false,
                            decoration: const InputDecoration(
                                hintText: '你的 PixiShelf 用户名'),
                            textInputAction: TextInputAction.next,
                          )),
                      const SizedBox(height: 20),
                      _field('密码',
                          child: TextField(
                            controller: _password,
                            enabled: !_busy,
                            obscureText: !_showPassword,
                            autofillHints: const [AutofillHints.password],
                            textInputAction: TextInputAction.done,
                            decoration: InputDecoration(
                              hintText: '输入账户密码',
                              suffixIcon: IconButton(
                                tooltip: _showPassword ? '隐藏密码' : '显示密码',
                                onPressed: _busy
                                    ? null
                                    : () => setState(
                                        () => _showPassword = !_showPassword),
                                icon: Icon(
                                    _showPassword
                                        ? Icons.visibility_off_outlined
                                        : Icons.visibility_outlined,
                                    size: 20),
                              ),
                            ),
                            onSubmitted: (_) => _submit(),
                          )),
                      if (message != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: Semantics(
                              liveRegion: true,
                              child: Text(message,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                      color: theme.colorScheme.error))),
                        ),
                      const SizedBox(height: 28),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (_busy) ...[
                                const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2)),
                                const SizedBox(width: 12),
                              ],
                              Text(_busy ? '正在连接…' : '进入图库'),
                              if (!_busy) ...[
                                const SizedBox(width: 10),
                                const Icon(Icons.arrow_forward, size: 18),
                              ],
                            ]),
                      ),
                      const SizedBox(height: 24),
                      Text('使用已有 PixiShelf 账户登录',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall
                              ?.copyWith(color: AppTheme.muted)),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _field(String label, {required Widget child}) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ExcludeSemantics(
                child: Text(label,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600))),
          ),
          Semantics(label: label, child: child),
        ],
      );
}
