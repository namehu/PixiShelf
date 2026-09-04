---
status: draft
scope: E-Hentai 标题关键词来源、人工扫描、匹配与归档收件衔接
---

# 标题关键词归档

## 已确认范围

在归档收件工作区将上传者来源扩展为发现来源。公开 E-Hentai 标题搜索支持一个关键词和一种匹配方式：包含、开头是、结尾是；可限制上传者 UID。来源名称可修改，查询条件不可原地修改，改变条件另存来源。相同规范化条件复用已有来源，停用来源可恢复。

匹配按普通文本处理，忽略大小写和首尾空白，保留标点、括号及内部空白。日文和英文标题独立判断，任一命中即可。不支持任意正则、组合规则、自动扫描、自动入箱或自动下载。

## 执行与持久化

在原来源、运行、目录模型上增量扩展 UPLOADER / TITLE_QUERY，保留历史 ID 与关联。查询上传者限制独立于上传者身份绑定，运行冻结查询。新增 ARCHIVE_SEARCH_SCAN@v1，payload 仅携带 scanRunId，使用 ARCHIVE_RESOLVE lane，保留原上传者任务契约。

复用搜索页、批量 gdata 和请求治理；只构造受控 title 查询，不透传搜索表达式。每轮检查最多 100 个远端候选，不为凑满匹配数无限续跑。检查数、匹配数分别展示。进度、水位和分页游标依据未过滤候选推进；只有成功且租约有效的事务才提交，零命中也可继续历史扫描。

审计与长期目录保存匹配标记；查询来源只展示、统计和接受当前匹配项入箱。未匹配不是全局忽略，再次观察到标题不匹配时只隐藏本来源候选。复用 Provider/GID 全局处置锁、归档去重、全局忽略与收件幂等，最终仍人工选择质量和入队。

## 覆盖与安全边界

只能过滤远端搜索实际返回的候选，不承诺全站文本检索及历史标题变更全量补漏。所有页面保持 Session 保护；读取 authProcedure、修改 adminProcedure。旧上传者接口拒绝关键词来源，UID 绑定与自动匹配不作用于查询来源。URL、游标、日志和错误维持现有 allowlist 与脱敏。

远端语法依据 [E-Hentai Gallery Searching](https://ehwiki.org/wiki/Gallery_Searching) 的标题和 UID 限定符及引号短语规则；本地匹配不继承站点的通配符语义。无法安全表达的输入直接拒绝，不把它改写成另一条规则。

## 实施状态（2026-09-04）

已实现来源、迁移、共享契约、受限 Provider、Executor、archiveSearch 接口、发现来源界面及测试。已实现行为见[归档收件箱](../features/archive-intake.md)、[权限边界](../security/access-control.md)和[数据库设计](../../packages/pixishelf-db/prisma/database-design.md)。本文件继续保持 draft，用于跟踪尚未执行的生产发布门禁，不表示已经部署到现有实例。

验证使用独立 PostgreSQL 15 容器，本机端口 55439；浏览器使用一次性账号及隔离应用端口 5439。未对现有数据库或收藏媒体执行迁移、删除、归档或下载。验收后关闭临时 App/Worker 和浏览器页，并移除一次性测试数据库容器、数据卷与空 Worker 目录。

- 最终 migration 在第二个空库完成全部 74 个 migration；旧 UID/目录/运行/水位 fixture 原地保留，活动扫描 guard 在 DDL 前拒绝，事务回滚无残留。
- Worker 依赖链 typecheck/build、DB validate/generate/status 已通过；DB、contracts、runtime、executors、Worker 全部测试均已执行。Windows 符号链接测试的 EPERM 已通过提升权限重跑解决。
- 主应用 lint/typecheck/production build 已通过，串行全量单元测试 279 文件、1622 项全部通过；最终界面与任务展示聚焦回归 4 文件、76 项通过。来源服务、旧 UID 流程、新接口鉴权、并发处置与 UI 测试通过；扫描运行覆盖冻结条件、raw head、零/稀疏匹配、100 条截断、游标绑定、失败/取消/租约丢失、重启恢复和重复分页拒绝。
- 隔离 Worker `/readyz` 返回 200；capability audit 确认 1 个 READY Worker 覆盖 28 个任务类型、31 个执行版本。
- 真实浏览器已检查登录保护、新增、三种模式、非法输入、改名只读条件、另存、类型切换、停用/恢复、创建扫描与取消。注入 100 个候选、8 个命中的合成 fixture 后，页面只展示 8 项及准确检查/匹配计数，人工选择入箱接收 8 项，处理中不可重复选择。检查了桌面及 390×844 窄屏、纯列表与无首图占位预览，并修正筛选条窄屏横向溢出。浏览器验收不等同于真实远端站点搜索或媒体下载验收。
- 首轮并行主应用测试发现跨文件 PostgreSQL 执行 lane 竞争，涉及的标签取消测试单独及最终串行全量重跑通过；另修正归档下载设置测试将 ARCHIVE_IMPORT 错放在 resolver lane 的既有 fixture，不改业务逻辑。
- 仓库原有 scan/rescan fixture 集成测试仍有 6 项失败：模拟客户端缺少 artistExternalRef，而 batch-processor 已读取该模型；这几份文件与实现均无本次差异。image-count 集成及归档 PostgreSQL 集成通过。没有删断言或跳过这些失败。

尚未执行：生产数据副本演练、正式一致性备份/恢复、正式 App/Worker 部署与外网 E-Hentai 实际搜索。不得把本机成功的构建、fixture 或 capability audit 当成已完成生产发布。

## 本地升级记录（2026-09-04）

按用户要求完成本地开发实例迁移与 Worker 重建，不代表生产发布：

- 停写前确认 Next.js、scheduler 均未运行，没有执行中任务或非终态发现扫描；保留一条已暂停的归档任务。停止旧 Worker 后确认无其他数据库客户端。
- 检查点 `20260904-title-search` 保存在仓库外 `%LOCALAPPDATA%/PixiShelf/backups/`，仅当前管理员与 SYSTEM 可访问。包含 custom-format dump、三份媒体目录副本及逐文件 SHA-256、配置、源码 HEAD/工作区补丁/新增文件和部署清单。数据库 dump SHA-256 为 `4BA4DF89E6B28B0E28061AB3E1FF35A6DBFB4047407CF676CEDC5DF70A979D63`。
- 数据库备份恢复到独立验证库后执行同一 migration 演练；5 个作品的原媒体和 3 个视频封面与快照抽样对应。正式 `db:generate`、`db:deploy`、`db:status` 通过，74 个 migration 全部已应用。旧来源、目录及扫描运行的数据指纹在演练与正式迁移后均不变。验收后仅清理临时恢复库与容器内重复 dump，保留仓库外检查点。
- 旧 Worker 镜像保留为 `pixishelf-worker:before-title-search-20260904`；新镜像 ID 为 `sha256:71c9892fa6dab2e148717a543b98d55e8f8bb4aefcc36f0e7fdb1919d4147a15`。
- 重建后的单个 Worker 为 healthy/READY，两个执行 lane 已启动；capability audit 通过，覆盖 28 类任务、31 个版本组合，包含 `ARCHIVE_SEARCH_SCAN@v1`。原暂停任务保持 PAUSED。
- 本次不启动原本关闭的 Next.js 或 scheduler，不创建搜索、归档或下载任务。检查点继续保留；启动本地页面时使用当前工作区代码，不回退到不兼容的新类型旧版本。

## P0/P1 复审记录（2026-09-04）

两位独立审查 agent 分别检查来源服务与扫描执行链，发现并关闭两个 P1；修复后均独立复核 ACCEPT，审查范围内没有未关闭的 P0/P1：

- **首次并发创建冲突**：Prisma 的来源 upsert 在首次并发创建时可能产生 `queryKey` 唯一键冲突。仅捕获该字段的唯一冲突并读取胜出的既有来源，不覆盖名称或停用状态；其他异常和读取不到胜出记录仍失败。新增连续 5 轮、每轮 12 个首次并发请求及错误边界测试，先复现失败，再通过修复；服务侧独立复核 7 文件、105 项测试通过。
- **页内位置变化导致续扫漏项**：原 offset 游标在远端页删除已检查项后会跳过尚未检查的尾项，甚至错误结束历史扫描。页内游标升级为 v2，保存已检查 GID，在重新读取的页面上跳过这些身份而非位置；标题来源的外层冻结查询绑定不变。旧 v1 游标保守重读当前页一次并升级，保留 raw 100 条限制、跨页去重及水位规则。修复后原漏项复现可正确取回尾项；独立复核 68 项测试通过，额外插入、删除和重排页面的模拟在 7 轮内检查完全部 607 个不同候选。
- 最终 Worker 依赖链全量测试 898 项通过：DB 107、contracts 38、runtime 97、executors 570、Worker 86；依赖链 typecheck/build 通过。主应用 lint、typecheck 和提升权限执行的 production build 通过；本轮界面聚焦回归 18 项通过。未重复主应用全量单元测试或真实浏览器验收，原验收及既有集成失败记录仍见上文。
- 测试使用本轮一次性 PostgreSQL 容器及两个隔离库，不接触真实数据库、媒体或运行中的 Worker。两项修复没有新增或修改 migration。复审完成时仅完成代码和构建产物修复；后续按用户要求进行的本地 Worker 部署见下节。部署新游标后不得直接切回不识别 v2 的旧 Worker。

## P1 修复本地部署（2026-09-04）

- 本地 Worker 已重建并于 16:46 启动，新镜像为 `sha256:eca4dfda72b62dcfc54101ba3d08808bfaecda11b18c86a7636803bc88ccb72c`，运行中容器镜像核对一致。healthy、READY 及 capability audit 全部通过，单实例覆盖 28 类任务、31 个版本组合，两个执行 lane 已启动，包含 `ARCHIVE_SEARCH_SCAN@v1`。
- 切换前确认无活动任务或发现扫描，App 与 scheduler 原本未运行。停止旧 Worker 后确认无其他数据库客户端，保存新的 custom-format dump、配置及源码补丁。三个媒体目录及原快照共 1,819 个文件逐一校验 SHA-256 相同，复用此前已验证的配套媒体快照；新 dump 已恢复到独立临时库并通过领域数量及指纹核对。
- 恢复依据及部署记录保存在原受限检查点的 `p1-cursor-fix/` 子目录，旧镜像保留为 `pixishelf-worker:before-p1-cursor-fix-20260904`。临时恢复库和容器内重复 dump 已删除，检查点保留。旧镜像不理解 v2 游标，不能在新游标写入后直接作为回滚版本运行。
- 启动后作品、图片、归档版本、来源、目录及扫描运行数量和指纹不变，原一条暂停归档任务保持 PAUSED。本次未执行数据库 migration，不启动 App 或 scheduler，也不创建扫描、归档或下载任务。

## 验证和发布门禁

覆盖三种模式、双标题、Unicode、空白、标点、非法输入，100 条/页内续扫、零命中/首项不命中、远端结束/水位消失，以及取消、租约丢失、重试恢复。数据库验证来源去重、查询冻结、跨来源处置、陈旧页面入箱、未授权零写入和旧上传者迁移无损；UI 回归 UID 绑定、停止恢复与原收件流程。

运行聚焦测试、DB 校验和隔离 PostgreSQL 迁移、Worker 依赖链 typecheck/test/build、主应用 lint/typecheck/相关集成测试/build，并记录真实浏览器检查。未执行的检查必须明确列出，不以 CI 代替。

采用正式 expand migration，不使用 db:push。正式部署前按备份规范停止写入并建立数据库、媒体、配置和镜像的一致性检查点；迁移后配套部署 App/Worker，READY 与 capability audit 通过再开放新入口。新增类型存在后不能直接运行旧版 App/Worker；完整回滚恢复检查点，或保留兼容代码并停用新入口。本草案在实施和验证完成前不标记为 current。
