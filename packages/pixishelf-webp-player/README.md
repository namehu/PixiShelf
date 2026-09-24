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

只有修改 C 封装、编译脚本或升级 `native/toolchain.json` 时，才需要 Docker 重新生成预编译产物：

```sh
pnpm --filter @pixishelf/webp-player build:native
pnpm --filter @pixishelf/webp-player build:native --check
```

第一条固定镜像编译并运行原生差分、ASan/UBSan，成功后更新 prebuilt；需将源码、四个产物与 manifest 一起提交。第二条重新编译并逐字节对比，不改写 prebuilt，用于验证可复现性。它们只操作包内缓存和产物，不连接数据库或收藏目录。

manifest 记录工具链、构建输入 SHA-256 和四个产物的 SHA-256；日常 build 自动检查源码是否过期、产物是否损坏、许可证是否缺失和 WASM 格式。源码哈希统一 LF，产物保留原始字节并排除格式化。普通 CI 只做校验、JS 构建和播放器测试；独立 `webp-native.yml` 仅在原生/预编译相关文件变化或手动触发时重编译。

## 上游合成逻辑

`native/stream-decoder.c` 在同一编译单元包含固定版本 `src/demux/anim_decode.c`，复用其透明、清除、局部帧合成，而非重新实现混合公式。封装负责为部分数据重建 demux，先释放旧 iterator，再恢复上一帧元数据，保留两张合成画布。

这是明确且局部的上游内部结构依赖。升级 libwebp 必须审查结构变化并重跑原生差分、ASan/UBSan、真实 WASM 与浏览器测试。构建资源保留上游 COPYING 和 PATENTS，二进制与工具链版本写入 manifest。

## 接口行为

`load` 返回首帧已解码的 Promise；`play` 登记播放意图；`pause` 保留剩余时长；`restart` 从头新建请求；`destroy` 幂等。无总时长和 seek 承诺。完成只在合法 EOF 与末帧时长都结束后发出。

`load({ ..., loop: true })` 遵循 WebP 文件的循环次数，0 表示无限；每轮复用同一 Worker、WASM 输入和合成画布，不重新下载。省略 loop 则只播放一轮。应用手动 WebP 与自动浏览都使用 WASM，手动开启 loop，自动浏览关闭 loop。手动控制的暂停保留既有「回海报、再次点击从头开始」行为；自动浏览控制条暂停则保留帧进度。Elements 中可检查 `canvas[data-webp-player="wasm"][data-frame-visible="true"]`。

静态资源由 `prepare:app` 复制到主应用的生成目录。下载源限制同源，沿用会话凭证；不允许任意跨源地址。按视口宽度选择输入上限：低于 768px 为 128 MiB，其余为 256 MiB；画布阈值仍为 400/800 万像素。输入从 64 KiB 扩容，原生堆上限为 384/768 MiB，受管预算为 432/864 MiB，包含扩容时旧/新输入可能共存及三份输出帧估算。该视口分类不判断真实设备内存；预算只覆盖该引擎管理的资源，不代表浏览器进程内存上限。

应用每次 `dev` / `build` 都校验 prebuilt，自动 bundle Worker/播放器 JS 并准备资源，完全不读取 `dist/native`，没有启用开关。Worker/WASM 仍在用户开始播放时按需请求。应用 Dockerfile 同样直接使用仓库产物，没有原生编译阶段。版本目录按 Worker、解码器 JS/WASM 内容哈希命名，manifest 不强缓存。

应用运行时通过全局 `useWebpPlayerStore` 缓存 manifest，使用 sessionStorage 保存已校验的版本及所属账号；同一标签页会话内跨页面、刷新、重复播放均复用。并发加载共享一个 Promise，播放器卸载不取消共享请求。读取失败不缓存，后续加载可重试；退出登录或切换账号会清空缓存并取消旧请求，旧响应不能写回新会话。资源初始化失败会使对应版本失效，下次初始化重新读取。存储不可用时退回 Zustand 内存缓存。只缓存资源版本，不缓存媒体、Worker 或登录凭证。

性能测试应独立运行；与全量测试/构建并发会争抢 CPU，不能作为无负载基线。正式发布仍需真实 Android Chrome 和实际反向代理验收，详见方案末尾证据。

## UML 重新生成

```sh
pnpm --filter @pixishelf/webp-player diagrams
```

`.mmd` 是源文件，SVG 为便于离线评审保留的可重建文档产物。
