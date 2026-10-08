# @pixishelf/webp-player

PixiShelf 私有浏览器 WebP 流式播放器，默认用于手动播放和自动浏览，无需配置启用变量。产品范围、UML 和剩余真机/反代验证见 [开发方案](../../docs/design/webp-streaming-player.md)。

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

## 接口行为

`load` 返回首帧已解码的 Promise；`play` 登记播放意图；`pause` 保留剩余时长；`restart` 从头新建请求；`destroy` 幂等。无总时长和 seek 承诺。完成只在合法 EOF 与末帧时长都结束后发出。

`load({ ..., loop: true })` 遵循 WebP 文件的循环次数，0 表示无限；每轮复用同一 Worker、WASM 输入和合成画布，不重新下载。省略 loop 则只播放一轮。应用手动 WebP 与自动浏览都使用 WASM，手动开启 loop，自动浏览关闭 loop。手动控制的暂停保留既有「回海报、再次点击从头开始」行为；自动浏览控制条暂停则保留帧进度。Elements 中可检查 `canvas[data-webp-player="wasm"][data-frame-visible="true"]`。

静态资源由 `prepare:app` 复制到主应用的生成目录。下载源限制同源，沿用会话凭证；不允许任意跨源地址。按视口宽度选择输入上限：低于 768px 为 128 MiB，其余为 256 MiB；画布阈值仍为 400/800 万像素。输入从 64 KiB 扩容，原生堆上限为 384/768 MiB，受管预算为 432/864 MiB，直接顺序路径包含扩容时旧/新输入可能共存及三份输出帧估算。独立帧路径预留两个 128MiB 堆、原压缩字节、临时输入和五幅 RGBA，满足总预算才启用四额度；中途回退仍保留四额度并降低原生堆预算。该视口分类不判断真实设备内存；预算只覆盖该引擎管理的资源，不代表浏览器进程内存上限。

应用每次 `dev` / `build` 都校验 prebuilt，自动 bundle Worker/播放器 JS 并准备资源，完全不读取 `dist/native`，没有启用开关。Worker/WASM 仍在用户开始播放时按需请求。应用 Dockerfile 同样直接使用仓库产物，没有原生编译阶段。版本目录按 Worker、解码器 JS/WASM 内容哈希命名，manifest 不强缓存。

应用运行时通过全局 `useWebpPlayerStore` 缓存 manifest，使用 sessionStorage 保存已校验的版本及所属账号；同一标签页会话内跨页面、刷新、重复播放均复用。并发加载共享一个 Promise，播放器卸载不取消共享请求。读取失败不缓存，后续加载可重试；退出登录或切换账号会清空缓存并取消旧请求，旧响应不能写回新会话。资源初始化失败会使对应版本失效，下次初始化重新读取。存储不可用时退回 Zustand 内存缓存。只缓存资源版本，不缓存媒体、Worker 或登录凭证。

性能测试应独立运行；与全量测试/构建并发会争抢 CPU，不能作为无负载基线。正式发布仍需真实 Android Chrome 和实际反向代理验收，详见方案末尾证据。

## UML 重新生成

```sh
pnpm --filter @pixishelf/webp-player diagrams
```

`.mmd` 是源文件，SVG 为便于离线评审保留的可重建文档产物。

## 独立帧生产路径

默认逐帧检查独立性，不预下载全图判断。合格的完整 VP8 帧使用两个解码子 Worker、四个输出额度；实际落后时省略过期独立帧，原尺寸不变。局部、透明、清除、混合等帧转回现有 libwebp 合成器，复用已收字节恢复状态，不重新下载或重复显示已交付帧。直接顺序路径保持原行为。`decodeStrategy: "sequential"` 仅供内部对照，应用无需额外配置。

已进入快速路径后，顶层未知块及未声明的 ICCP／EXIF／XMP 会跳过；声明元数据的文件仍由头部门禁交给顺序路径。重复 ANIM 沿用 libwebp 的填充后长度至少六字节规则，仍校验完整输入与零填充。动画顶层 ALPH／VP8／VP8L／重复 VP8X 或过短 ANIM 直接报错，不通过重放尝试修复。扫描工具复用相同分类。

完成依赖有效 EOF 和末帧的绘制机会；解码落后不等同于网络等待，解析预读窗口耗尽也不能单独冻结时间轴。内存门禁、保守格式限制、手机生产构建报告和回退代价见[生产接入记录](../../docs/design/webp-mobile-production.md)。

## 只读快速路径覆盖率抽样

在已安装工作区开发依赖（含 esbuild）的源码检出中运行；生产镜像不保证包含这些依赖。工具直接复用当前 TypeScript 门禁，不需要启动应用、数据库或解码器。

```sh
node packages/pixishelf-webp-player/scripts/scan-coverage.mjs --path /absolute/library --limit 100 --max-entries 10000 --rate-mib 8 > /tmp/webp-coverage.json
node --test packages/pixishelf-webp-player/tests/scan-coverage.test.mjs
```

`--path` 可重复，必须显式指定；目录只选择 `.webp`（不区分大小写），不跟随符号链接（包括路径祖先）。默认最多 100 个候选文件、10000 个遍历条目、64 层目录，单文件超过 256MiB 则记为未检查，可用 `--max-file-mib` 调整。按目录遍历顺序取前 N 个，**不是随机抽样或全库覆盖率**。读取串行且默认限速 8MiB/s；仍有 NAS 读取成本。Ctrl-C 会输出部分报告；`partial`、错误计数和各项限额状态表明检查是否完整。

报告只含聚合：整段符合／首帧前退出／中途退出、首个退出原因与位置桶，以及尺寸、帧数、归一化时长和字节量的数量／总和／最小／最大值。不输出路径、标题、原始异常或逐文件记录，不上传或修改媒体。扫描逐块读取，单块暂存上限 2MiB，较大块用 64KiB 分段丢弃；不会缓存整段压缩输入。内存还包括固定深度目录句柄、最多样本数的去重标识和临时提取帧。

结果仅反映容器解析和当前快速路径门禁，不验证压缩像素是否可解码，也不代表实时播放比例。`frame-size-budget` 是生产单帧预算拒绝；此外不同设备的输入、画布及总内存预算仍可能拒绝结构合格文件。错误／超限文件不进入比例分母，静态 WebP 单列。报告建议留在仓库外，不提交私人图库结果。
