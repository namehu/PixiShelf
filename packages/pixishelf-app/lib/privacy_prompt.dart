import 'package:flutter/material.dart';
import 'storage.dart';

Future<bool?> confirmGalleryPrivacy(
    BuildContext context, AppStorage storage) async {
  final remembered = storage.rememberedPrivacy;
  if (remembered != null) return remembered;
  var remember = false;
  final choice = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => PopScope(
        canPop: false,
        child: StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: const Text('进入个人图库'),
            content: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('图库可能包含成人内容。继续即确认你已成年。隐私模式会遮蔽图片和文字，不影响阅读记录。'),
              CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: remember,
                  onChanged: (value) => update(() => remember = value ?? false),
                  title: const Text('记住选择 30 天')),
            ])),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('隐私模式进入')),
              FilledButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('原始模式进入')),
            ],
          ),
        )),
  );
  if (choice != null) await storage.rememberPrivacy(choice, remember);
  return choice;
}
