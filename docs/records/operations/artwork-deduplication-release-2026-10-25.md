---
status: historical
scope: 去重版本收口、v0.54.7 发布中止与后继补丁准备、已知限制及 NAS 交接；不证明生产已升级
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

功能基线为 `eb6894be`；首个候选 `v0.54.7` 中止，后继补丁版本为 `v0.54.8`，不改写已推送标签。包含同艺术家四来源的精确重复、完整包含，以及可选的疑似版本识别；检查、图片对照、保留选择和单对确认删除已连通。

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

## NAS 交接

待本版 App/Worker 均发布成功且同提交 CI 通过后，使用同一明确版本 `v0.54.8`，不要混搭旧 Worker 或仅更新 App。镜像分别为 `ghcr.io/namehu/pixishelf:v0.54.8` 与 `ghcr.io/namehu/pixishelf-worker:v0.54.8`；Docker Hub 对应 `dockernamehu/pixishelf` 与 `dockernamehu/pixishelf-worker`。这些是目标名称，准备阶段不表示已经可拉取。

按[标准发布](../../operations/deployment.md#标准发布)及[去重升级手册](../../operations/runbooks/artwork-deduplication.md)执行：

1. 停调度及外部写入，等待任务收口，再停旧 App/Worker；建立并核验数据库、媒体和配置的同点备份。
2. 拉取配套镜像，使用目标 App 镜像运行正式 `prisma migrate deploy`。包含关系与疑似版本需要 `20261025000100` 至 `20261025000600`；从更早版本升级须同时完成全部前序迁移。禁止 `db:push`。
3. 启动新 Worker，确认 READY 与 capability 审计通过（扫描 v3、维护 v4 及旧任务兼容能力），再启动 App，最后恢复原本启用的调度。
4. 先选原件数在当前上限内的小艺术家，只读观察结果；用可销毁样本确认对照和删除。没有建议不代表没有重复。

本记录未执行 NAS 发布、生产迁移或生产删除。存在未结束的删除操作时不得退回不兼容版本；文件删除不能靠换回旧镜像恢复。后续生产版本、备份集合和实际观察结果由用户反馈后另行登记。
