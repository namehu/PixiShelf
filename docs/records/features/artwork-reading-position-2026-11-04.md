---
status: historical
scope: Web 阅读位置模型交付、SQL 隔离验证与独立客户端暂停状态
last-verified: 2026-11-04
---

# 阅读位置模型重构记录

本次实现将账户作品逐媒体已读集合替换为单行位置进度。交付范围为 Web、服务端、Worker、SQL 正式迁移与受控运维材料。

2026-11-04 用户明确暂停独立客户端工作、优先 Web，后续是否继续客户端尚未决定。已完成 Flutter 改动和验证事实保留；原生视频衔接未验收、最终正常 release 未重建，均按用户要求暂停，**不阻塞本次 Web 交付，也不表示客户端整体就绪**。

适用版本：2026-11-04，分支 `codex/reading-position-progress` 的本地提交，按交付范围分开保存：

- Web、共享 DB、Worker、正式 phase 1 迁移、独立 phase 2 材料及文档：`cfd680e9ee235a8b436062c859cc04a5ec6a58d0`。
- Android 暂停验收的 WIP，仅包含 `packages/pixishelf-app`：`3cfa9d454f7b08ddaabcb98a4bc7cc6a7f61c9f0`。该提交不表示客户端整体就绪。

以上提交仅保存在本地，未 push；没有登记发布镜像 digest 或生产版本。

生产状态：未执行生产写入、迁移、部署或清理；本记录中的验证仅限本地与明确隔离数据库。

## 实施阶段

1. 冻结位置契约：`readingLayoutVersion`、`stateVersion`、`progressCount`、`completed`、最远和最后位置。
2. 新表和布局维护；报告只查询批次媒体及单行账户进度。
3. 正式 phase 1 迁移及只读 preflight/postflight；旧表迁入 `reading_legacy_v1` 并解除业务外键。
4. 独立 phase 2 清理 SQL 与 7 天后正式迁移操作手册。
5. 聚焦回归、隔离迁移及性能验证、完整检查。

## 验证证据

### 隔离数据库迁移

2026-11-04，专用 Docker PostgreSQL 容器 `reading-position-20261104`，回环端口 `55433`；使用合成账户、合成媒体路径和独立数据库，没有读取生产环境文件、生产连接或真实收藏目录。

- 空库 `pixishelf_reading_position_20261104_migrate_empty`：显式设置该库的 `DATABASE_URL` 后执行 `pnpm --filter @pixishelf/db db:deploy`；最终 phase 1 SQL 的完整 138 条正式 migration 链通过。
- 旧数据库 `pixishelf_reading_position_20261104_migrate_fixture`：测试先在临时 migration 目录部署前 137 条历史迁移，再构造旧 schema fixture，经正式 Prisma deploy 应用 phase 1，`_prisma_migrations` 记录成功。
- 聚焦命令：`READING_MIGRATION_TEST_DATABASE_URL=<上述显式隔离 fixture URL> pnpm --filter @pixishelf/db exec vitest run prisma/__tests__/reading-position-migration.postgres.test.ts`，**5 项测试通过**（含审查后的强校验和故障注入）。该环境变量缺失时本套件跳过，不能视为实际 PostgreSQL 验证。
- fixture 含 10 部作品、96 行 Image、8 条旧摘要、6 条旧已读成员；逻辑媒体合计 92 项，合并账户/作品键后得到 9 条新进度、4 条已完成。空时间与零访问的手工完成、旧 90% 完成及陈旧总数快照均保留；真实次数、阅读/活动日期、创建/更新日期和状态版本由 postflight 逐项断言。
- 覆盖跳页与孔洞、非连续 sortOrder、同序号 id 决胜、仅有已读行、零媒体、旧最后媒体删除、APNG/视频主项转换；SQL 分组与 `groupLogicalMedia` 在同名不同目录、大小写、查询串、不同视频扩展、Windows 路径、尾部分隔符、隐藏文件和 `..` 输入上逐成员 parity 通过。
- 在 phase 1 封存完成后注入异常，并另行在插入后篡改完成状态触发迁移断言，验证 DDL、回填、外键移除和 schema 迁移全部回滚；正式部署后执行只读 postflight，并实际调用去重推荐 SQL 函数，确认不依赖旧表。
- 删除 Image、Artwork 和 UserBA 后，封存两表的逐行 JSON 与删除前相同，新进度按账户/作品正常级联清理。phase 2 在隔离库执行成功；额外封存对象使 `DROP SCHEMA ... RESTRICT` 拒绝时，整个清理事务回滚，两张旧表仍存在。phase 1 不包含旧表删除。

SQL 材料位于 `packages/pixishelf-db/maintenance/reading-position-v1/`。phase 1 SHA-256：`32a3962b0e56ec350849cdc44c2fe99448f33dccd9613d966bfeef968ca4d55a`。首次旧 fixture 运行发现 `false OR NULL` 可使 `completed` 为空，已用显式 `coalesce(..., false)` 修正并重新通过全部迁移测试；此前空库验证不能覆盖这条非空数据路径。

这是合成数据的隔离验证，不是生产副本恢复演练，也不替代生产停写检查点、真实数据 preflight、用户验收或至少 7 天观察。生产迁移、发布、备份恢复及 phase 2 清理均**未执行**。

### 审查后的核验加强

首轮审查指出总行数和范围校验不能发现等数量错 key 或错误锚点。phase 1 改为临时期望集与新表全字段双向 EXCEPT；postflight 独立从封存两表和 Image 重建逻辑映射、源 key 并集、最远/最后锚点、完成及全部历史字段，并逐行比较，另核对所有 Artwork 的逻辑缓存。7 类故障注入（等行数错作品 key、最远 ID、最远 index、只有已读行的最远位置、缓存数量、完成标记、最后位置）逐一被阻断，恢复后均重新通过。新增 cleanup-preflight 只检查 migration history、封存范围和数据库依赖；测试创建旧表引用 view 时正确拒绝，删除该 view 后通过。

精确 postflight 只在 phase 1 后仍停写的窗口执行。后续新阅读和媒体变化会合法改变新表，7 天清理前使用独立 cleanup-preflight，不以旧源全等检查覆盖新进度。最终空库再次以同一 phase 1 digest 完成 138 条全链迁移。

### 媒体写入覆盖

App 的 image-manager 覆盖新增、删除、排序、reconcile 和完整替换；批量扫描新建作品、Worker 本地/Pixiv 发布及本地重扫、归档完整重建/部分补全、pending replace 发布/恢复、App/Worker 路径迁移均在原发布事务内维护位置布局。新建时先刷新数量，再应用 Pixiv 默认完成。永久删除通过账户/作品外键级联清理。章节、尺寸、时长等不改变逻辑顺序或分组的元数据更新不推进阅读布局。

### 工程验证快照

以下为各实现者在本地/合成隔离环境报告的独立命令结果，存在覆盖交集，**不相加为总测试数**；默认跳过的 PostgreSQL 测试与另行配置隔离数据库实际执行的专项分开记录。

| 范围                | 实际结果与边界                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移 SQL            | 显式隔离 fixture 的上述 Vitest 命令 5/5；空库正式 db:deploy 138 条通过；DB `tsc --noEmit` 通过                                                                                                                                                                                                             |
| 后端服务/位置       | 阅读服务 16/16、DB 布局 helper 5、共享契约 6；影响 unit 80 和 mobile 10 通过                                                                                                                                                                                                                               |
| 后端真实 PostgreSQL | 核心阅读最终 17、继续阅读 4、性能 3、App image-manager 3、去重门禁 2 通过；另 Worker writer 128/128，含扫描 69、归档完整/部分补全 57、pending replace 2                                                                                                                                                    |
| Worker 依赖链       | `pnpm --filter @pixishelf/worker... typecheck` / `test` 通过；contracts 183、runtime 35、DB 184、executors 1035、worker 121；默认环境 PG 跳过分别为 runtime 106、DB 284、executors 563、worker 12，不能计作执行通过。`pnpm --filter @pixishelf/worker... build` 通过，存在既有 import.meta/CJS 的 3 条警告 |
| Web 聚焦            | 受影响 52 文件 456 项通过；Gradle 并行负载期间 4 项 5 秒超时，独立复跑相关 2 文件 36/36 通过（覆盖这 4 项，不与 456 累加）；聚焦 lint 111 文件无问题                                                                                                                                                       |
| Android             | 当前已确认 `flutter test --no-pub --reporter expanded` 65/65（含保存提示 2 项、暂停/缓冲 2 项新增回归）；`flutter analyze --no-pub` 无 issues；gallery 第三轮原生模拟器 drive +2 通过。早期三 ABI release 构建曾通过；原生视频衔接未验收、最终正常 release 未重建，现按用户要求暂停，不阻塞 Web 交付       |
| 文档与图            | `pnpm docs:check` 388 Markdown 通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams` 真实渲染 34 图、解析 23 内嵌块；同环境 `docs:diagrams:check` 通过；阅读图截图肉眼检查通过。默认 Playwright 浏览器未安装，使用已安装 Chrome 完成，不是仅文本语法检查                                                  |

`rg --files packages/pixishelf | rg '[A-Z]'` 无输出，`git diff --check` 通过。当前阅读功能/架构、数据库语义、产品边界、Pixiv/Android/堆叠交叉正文、移动 OpenAPI 与迁移手册已更新；历史 records 保留旧语义。SQL 第二轮静态复审、Web 真实浏览器及主应用全量最终结果见下文；Android gallery 第三轮通过；原生视频衔接和最终正常 release 按用户要求暂停，不阻塞已完成的 Web/服务端/SQL 门禁，不声明客户端整体就绪。

### 主应用最终门禁与失败复验

在 `packages/pixishelf` 中运行 `pnpm lint`（零警告/零错误）、`pnpm typecheck`（Next 类型生成与 tsc）通过；fixture 修复后另行 tsc 通过。使用提升权限、`__NEXT_PROCESSED_ENV=true` 及显式合成数据库/认证环境执行 `pnpm build`，最终编译、TypeScript 和路由生成均通过，无警告；最终编译约 48 秒，日志 `/tmp/reading-app-build-final.txt`。

首次完整 `pnpm test` 为 499 文件通过、54 文件跳过、3 文件失败；对应 3,725 测试通过、386 跳过、3 失败，总计 556 文件/4,114 测试。失败分别在 maintenance-card-live-events 生命周期、archive-discovery-batch-sources 的 65 来源用例、archive-uploader-sources 滚动恢复，均非本次阅读 UI。未改业务以规避失败，针对 3 文件使用 `--maxWorkers=1 --no-file-parallelism` 复跑 64/64 通过。首次结果和复验日志分别为 `/tmp/reading-app-full-test.txt` 与 `/tmp/reading-app-timeout-rechecks.txt`。

最后在相同显式隔离环境运行 `pnpm run test:unit --maxWorkers=2`，**502 文件通过、54 文件跳过；3,728 测试通过、386 跳过，零失败**，耗时 252.35 秒。`test:unit` 是 `pnpm test` 实际调用的完整单元脚本，没有删减测试范围；日志 `/tmp/reading-app-full-test-final.txt`。首次失败、针对性复跑与最终全量通过分别保留，不将复跑数量叠加到最终数量。环境跳过不计为执行通过，真实 PostgreSQL 专项另述。

### 后端 PostgreSQL 与源码边界补充

最终核心阅读 PostgreSQL 17 项与服务单元 16 项联合聚焦 33/33 通过，含第一个视频代表选择的修正，日志 `/tmp/reading-final-parity-tests.txt`。核心专项显式将 `READING_VALIDATION_DATABASE_URL` 和 `DATABASE_URL` 指向同一 `127.0.0.1:55433` 合成 runtime 库；Worker writer 使用同库的 `QUEUE_KERNEL_TEST_DATABASE_URL`，128/128 日志 `/tmp/reading-writer-postgres.txt`。早期去重 fixture 失败已独立修复并 2/2 通过，不能把早轮失败日志当作最终全绿证据。

相关 PostgreSQL 回归独立运行：`FAVORITES_DATABASE_URL`/`MULTISELECT_DATABASE_URL` 显式指向隔离库，收藏 7 与多选 20 通过；`MEDIA_MARK_DATABASE_URL` 下 media-marks migration/lifecycle 9/9 通过（测试创建并删除独立子库，从旧 schema 完整升级）；去重投影 4 项通过；DB `artwork-dedup-review.postgres` 选择 `reading does not stale` 的 1 项通过、25 项未选，不把未选算作通过。media-marks 初次旧 schema Prisma fixture 错误已改为兼容原始插入并重新通过，日志 `/tmp/reading-media-marks-postgres.txt`。

`pnpm --filter @pixishelf/db db:generate`、`db:validate` 通过。DB 的 TypeScript/Vitest alias 直指 job-contracts 源码，避免干净 CI 借用陈旧 dist；`pnpm --filter @pixishelf/db typecheck` 通过，TypeScript trace 实际解析 `src/index.ts`，Vite trace 实际解析/加载 `src/index.ts` 和 `logical-media.ts`。证据 `/tmp/reading-db-resolution-trace.txt` 与 `/tmp/reading-db-vitest-resolution.txt`；helper/contract/database-client 聚焦为 42 通过、11 PG 环境跳过，没有改名或删除 dist 来模拟干净环境。独立审查仅静态核对该源码边界，没有重复执行这些 trace。

### Web 实际浏览器与 SQL 独立复审

审查者使用真实 Chrome，桌面 `1440×1000` 和手机视口 `390×844`；环境为 `55433` 合成 browser 数据库、自有临时 App 端口 `5438` 及只读合成媒体 ImgProxy `55439`。没有使用真实收藏或生产账户。

- 两个合成账户各展开 100 图并连续滚动到末项，均显示「已读完 · 100 张」，刷新后保持；数据库各为单行 `completed=true`、`furthestMediaIndex=99`、`viewCount=1`。手机刷新出现第 100 项续读提示，实际点击跳转定位第 100 项。
- 另一个账户跳读到第 98 项后回看第 51 项：数据库最远零基索引 97、最后零基索引 50、未完成；刷新显示 98/100，并提示第 51 项续读。手工完成前后访问次数均为 1。
- 12 秒视频开始时为 0/1，约播放 4 秒仍为 0/1，后续自然播放后显示完成且数据库标记为 true；这证明视觉流程而非逐帧 90% 临界点，精确播放门槛由自动化验证。
- 零媒体作品保持 0/0，完成按钮禁用。停止自有隔离 App 后继续滚动，出现「阅读进度尚未保存，请检查连接」；重启并重载后读取持久状态，错误提示消失。

Web 截图仅由 CUA 原生输出展示，没有落盘的可链接文件，不补造截图路径。手机尺寸浏览器不等于 Android 原生或实体手机验收。

第二轮 SQL 代码复审确认 postflight 双向 EXCEPT 对照 key、全部锚点、完成与历史，另独立核对逻辑 count，首轮缺口已关闭；phase 2 仍是独立 RESTRICT 清理。审查者没有重复运行迁移 PostgreSQL 测试，5/5 和故障注入是本记录执行者的实际结果。最终代码复审确认：APNG 配对按 basename/stem 的点开头文件名规则，并按 `sortOrder,id` 选第一个视频，已与共享 `groupLogicalMedia` 对齐；普通媒体重定位后，最远锚点成为末项会设置完成，原有粘性完成仍保留。此前这两处代码阻断已修复。33/33 PostgreSQL/服务聚焦由后端实现者执行，审查者只复核代码，不重复声称执行。

### Android 原生模拟器与保存失败修正

当前已确认常规 Flutter 单元/组件测试 **65/65**，命令 `flutter test --no-pub --reporter expanded`；`flutter analyze --no-pub` 无问题。较早的 61 项及保存提示修复后的 63 项，不与新增暂停/缓冲回归后的 65 项累加。

前两轮原生 gallery drive 均未达到保存失败提示验收：首轮仅工具原生输出显示找不到 Snackbar，没有单独重定向的原始日志；第二轮 `/private/tmp/pixishelf-reading-position-20261104/android-drive-attempt-2.log` 明确记录期望「阅读进度未保存，请重试」、实际为「连接或加载失败，请重试」。原先只有时序假设不能解释第二轮的真实缺陷，不能将前两轮记为通过。

根因是普通 400/500 `ApiFailure` 使用通用连接/加载文案，详情阅读上报的 catch 没有附加阅读保存上下文。修复在这一操作边界为普通上报失败提供专门保存提示，保留 401/403/404/409/429 的身份、内容、版本和限流语义，并新增 controller 与 Snackbar 回归。独立代码复审未发现阻断；实际通过由下一轮复验确认。

第三轮在 **Android 15 / API 35，`emulator-5554`** 执行：

```bash
NO_PROXY=localhost,127.0.0.1,::1 \
PIXISHELF_SCREENSHOT_DIR=build/reading-position-screenshots \
flutter drive --driver=test_driver/gallery.dart \
  --target=integration_test/gallery_test.dart \
  -d emulator-5554 --no-enable-impeller
```

日志 `/private/tmp/pixishelf-reading-position-20261104/android-drive-attempt-3.log`，exit 0，`+2: All tests passed`。测试使用合成 API 与合成媒体，覆盖实际向前滚动、回看保留最远进度、退出/重新进入后恢复、预览实际切换到第 60 项并完成、54/60 时仍未完成，以及受控保存失败时显示专门提示和保留 0/60。

审查者逐张视觉查看以下 4 张原生 PNG，已从构建目录原样复制到 records 证据目录，未编辑图片内容：

| 证据                                                                                           | 观察                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------- |
| [保存失败提示](./assets/artwork-reading-position-2026-11-04/reading-save-failure.png)          | 0/60，明确提示阅读进度未保存 |
| [回看保留进度](./assets/artwork-reading-position-2026-11-04/reading-reread-keeps-progress.png) | 回看后仍为 8/60              |
| [继续阅读提示](./assets/artwork-reading-position-2026-11-04/reading-resume-prompt.png)         | 上次第 34 项，前缀进度 35/60 |
| [完成底部状态](./assets/artwork-reading-position-2026-11-04/reading-completed-footer.png)      | 60/60，整部完成按钮禁用      |

这些证据不使用真实 Android 网络、生产登录或真实收藏，不等同于实体手机验收。**原生视频衔接验证尚未通过**：新增 harness 暴露 VideoCanvas 只在 playing/ended 时回调，手动暂停的 `playing=false` 没有传给 ReaderController，导致其视频播放标记可能保持 true，60 秒心跳可能错误延长活动。已沿既有回调传递有效播放状态变化，Reader/Detail 不因孤立 `playing=false` 制造 VIEW；新增实际 Widget 的 63 秒回归，验证暂停/缓冲无心跳、恢复播放后心跳恢复，包含在当前 65/65 中。原生 VideoCanvas→ReaderController→合成 API 的开始 0/1、70% 未完成、UI 暂停、92%/尾部完成专项未取得最终验收，现按用户要求暂停；不将 gallery 成功、单独播放器播放或单元回归代替该项。早期 `flutter build apk --release --split-per-abi --no-pub` 三 ABI 曾通过，但最新业务修复后的最终正常 release 未重建，现按用户要求暂停，不将 integration_test APK 或早期产物当作最终交付。

正常 release 的预期路径为 `packages/pixishelf-app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`、`app-armeabi-v7a-release.apk`、`app-x86_64-release.apk`；这些只是早期构建位置，不是本次 Web 交付的最终客户端产物。真实 HTTPS、实体 Android、NAS 性能与长期稳定性仍未由本轮覆盖。

### 高频上报规模验证

命令：显式将 `READING_VALIDATION_DATABASE_URL` 与 `DATABASE_URL` 指向同一合成 runtime 库后，执行 `pnpm --filter @pixishelf/next exec vitest run tests/integration/artwork-reading-performance.postgres.test.ts --maxWorkers=1`。100、1,000、10,000 逻辑项的普通报告均为 9 条查询，Image 查询只返回批次的 2 个锚点、账户状态返回 1 行，没有逐项 ID 集合；响应约 0.36KB，断言门槛小于 650 bytes。最后一轮为 355/356/357 bytes，早期 351/352/355 的差别来自合成 ID 位数，不是规模线性增长。该结果证明本批次查询数/返回行/响应有界，不等同于真实 NAS 延迟或并发吞吐测试。局部日志：`/tmp/reading-postgres-regression.txt`，Worker 构建日志：`/tmp/reading-worker-build.txt`。

### Web 交付范围与生产发布边界

- 尚未执行：生产写入、迁移、部署、数据库或媒体备份/恢复演练、真实用户验收、生产副本审计、上线后的至少 7 天观察与 phase 2 清理。
- 正式发布需要用户按[位置迁移手册](../../operations/runbooks/reading-position-migration.md)执行。7 天从**生产上线验收后的实际观察**计算，开发完成或隔离验证经过的时间不算。
- Web、服务端、Worker 与 SQL 的本次本地/隔离门禁已完成，主实现与 Android 暂停 WIP 的精确本地提交和分离范围已在本文开头登记。
- 独立 Android 客户端按用户要求暂停：已有 65/65、analyze、gallery +2 和 4 张原生截图是已执行事实；原生视频衔接未验收、最终正常 release 未重建，不阻塞 Web 发布。Web/Worker 按新契约发布，旧客户端暂停使用，服务端不提供旧阅读协议兼容分支。
- 真实 NAS/实体 Android 手机/HTTPS/跨设备性能仍只按实际执行边界报告；没有这些证据不应宣称已覆盖。
