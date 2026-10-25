---
status: historical
scope: 第一批完整包含的实现、定向验证、独立审查和隔离浏览器验收
last-verified: 2026-10-25
sources:
  - docs/design/artwork-deduplication/matching-extension.md
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-executor.ts
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-preview.tsx
---

# 完整包含第一批验收

## 范围与版本

基线为主目录 `/Users/namehu/mm_code/PixiShelf` 的 `main`、`dda9c129`；本批变更尚未提交。用户授权仅做第一批完整包含，完成检查、确认和删除流程验收后暂停，不继续视觉版本识别，不重复全量构建或验证。

复杂后端由 GPT-6 Astra / high 实施；界面与独立审查分别由 GPT-6.1 Sol / xhigh 执行；浏览器使用 GPT-6.1 Sol / medium。一次只运行一个子 agent。

本批保留原精确重复行为，新增 SHA-256 多重集合严格包含；80 张全部包含在 100 张中时，只允许保留 100 张作品。四来源共用原删除执行器，动画和视频比较全部登记物理原件。新增独立作品关系，沿用审核、分页、冻结范围、写入保护、逐文件删除回执和来源墓碑。新扫描任务 v2、维护任务 v3；包含确认协议 2，精确确认协议仍为 1。

页面保持已接受的紧凑布局，检查结果、确认与删除记录展示方向和数量；不允许反向保留，被包含者有整理记录时要求明确选择。完整包含不等于有码/无码、压缩或裁剪后的画面相似识别。

## 环境与迁移

- 仅使用原有隔离 PostgreSQL 容器 `pixishelf-dedup-postgres` 的 `127.0.0.1:55432`，新建 `dedup_containment_test` 和 `dedup_containment_browser`。
- 自动测试使用独立临时媒体；浏览器使用 `/private/tmp/pixishelf-containment-b1/media`。恢复依据为可重新生成的合成样本与逐文件 SHA 清单，不依赖真实媒体备份。
- 测试库先从 `dda9c129` 正式迁移建立旧结构并植入旧用户、作品和精确组，随后升级；实施者验证旧样本保留。浏览器库从空库正式迁移。
- 浏览器 App 在代码副本 `/private/tmp/pixishelf-containment-b1/source` 启动，端口 5440；独立 Worker 健康端口 55413；只读合成媒体 imgproxy 端口 55434。使用 `entry=direct`。复制运行目录避免共享用户 F5 的 `.next`。
- 本批没有迁移真实库、读取真实媒体或替换用户的 App/Worker。共享生成的 Prisma 客户端已更新；真实实例启用本批代码前需要按运维手册迁移并升级 Worker。

本机原始证据目录为 `/private/tmp/pixishelf-containment-b1`：迁移、Worker 构建、App/Worker 日志，以及仅本机保存的 `manifest.json`。清单含测试账号密码，不纳入仓库或公开输出。

## 定向验证

下表为各实施者完成的受影响范围；失败修复后只补验对应项，不将重跑累计为更多覆盖。

| 范围                    | 结果                                        |
| ----------------------- | ------------------------------------------- |
| DB 检测 / 审核 / 维护   | 7 / 7 / 26 项通过                           |
| 执行器检测 / 直接删除   | 26 / 37 项通过                              |
| App 检测服务 / 删除服务 | 6 / 5 项通过                                |
| 任务契约 / Worker 注册  | 5 / 10 项通过                               |
| 去重界面组件            | 9 文件、75 项通过                           |
| 类型检查                | DB、executor、App 通过；App 含 Next typegen |
| UI 定向 lint            | 33 文件，0 warning、0 error                 |

实质覆盖包括：重排改名、重复文件次数、严格包含与部分重叠区分、四来源包含删除、组合媒体、失效内容拒绝、协议 1 不可授权包含删除、旧 Worker 不可领取新任务、跨关系角色冲突、公共保留者去重和隐私保护。修正了末尾根身份复核失败后仍残留内部候选结果的问题。原生文件能力最初未构建时删除正确阻断，编译受影响原生模块后才完成删除测试。

热缓存定向样本为 1002 个登记媒体：1002 次属性检查、0 次内容读取。关系核对按最多 100 个候选持久化检查点，在当前时间片内继续推进；没有重新运行 50 万吞吐测试，不能将旧精确去重性能记录当成本批新算法吞吐证明。

## 独立审查

GPT-6.1 Sol / xhigh 静态审查发现 1 项 P2：新增阶段的迁移删除了旧 `ArtworkDedupRun_contract`，未恢复 mode/status、正版本、算法版本及 readerState/token 一致性约束。要求新增正式迁移恢复原保护并允许 `MATCH`，保留已应用迁移 checksum。其余所查匹配、缓存、冻结、删除复核及协议门禁未发现阻塞问题。

新增 `20261025000500_artwork_dedup_run_contract` 正式迁移恢复原约束、增加 `MATCH` 并校验两个游标非负；没有改写已应用迁移。新增独立 PostgreSQL 测试 **26/26 通过**，第五迁移已部署到两个合成库。Sol 仅复审新迁移与测试，确认 P2 关闭，无新增发现；没有重跑先前测试。

## 浏览器闭环与文件核验

GPT-6.1 Sol / medium 在桌面 1200×900、手机 390×844 完成真实 UI 操作，没有用接口或数据库伪造检查/删除结果：

1. 通过 UI 发起检查，检测 `e19fe570-0c63-40a1-993c-1832611b4040` 完成。仅出现 A/B 一组，显示完整包含、80/100、多出 20；A 的保留单选禁用，B 推荐保留，C 未被误判。
2. 通过 UI 生成准备操作 `e467f6da-982b-4795-a155-f4dd7413eb79`，确认面板显示 A80 待删、B100 保留以及包含方向。两项声明初始未勾选，单独第一项仍不可删除，两项均勾选后才可提交。
3. 仅通过 UI 删除授权 A1；操作以 `DIRECT_DELETE / protocolVersion=2 / DELETED` 终结。刷新后记录仍显示 A 已删、B 保留和冻结关系。B 详情可打开并显示 100 张，相关作品中 C 仍在。
4. 主 agent 独立读取合成数据库与逐文件 SHA 清单：A 的 80 个文件全部不存在、业务行及媒体行已删除；B/C 各 100 个文件 SHA 与原清单逐项相同，各保留 100 条媒体记录。核验结果 `browser-integrity.json` 为 `passed=true`，时间 `2026-10-25T09:36:38.746Z`。

手机结果与完成态 `scrollWidth=390`，未见横向溢出；主要按钮实测 44px。复选框视觉本体 16px，未完成其扩展命中区域测量，不能据此声称所有触控目标均达 44px。主 agent 同时查看实际桌面结果、手机确认与完成截图，未发现新增布局阻塞。

实际原生 JPEG 截图保存在 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/`：

| 状态         | 桌面                              | 手机                             |
| ------------ | --------------------------------- | -------------------------------- |
| 检查结果     | `containment-results-desktop.jpg` | `containment-results-mobile.jpg` |
| 删除确认     | `containment-confirm-desktop.jpg` | `containment-confirm-mobile.jpg` |
| 删除完成     | `containment-deleted-desktop.jpg` | `containment-deleted-mobile.jpg` |
| 保留作品详情 | —                                 | `containment-kept-b-mobile.jpg`  |

## 验收环境修正与边界

合成账号最初使用中文显示名，触发现有 `proxy.ts` 将会话 JSON 直接写入请求头时的 ByteString 编码错误，登录后循环跳转。确认不是本批改动后，仅将该合成账号显示名改为 ASCII 并修正样本脚本；未改认证代码、权限、Session 或去重结果。该既有中文显示名问题仍未修复，不能记作本批通过的认证覆盖。

仅为隔离运行构建一次 Worker 包（含原生文件能力），App 使用独立目录的开发服务，没有运行全量 App lint/test/build。图源已生成，`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过：33 个独立图源、23 个内嵌 Mermaid；没有为此安装浏览器。

## 收口与未覆盖项

**第一批已完成并暂停。** 独立审查问题已修复复审，相关测试和实际删除闭环通过；没有继续第二批或恢复定时开发，也未提交 Git。`pnpm docs:check` 检查 267 个 Markdown 通过，`git diff --check` 与主应用大写路径检查通过。

本批 App5440、Worker55413 已退出，两个命令会话均退出码 0；Worker 日志确认三条调度通道停止并 `worker.stopped`。本批 imgproxy 容器已删除，5440/55413/55434 均无监听。合成库、媒体剩余件、代码副本和证据保留；用户服务未停止。正常验收浏览器标签已关闭、视口已还原；最早的两个重定向错误标签因工具禁止取得 data URL 句柄而未能关闭，无后续业务任务。

未覆盖：新版 50 万记录吞吐、独立大图库/NAS I/O、视觉相似与有码/无码识别、手机真机。既有中文显示名认证问题另列待修，不混入包含扩展。旧全量验证不能替代本批未运行的全量验证，本批按用户要求仅做相关范围。

手机真机仍需确认：勾选框及单选项的实际点按范围、底部安全区与浏览器栏伸缩时的可达性、长标题滚动，以及 iOS Safari/Android Chrome 的差异。真实开发实例使用本批之前需正式迁移并重建/启动兼容 Worker；本轮没有代为执行。
