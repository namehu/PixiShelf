# @pixishelf/webp-player

PixiShelf 私有浏览器 WebP 流式播放器，默认用于手动播放和自动浏览，无需配置启用变量。产品范围、UML 和剩余真机/反代验证见 [播放器架构](../../docs/architecture/webp-player.md)。

## 构建与验证

日常开发和应用构建只需要 Node.js、pnpm。`prebuilt/libwebp-1.6.0/` 随仓库保存已经编译的解码器、许可证与校验清单，无需安装 Emscripten 或启动 Docker。运行时资源全部同源。

```sh
pnpm --filter @pixishelf/webp-player verify:prebuilt
pnpm --filter @pixishelf/webp-player test:prebuilt
pnpm --filter @pixishelf/webp-player build
pnpm --filter @pixishelf/webp-player typecheck
pnpm --filter @pixishelf/webp-player test
pnpm --filter @pixishelf/webp-player test:browser
pnpm --filter @pixishelf/webp-player demo
```

浏览器测试在 Windows 使用本机 Edge，Linux 使用 Playwright Chromium（先运行包内 `pnpm exec playwright install --with-deps chromium`）。演示服务只监听 `127.0.0.1:5439`，不接入生产、不含用户媒体。测试 fixture 为自行生成，可用 `node scripts/fixtures.mjs` 重建；benchmark 为合成 1080p/24fps 样本，不能替代真实收藏和安卓真机性能证据。

`tests/fixtures/*.webp` 全部由上述脚本的纯色色块生成，包括 `independent*.webp`；不含用户原图、抽帧、裁剪或重编码内容。私有性能样本只能通过实验服务的 `--source` 显式引用仓库外文件，不得复制进测试目录或提交。

只有修改 C 封装、编译脚本或升级 `native/toolchain.json` 时，才需要 Docker 重新生成预编译产物：

```sh
pnpm --filter @pixishelf/webp-player build:native
pnpm --filter @pixishelf/webp-player build:native --check
```

第一条固定镜像编译并运行原生差分、ASan/UBSan，成功后更新 prebuilt；需将源码、六个产物与 manifest 一起提交。第二条重新编译并逐字节对比，不改写 prebuilt，用于验证可复现性。它们只操作包内缓存和产物，不连接数据库或收藏目录。

manifest 记录工具链、构建输入 SHA-256 和六个产物的 SHA-256；日常 build 自动检查源码是否过期、产物是否损坏、许可证是否缺失和 WASM 格式。源码哈希统一 LF，产物保留原始字节并排除格式化。普通 CI 只做校验、JS 构建和播放器测试；独立 `webp-native.yml` 仅在原生/预编译相关文件变化或手动触发时重编译。

## SIMD 与兼容回退

固定工具链同时编译 `decoder.mjs/wasm`（显式关闭 SIMD）与 `decoder-simd.mjs/wasm`（开启 `WEBP_ENABLE_SIMD`，链接使用 `-msimd128`）。构建脚本还修正固定 libwebp 1.6.0 的 Emscripten SIMD 枚举截止位置，使 SSE2 核心解码内核参与编译（上游列表新增 AVX2 后，旧索引会漏掉 SSE2）；升级版本时必须复核此修正。两者沿用相同内存预算，不使用线程或 SharedArrayBuffer。

Worker 用最小 WASM 模块检测 SIMD 支持，只请求选中的解码器；SIMD 初始化失败时尝试兼容版。自定义解码器 URL 保持原行为，仅标准 `decoder.mjs` 入口自动选择同目录 SIMD 产物。版本哈希与预编译校验包含两套产物，诊断报告 `decoderVariant` 标明实际选择（`simd` / `scalar`）。关闭诊断不增加统计消息。

## 上游合成逻辑

`native/stream-decoder.c` 在同一编译单元包含固定版本 `src/demux/anim_decode.c`，复用其透明、清除、局部帧合成，而非重新实现混合公式。封装负责为部分数据重建 demux，先释放旧 iterator，再恢复上一帧元数据，保留两张合成画布。

这是明确且局部的上游内部结构依赖。升级 libwebp 必须审查结构变化并重跑原生差分、ASan/UBSan、真实 WASM 与浏览器测试。构建资源保留上游 COPYING 和 PATENTS，二进制与工具链版本写入 manifest。

## 接口与运行行为

公开入口为 `src/index.ts`，源参数、事件和预算类型由 `src/types.ts` 定义。播放时钟、独立帧门禁、顺序回退、循环、暂停、账户生命周期及压缩复用统一维护在[播放器架构](../../docs/architecture/webp-player.md)，不在包 README 复制。

## UML 重新生成

```sh
pnpm docs:diagrams
```

`.mmd` 是源文件，SVG 为便于离线评审保留的可重建文档产物。

## 只读快速路径覆盖率抽样

在已安装工作区开发依赖（含 esbuild）的源码检出中运行；生产镜像不保证包含这些依赖。工具直接复用当前 TypeScript 门禁，不需要启动应用、数据库或解码器。

```sh
node packages/pixishelf-webp-player/scripts/scan-coverage.mjs --path /absolute/library --limit 100 --max-entries 10000 --rate-mib 8 > /tmp/webp-coverage.json
node --test packages/pixishelf-webp-player/tests/scan-coverage.test.mjs
```

需要无工作区依赖的便携脚本时，运行 `node packages/pixishelf-webp-player/scripts/build-coverage-scanner.mjs /tmp/scan-coverage.mjs`，再在目标机器执行生成脚本。门禁变更后必须重新生成；报告 `gateVersion: opaque-vp8-flags-0-or-2-v1` 标识本次规则，旧报告保持原有含义。生成文件留在仓库外。

`--path` 可重复，必须显式指定；目录只选择 `.webp`（不区分大小写），不跟随符号链接（包括路径祖先）。默认最多 100 个候选文件、10000 个遍历条目、64 层目录，单文件超过 256MiB 则记为未检查，可用 `--max-file-mib` 调整。按目录遍历顺序取前 N 个，**不是随机抽样或全库覆盖率**。读取串行且默认限速 8MiB/s；仍有 NAS 读取成本。Ctrl-C 会输出部分报告；`partial`、错误计数和各项限额状态表明检查是否完整。

报告只含聚合：整段符合／首帧前退出／中途退出、首个退出原因与位置桶，以及尺寸、帧数、归一化时长和字节量的数量／总和／最小／最大值。不输出路径、标题、原始异常或逐文件记录，不上传或修改媒体。扫描逐块读取，单块暂存上限 2MiB，较大块用 64KiB 分段丢弃；不会缓存整段压缩输入。内存还包括固定深度目录句柄、最多样本数的去重标识和临时提取帧。

结果仅反映容器解析和当前快速路径门禁，不验证压缩像素是否可解码，也不代表实时播放比例。`frame-size-budget` 是生产单帧预算拒绝；此外不同设备的输入、画布及总内存预算仍可能拒绝结构合格文件。错误／超限文件不进入比例分母，静态 WebP 单列。报告建议留在仓库外，不提交私人图库结果。
