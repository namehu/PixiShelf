# WebP 生产构建手机复核

这里保留生产路径验收工具，以及不依赖私人素材的节奏复现实验。播放器实现和验收结论见[手机验证记录](../../../docs/records/architecture/webp-mobile-verification.md)。原生读回、固定抽帧、单 Worker 自适应、并行额度和内部插桩等历史实验已归档到本机 Git 忽略的 `.local-data/webp-investigation-2026-10-08/experiment-source/`，不作为构建或测试依赖。

## 保留内容

- `serve-native.mjs`：沿用旧命令名的白名单服务，只提供指定原图、生产页面和 `dist` 运行资源；不需要 profile 产物。
- `lan/production.html` / `production.js`：生产播放器单轮测试三次，支持停止、后台中止及本地 JSON 导出；没有遮挡或像素读回。
- `full-frame-webp.mjs`：当前复核样本的严格独立 VP8 帧元数据解析器，拒绝透明、局部及其他布局。它不是通用 WebP 检查器，不限制正式播放器的格式支持。
- `phone-ui.py` / `phone-batch.py`：可选 adb 操作和报告拉取，设备由 `ANDROID_SERIAL` 显式指定。
- `cadence-audit.mjs`：匿名 17／16／17ms 时间序列，复现旧实验的切换网格错误和刷新相位影响，对照整数网格及独立显示时刻；不模拟实际吞吐，不属于生产入口。

## 无素材节奏核对

```bash
node packages/pixishelf-webp-player/experiments/cadence-audit.mjs
node --test packages/pixishelf-webp-player/tests/cadence-audit.test.mjs
pnpm --filter @pixishelf/webp-player exec vitest run src/__tests__/player.test.ts
```

前两项验证选择和呈现时间模型，后一项包含实际播放器在可控时钟、四额度假 Worker 下的相位复现。模型的帧均提前就绪，不能将结果解释为 Worker/WASM 性能或手机屏幕呈现。当前策略和手机验证入口见[播放器架构](../../../docs/architecture/webp-player.md)，历史数值门槛只适用于对应样本与版本。

## 使用

在仓库根目录执行：

```bash
pnpm --filter @pixishelf/webp-player build
node packages/pixishelf-webp-player/experiments/serve-native.mjs --source /absolute/sample.webp --port 5449
```

服务默认仅监听 `127.0.0.1`，输出随机路径。输入必须显式指定且不超过 128MiB；不开放目录或上传。服务端读取文件用于提供响应，浏览器仍通过真实 HTTP 流加载原图，不预载压缩原图再播放。私有素材不得复制进仓库。

```bash
export ANDROID_SERIAL=YOUR_DEVICE_SERIAL
adb -s "$ANDROID_SERIAL" reverse tcp:5449 tcp:5449
# 手机在同一个测试浏览器打开 http://localhost:5449/RANDOM/production.html
```

点击「生产路径 × 3」，观察速度与动作，然后下载或复制报告。只保留最近十次结果，复制失败可手动复制；Canvas 调用间隔不代表屏幕呈现。可选自动运行与导出：

```bash
python3 packages/pixishelf-webp-player/experiments/phone-ui.py status
python3 packages/pixishelf-webp-player/experiments/phone-batch.py production .local-data/webp-reports
```

自动导出针对已授权且打开测试页的 Via 浏览器；下载对话框变化时可能停止，需人工处理。脚本只拉取本次新增报告，不上传；`phone-ui.py` 在设备 Download 临时生成 UI XML。

完成后停止服务并清理本次映射和临时 UI 文件，不清理其他端口：

```bash
adb -s "$ANDROID_SERIAL" reverse --remove tcp:5449
adb -s "$ANDROID_SERIAL" shell rm -f /sdcard/Download/webp-test-ui.xml
```

解析器回归：`node --test packages/pixishelf-webp-player/tests/production-preview-metadata.test.mjs`。正式播放器回归仍由包内单元及浏览器测试负责。原始性能 JSON 保留在本地，不加入 docs。
