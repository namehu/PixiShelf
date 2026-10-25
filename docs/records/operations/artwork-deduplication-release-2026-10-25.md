---
status: historical
scope: 去重 v0.54.10 镜像发布、已知限制与 NAS 交接；不证明生产已升级
last-verified: 2026-10-25
sources:
  - docs/features/artwork-deduplication.md
  - docs/design/artwork-deduplication/matching-extension.md
  - .github/workflows/build-and-deploy.yml
  - docs/operations/runbooks/artwork-deduplication.md
---

# 去重版本收口与发布交接

用户决定先发布当前已验收功能，再观察真实图库效果；NAS 容器由用户更新。本次不新增识别功能，不操作生产数据库或媒体，不重复本地应用全量验证。

## 冻结范围

功能基线为 `eb6894be`；最终镜像版本为 `v0.54.10`。此前候选 `v0.54.7` 中止，`v0.54.8` 和 `v0.54.9` 被测试门禁阻断，未改写旧标签。包含同艺术家四来源的精确重复、完整包含，以及可选的疑似版本识别；检查、图片对照、保留选择和单对确认删除已连通。

- 完整包含按原文件 SHA 多重集合判断，保留较完整作品；相关证据见[第一批验收](../artwork-deduplication-containment-batch1-2026-10-25.md)。
- 疑似版本是人工选择建议，不自动判断有码/无码，不自动删除。隔离样本、独立审查和浏览器证据见[闭环验收](../artwork-deduplication-suspected-versions-2026-10-25.md)。
- 用户在开发库 A/B/C 样本回归后明确反馈“验收好了”；这是用户确认，不作为真实有码/无码样本准确率或 NAS 上线证据。
- 本地开发升级已完成 115→121 个正式迁移和 Worker 重建，保留数据的依据见[升级记录](./artwork-deduplication-visual-local-upgrade-2026-10-25.md)。本轮不重做该升级。

## 当前限制与后续

纯字节部分重叠（如双方各 100 张、仅 80 张文件相同）尚未单独展示；视觉缓存仍有逐图数据库往返，每次检查重新构建索引和匹配。视觉阶段每次最多 10,000 个登记原件，50 万真实图片的端到端吞吐尚未验证，不能套用旧精确检测或合成特征探针的数据。

剩余工作统一登记在[后续计划](../../design/artwork-deduplication/matching-extension.md)及根 [TODO](../../../TODO.md)：F01 部分重叠、F02 缓存和增量关系、F03 大规模检查、F04 真实版本效果。登记后暂停，下一批另行选择，不继续扩张本版范围。

## 发布证据

准备时远端 `main` 为 `dda9c129`（`v0.54.6`），GitHub 最新成功 Release 为 `v0.54.5`。旧版 [Build and Deploy](https://github.com/namehu/PixiShelf/actions/runs/40176963480) 的两份镜像构建成功，但数据库测试出现死锁，发布被门禁阻断；同期 [CI](https://github.com/namehu/PixiShelf/actions/runs/40176963474) 另有归档导入集成测试失败。不能把构建成功当作镜像已发布。

第一轮发布修复 `bd2c8e82` 仅改四份测试 fixture，没有修改生产逻辑、断言或发布门禁：媒体内容测试在 Artwork/Image DML 前遵循现有 `catalog → media root` 锁序；归档测试将不符合来源 token 语法的 `private-token` 改为合法合成值，URL 与 locator 一致。版本和后续计划文档提交为 `20e1e173`。

| 本地定向验证     | 结果与边界                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据库并发测试   | 原两文件并发复现 4 个 `40P01`；修复后 `media-content` 与 `media-content-snapshot` 共 26/26 通过，DB typecheck 通过                                   |
| 生产入口竞争探针 | 复用现有 scan 的 catalog/root 竞争用例，1 项通过，68 项未选；首次受前一套件遗留的合成 `test-root` 影响，清除专属测试库该根行后通过，没有修改生产校验 |
| 归档集成测试     | 先复现无效 URL 导致 `acceptedCount=0`；修复后三文件 45/45 通过，局部 oxlint 无错误或警告                                                             |
| 独立差异审查     | GPT-6.1 Sol / xhigh 审查四文件及对应调用路径，无阻塞项；原 CAS 回滚及直接 SQL 冲突断言保留                                                           |
| 文档             | `docs:check` 检查 273 份 Markdown 通过；`docs:diagrams:check` 检查 33 张图源、23 处内嵌 Mermaid 通过；diff 与主应用路径大小写检查通过                |

测试只使用独立容器 `127.0.0.1:55432` 下新建的 `dedup_release_dbtest` 和 `dedup_release_archivetest`，均通过正式全链 migration。未使用开发 5432 或生产实例，未访问真实媒体。测试进程已退出，专属库保留。原始日志为本机 `/private/tmp/dedup-release-db-{before,after,typecheck}.log`、`/private/tmp/dedup-release-catalog-probe-clean-root.log` 和 `/private/tmp/release-archive-test-after.log`；这些临时日志不是永久 CI 证据。

### 首个候选的远端结果

`v0.54.7` 指向 `20e1e1731c6f5f610b3dceda1cf8b013b7f56986`。[CI](https://github.com/namehu/PixiShelf/actions/runs/40200130937) 中 DB 测试已通过，WebP 通过；Web 被两处多行 `if` 缺大括号的 lint 错误阻断。后续 executor 检查另外暴露测试根身份残留、测试前未构建原生模块，以及 Linux 加固编译下的测试 C fixture 未检查 `write` 返回值。

已在版本镜像推送前取消 [Build and Deploy](https://github.com/namehu/PixiShelf/actions/runs/40200130875)：两份 OCI 构建产物存在，但版本发布和 Release 未执行，不能将 `v0.54.7` 作为 NAS 更新目标。保留失败标签和日志，不通过改写标签或跳过测试重发。

两处 `if` 仅补大括号，独立复审确认行为不变；格式化后对自 `v0.54.6` 起变更的 36 份主应用 TypeScript 文件执行定向 oxlint，通过。

### 后继补丁准备

- 测试根使用每轮 UUID，结束时仅锁定并清理本轮创建的空根，既有根不动；同一隔离库连续执行 DB 两文件 26/26 → 根行数 0 → scan 竞争探针 1/1 → resolver 1/1，通过且无需人工清根。DB typecheck 通过。
- CI Worker 和发布 validate 在测试前调用已有 native 独立构建脚本；不提前生成共享 job dist，不删迁移、断言或测试门禁。Web 中需要此原生模块的专属库集成套件仍需显式测试库变量，不将未启用的套件当作通过。
- 原生测试 C fixture 检查两处 `write` 返回值，失败返回 `EIO`。macOS Node 20.19.4 的三个相关文件 28/28 通过；首次沙箱内读取进程不可运行，获执行权限后通过。Linux 仅做定向严格编译：Debian/GCC 8、Node 20.19.4 头文件、`FORTIFY_SOURCE=2`/`-Werror` 下旧代码两模式失败，新代码两模式编译及 N-API 加载通过；不是 Linux 全套测试证据。
- GPT-6.1 Sol / xhigh 对新增 DB 清理、两个 workflow、native fixture 及前述大括号差异独立复审通过。生产 native 和去重业务逻辑不变。

原始补充日志：本机 `/private/tmp/dedup-release-db-root-cleanup.log`、`/private/tmp/dedup-release-scan-after-db-root-cleanup.log`、`/private/tmp/dedup-release-resolver-after-db-root-cleanup.log`、`/private/tmp/release-0547-native-mac-tests.log`、`/private/tmp/release-0547-native-linux.log`。命令已退出，临时编译容器已移除。后继版本仍通过现有工作流完整门禁，本地不重复全量 App/Worker 验证。

### 第二个候选与组合验证

`v0.54.8` 指向 `db2164e53c59b92f5ee48833a9122e94281992c5`。[CI](https://github.com/namehu/PixiShelf/actions/runs/40201122824) 的 Web（含 lint、typecheck、test、build）及 WebP 通过；Worker 与[发布验证](https://github.com/namehu/PixiShelf/actions/runs/40201122813) 被一项 DB 测试阻断。该标签未发布版本镜像，不作为 NAS 更新目标。

根因是两个媒体测试套件在 catalog 锁外读取共享测试根，可能在等待锁时取得过期身份。修复仅涉及两份测试文件：读取、建立和清理遵循 `catalog → root`；不同套件独立持有子目录，最后一个释放子目录的套件才清理空测试根，保留既有非测试根和本套件泄漏断言。独立 Sol / xhigh 复审通过。

- 新建隔离库 `55432/dedup_release_dbtest_ci` 完成正式迁移；四份关联媒体测试 66/66 通过，随后按 CI 原环境运行 DB 包，271 通过、140 按既有条件跳过。全程未人工清根，结束时连接及媒体目录状态行均为 0。DB typecheck 通过。
- 同库继续定向运行此前失败的八份 executor 测试，101 通过、51 失败及一项未处理拒绝。归档维护、staging 恢复、三个原生文件测试均通过；余下扫描、替换阅读失效及 resolver 的修复见下一节，不将该次结果记为通过。
- 早先额外设置 `QUEUE_KERNEL_TEST_DATABASE_URL` 的扩展 DB 运行不等同 CI 环境，出现 49 失败、310 通过；保留旧库及日志，不用该次失败或后续有选择运行代替完整通过证据。

日志：`/private/tmp/dedup-release-clean-media-group.log`、`/private/tmp/dedup-release-clean-ci-db.log`、`/private/tmp/release-0548-executor-targeted.log`。仅使用专属隔离库，不连接开发或生产库。

### 第三个候选的定向修复

`v0.54.9` 指向 `545a676a91bde34a060e85c65f32a1c1525bd307`。[CI](https://github.com/namehu/PixiShelf/actions/runs/40203156636) 与[镜像发布](https://github.com/namehu/PixiShelf/actions/runs/40203156641) 中 contracts 170、DB 271、runtime 109、executors 1,091 项测试通过，原条件跳过项分别为 0、140、19、165；最后的 Worker 包为 122 通过、1 跳过、1 失败。失败只在去重读取子进程的 bundle 测试，故镜像构建成功后仍未发布版本镜像。

扫描测试补齐冻结输入和直接发布所需的来源证明；改写根 marker 的测试同时清理自己创建的原 UUID 绑定。两个故障注入由事务调用次数改为实际已提交状态，原恢复断言保留。resolver 的三个夹具对齐提交证明、provider 与解析身份，失租约断言提前监听，消除未处理拒绝。

另外修复两处现有生产逻辑回归，未扩展去重产品范围：

- 扫描恢复已有 `PROCESS_STORED_HASH` 分支，CLIENT_SKIP 后建立 baseline 时复用已存哈希并处理冻结输入；保留原来的零次重哈希、一次内容变化及一次解析断言。
- 归档 resolver 区分远端解析失败与事务结算失败。provider 错误和明确的来源证明领域冲突仍正常结算；数据库、租约及结算的非领域异常原样交给队列恢复，避免将事务回滚误转成另一轮业务失败结算。

GPT-6.1 Sol / xhigh 对两份 DB 测试、扫描/归档两份测试及两处生产差异独立复审通过。resolver 在新建并正式迁移的专属库 `dedup_release_resolver_fix_eb5a75ef` 先复现唯一结算回滚失败，修复生产边界后同文件 23/23 通过，无未处理拒绝；原 AUTO 回滚及重取租约后恰好入队一次的断言保留。未手工清库，结束时连接数为 0。日志：`/private/tmp/release-resolver-fixture-once.log`、`/private/tmp/release-resolver-after-production-fix.log`。

扫描/替换阅读失效在另一个正式迁移的新库 `dedup_release_scan_fixture` 定向验证 71/71 通过（scan 69、pending replace 2）；结束时连接数和媒体目录状态行均为 0，未人工清理。旧 CAS 竞争注入点在新的 Artwork 守卫锁内等待竞争写导致自锁，改用既有 `afterPixivSourceLookup` 在加锁前注入竞争，保留原 CAS 与不建立 baseline 的断言。executor typecheck 通过；定向 lint 剩余三项 HEAD 已有长度/参数规则（两处 max-params、一处 max-lines），排除这些既有规则后的差异检查无错误或警告，不宣称全包 lint 通过。日志：`/private/tmp/release-scan-fixture-verified.log`、`/private/tmp/release-executors-final-typecheck.log`。

### Worker 打包测试收口

最后一项失败是测试未沿用生产构建的 external 配置，将 Sharp JavaScript 内联到无依赖目录的临时 CJS 文件。捕获的子进程 stderr 明确为 Sharp 无法加载原生模块；macOS Node 20.19.4 同样复现。生产 `build.mjs` 已 external Sharp，生产镜像保留部署依赖，本轮未改生产打包配置。

只修 `artwork-dedup-bundle.test.ts`：沿用相同 external 清单，在唯一临时目录提供 Worker 依赖解析路径，保留原文件读取断言，并用合成 PNG 发起真实 visual 请求验证解码。构建/启动/关闭失败均清理临时资源。定向测试 1/1、局部 lint/格式/diff 检查通过；Sol / xhigh 单文件独立复审无阻塞项。日志：`/private/tmp/release-worker-bundle-before-stderr.log`、`/private/tmp/release-worker-bundle-fixed.log`。未新增全量本地验证或数据库操作。

### 镜像发布结果

发布标签 `v0.54.10` 对应 `d8c9d0d9a9ed826b60338958b8984df1dc21e7d4`。[Build and Deploy](https://github.com/namehu/PixiShelf/actions/runs/40203907851) 的验证、两份镜像构建、GHCR/Docker Hub 推送、Release 创建及安全扫描作业均成功。[GitHub Release](https://github.com/namehu/PixiShelf/releases/tag/v0.54.10) 于 2026-10-25 22:53:55（Asia/Shanghai）发布，附带 Compose、环境模板、初始化 SQL 与部署入口。

远端使用 Ubuntu、Node 20、PostgreSQL 15 完成空库正式迁移全链、Worker 类型检查和构建。数据库及任务包测试结果为 contracts 170、DB 271、runtime 109、executors 1,091、Worker 123 项通过；按原条件跳过项共 325，未将这些专项套件计为通过。独立 [CI](https://github.com/namehu/PixiShelf/actions/runs/40203907842) 的 Web、Worker、WebP 与总门禁全部成功：Web lint、typecheck、3,350 项测试及生产构建通过，259 项按既有条件跳过。安全扫描作业成功不等于不存在已报告漏洞。

## NAS 交接

App/Worker 已发布；NAS 更新使用同一明确版本 `v0.54.10`，不要混搭旧 Worker 或仅更新 App。镜像分别为 `ghcr.io/namehu/pixishelf:v0.54.10` 与 `ghcr.io/namehu/pixishelf-worker:v0.54.10`；Docker Hub 对应 `dockernamehu/pixishelf:v0.54.10` 与 `dockernamehu/pixishelf-worker:v0.54.10`。本版发布平台为 `linux/amd64`。

按[标准发布](../../operations/deployment.md#标准发布)及[去重升级手册](../../operations/runbooks/artwork-deduplication.md)执行：

1. 停调度及外部写入，等待任务收口，再停旧 App/Worker；建立并核验数据库、媒体和配置的同点备份。
2. 拉取配套镜像，使用目标 App 镜像运行正式 `prisma migrate deploy`。包含关系与疑似版本需要 `20261025000100` 至 `20261025000600`；从更早版本升级须同时完成全部前序迁移。禁止 `db:push`。
3. 启动新 Worker，确认 READY 与 capability 审计通过（扫描 v3、维护 v4 及旧任务兼容能力），再启动 App，最后恢复原本启用的调度。
4. 先选原件数在当前上限内的小艺术家，只读观察结果；用可销毁样本确认对照和删除。没有建议不代表没有重复。

本记录未执行 NAS 发布、生产迁移或生产删除。存在未结束的删除操作时不得退回不兼容版本；文件删除不能靠换回旧镜像恢复。后续生产版本、备份集合和实际观察结果由用户反馈后另行登记。
