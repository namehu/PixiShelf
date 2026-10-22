---
status: historical
scope: WebP 流式播放器初次接入与构建验收记录
last-verified: 2026-10-08
---

# WebP 流式播放器实施证据

当前行为见[播放器架构](../../architecture/webp-player.md)。下文按实施时点保留，早期双帧顺序路径不能代表后来独立帧路径。

## 实施证据

P0–P3 已实现，P4 工程构建已验证，本地代码默认启用。生产部署版本及完整部署环境验收待核实；下列历史记录保留当时的测试范围，最新手机结论见[生产接入记录](../../design/webp-mobile-production.md)。

### 代码落点

| 文件/目录                                                                                 | 职责                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/pixishelf-webp-player/native/`                                                  | 固定源码校验、部分输入 C ABI、官方合成器复用、原生差分与 ASan/UBSan |
| `packages/pixishelf-webp-player/src/worker.ts`                                            | 单请求协调、逐帧门禁、双子 Worker／四额度、顺序回退                 |
| `packages/pixishelf-webp-player/src/player.ts`、`media-clock.ts`、`clock.ts`              | 状态机、独立媒体时钟／顺序时钟、绘制、尝试隔离、一次完成            |
| `packages/pixishelf-webp-player/scripts/`                                                 | 固定 Docker 工具链、bundle、哈希资源、演示服务、图表重建            |
| `packages/pixishelf/components/players/streaming-webp-surface.tsx`                        | React 实例生命周期、事件适配                                        |
| `packages/pixishelf/components/players/animated-webp-player.tsx`                          | 默认 WASM、海报、兼容回退、控制按钮                                 |
| `packages/pixishelf/store/use-artwork-auto-browse-store.ts` 与 `use-artwork-animation.ts` | 暂停保留占用，错误/离开释放，稳定尝试键                             |
| `build/Dockerfile`、`.github/workflows/ci.yml`                                            | 编译、交付资源和 CI 验证                                            |

### 2026-09-23 本机验证（历史）

- Windows x64，Intel i7-13700H、20 逻辑线程、64 GiB；Node 22.17.0。Docker 构建使用 Node 20。
- 固定 libwebp 1.6.0，源码 SHA-256 `e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564`；Emscripten 6.0.10 镜像 digest 固定于 `native/toolchain.json`，日常应用构建不使用该镜像。
- 原生 ASan/UBSan 差分通过：空输入、按 1/7/127 字节喂入、有损/无损/透明/局部/清除/混合、短帧、截断、压缩预算。与官方完整输入解码逐帧像素一致。
- 包 typecheck、9 项单元测试、build 通过；真实 Edge 153.0.4234.48 和 Chrome 153.0.8010.53 各 11 项浏览器测试通过。真实 HTTP 先发两帧后暂扣 2.5 秒，释放前已推进到第二帧且进入缓冲；验证一次完成、暂停、鉴权、网络断流、截断、元数据/预算以及 50 次创建销毁。
- 合成 1080p/24fps（240 帧）无重负载并发时，Edge 9990.5ms，Chrome 9992.2ms。与主应用全量测试并发时曾达到 12446.8ms，超过门槛；因此不承诺高 CPU 压力下仍按原速播放。
- 主应用 lint、typecheck 通过；完整测试 330 文件、2067 项通过，20 文件、129 项 PostgreSQL 条件测试跳过。新增 8 项联动用真实播放器/时钟/React/store/两种驱动，仅替换 Worker 传输、Canvas、布局环境。
- 初版启用流式播放的提升权限 Next production build 和完整 Docker production 镜像构建通过；镜像 `pixishelf:webp-validation` 只用于本地验证，没有部署。无业务挂载、无网络的 UID 1001 容器验证资源哈希、WASM 字节码及许可证通过：版本 `72920e0b425f4d3e`，WASM 135801 字节。镜像构建因没有运行时认证环境而输出 Better Auth 配置警告，不把构建成功当作业务运行验收。
- UML 的 `.mmd` 与 `.svg` 均落盘，并渲染检查。路径大小写与 diff 检查通过。

### 预编译交付调整

- 解码器 JS/WASM、许可证与 manifest 已落盘到 `packages/pixishelf-webp-player/prebuilt/libwebp-1.6.0/`，合计约 145 KiB，随源码纳入版本管理。Git 不转换产物换行，格式化工具跳过该目录。
- 普通应用和镜像构建校验并复制 prebuilt，不读取本地 `dist/native`，不拉取 Emscripten、不编译 C。CI 原生复编译拆到按路径触发的 `webp-native.yml`。
- 新增 5 项校验测试覆盖产物损坏、源码过期、跨平台换行、工具链不匹配及许可证缺失，全部通过；包类型检查、9 项单元测试和 11 项 Edge 浏览器测试通过，1080p 合成样本播放耗时 9991.8ms。
- `build:native --check` 的原生差分、ASan/UBSan 与四个产物逐字节复编译对比通过；固定工具链非 root 编译探针通过。应用 lint、完整测试与开启开关的 Next production build 再次通过。
- 新生产镜像 `pixishelf:webp-prebuilt-validation` 构建通过，Docker 上下文排除本地 dist/cache/public 生成目录，构建仅使用 Node 基础镜像。离线 UID 1001 容器中的资源版本哈希、WASM SHA-256/字节码和许可证验证通过，资源版本仍为 `72920e0b425f4d3e`。没有部署或启动业务入口。

### 手动播放扩展验证

手动 WASM 扩展的本机验证：新增 7 项应用用例覆盖两个手动按钮入口、外部控制转单轮、兼容回退和格式/开关边界；与原播放器用例合计 29 项定向检查通过。原生 ASan/UBSan 增加多轮像素差分和有限循环终止检查，全部通过。14 项 Edge 浏览器测试通过，包含首轮 EOF 前播放、跨轮仅一个 HTTP 请求和 Worker、循环 1/2 次结束，以及原有性能门槛（9992.8ms）。新的预编译 WASM 为 135953 字节，运行资源版本 `22e63013e962eca9`；原生资源已更新，日常启动仍无需编译 C。类图与时序图的源文件和 SVG 已同步落盘。

本次扩展最终检查：主应用 lint 通过，完整单元测试 2074 项通过、129 项 PostgreSQL 条件测试跳过；开启开关的 Next production build（含类型检查）通过。构建输出已有批量导入服务动态文件路径匹配过宽的警告，与播放器改动无关。路径命名和 diff 检查通过；本次没有重新部署或执行远端 CI。

### 会话清单缓存验证

Zustand store、认证边界和播放器联动合计 42 项定向用例通过，覆盖并发合并、失败重试、sessionStorage 恢复、存储不可用、账号切换、退出登录、迟到响应、StrictMode、组件卸载和资源初始化失效。主应用 lint 通过；全量测试 2086 项通过、129 项 PostgreSQL 条件测试跳过，报告服务的一个用例触发 5 秒超时，随后单独重跑该文件 4 项全通过（超时用例耗时 422ms）。缓存类图的 `.mmd` 与 SVG 已更新并渲染检查。

会话缓存最终构建（含 TypeScript 检查）已通过；仍有上述批量导入路径扫描警告。修正请求身份比较的类型检查问题后，42 项定向用例再次通过，路径命名和 diff 检查通过。未修改原生解码器或预编译文件。

### 默认启用交付验证

按用户要求删除启用变量：播放器默认进入 WASM，dev/build 无条件准备预编译资源，Dockerfile 和 CI 均无需开关。35 项播放器定向用例通过；预览页兼容回退的 15 项测试、浏览页默认创建 WASM Canvas 的 4 项测试分别通过。lint 和不带 WebP 参数的 Next production build（含类型检查）通过，仍有上述已有路径扫描警告。

全量测试完成：2082 项通过，129 项 PostgreSQL 条件测试跳过；另有 4 项旧 `img` 播放断言失败，涉及上述预览页和浏览页两个文件。已将旧播放时钟测试明确设为兼容回退，并将浏览页播放入口改为验证默认 WASM Canvas；修正后两个文件的 19 项测试全部通过，未再次重复全量测试。

不传 WebP build-arg 的生产镜像 `pixishelf:webp-default-validation` 构建通过。使用 `--network none`、覆盖 entrypoint 的 UID 1001 容器验证资源版本哈希、预编译 WASM SHA-256、字节码与许可证通过：版本 `22e63013e962eca9`，WASM 135953 字节。验证未运行业务入口或数据库迁移。普通构建仍只校验、复制预编译解码器并打包 JS，不编译 C。

### 2026-09-24 文件上限与回退反馈验证

压缩输入扩容、借用迭代器释放和循环重建由原生 ASan/UBSan 差分检查覆盖：首帧已解出且 demux/上一帧迭代器仍持有输入时，至少三次 `realloc` 实际搬迁，随后跨三轮与官方解码器逐帧比对像素；12 字节硬上限和截断输入也通过。固定 Docker 工具链重新生成 WASM 和清单，`build:native --check` 的逐字节复现通过，未手工编辑生成物。

包类型检查、10 项单元测试、5 项 prebuilt 负向校验、构建及 19 项 Edge 真实 HTTP 浏览器测试通过。浏览器直接从有效 WebP 加分块 RIFF 尾块，验证窄屏 33 MiB、宽屏 65 MiB 超过旧上限仍完整播放，129/257 MiB 分别被新硬上限拒绝；桌面测试实际创建 768 MiB 最大页数的 WASM Memory。1080p/24fps 合成样本耗时 9990.2ms，低于 11000ms 门槛。主应用相关 51 项定向用例及 typecheck 通过，包含 4 秒提示、重渲染计时、切图清理、原因展示与持久诊断属性。

最终应用检查：lint 无错误、无警告；全量单元测试 332 文件、2087 项通过，20 文件、129 项 PostgreSQL 条件测试跳过；Next production build（含类型检查）通过，仍有既有批量导入动态路径匹配过宽的构建警告。最终生成资源版本为 `66a94f8eea6a57ad`，WASM 138699 字节。时序图源文件与 SVG 已同步，图表渲染、路径命名与 diff 检查通过。没有执行生产部署。

### 部署核验与后续验证

1. 当前手机样本已通过客观及人工验收；不透明全画布 VP8 已允许 flags=0/2；新增准入样本的手机性能、依赖帧回退停顿、长时间温控和浏览器进程内存尚未完整验证，不保证所有 WebP 或设备实时。
2. 核实目标环境部署版本、资源 hash、远端 CI 和详情页播放／暂停续播／自动切图；不得用本地提交或历史镜像构建推断线上状态。

开发直接运行 `pnpm --filter @pixishelf/next dev`；无需环境变量或原生编译，不在仓库根目录运行无过滤的 `pnpm dev`。镜像验证使用 `docker build -f build/Dockerfile .`，普通发布镜像即包含并默认启用播放器。仅修改原生实现时执行 `pnpm --filter @pixishelf/webp-player build:native` 并提交预编译产物，使用 `build:native --check` 复核字节一致性。回滚使用原应用镜像，无数据库/媒体恢复操作。

## 2026-10-08 独立帧路径接入

原“所有帧仍顺序解码合成”约束仅适用于依赖帧/顺序回退路径。默认播放器对逐帧验证为完整独立 VP8 的画面使用双子 Worker、四输出额度；解码落后时可以省略已过时的独立帧解码，保留首末帧和 EOF 检查。未知未来帧不能继承独立性，出现依赖时从本次请求已收的压缩数据恢复顺序合成，已输出帧不重复显示。预算不符时继续原路径。具体门禁、已验证范围与缺口以[生产接入记录](../../design/webp-mobile-production.md)为准；无需新部署开关、数据库迁移或媒体转换。
