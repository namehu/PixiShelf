---
status: historical
scope: F01 部分重复实现、隔离验证及交接；不代表开发库或生产已部署
last-verified: 2026-10-26
sources:
  - docs/design/artwork-deduplication/partial-overlap-contract.md
  - packages/pixishelf-db/src/artwork-dedup-partial.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-partial.postgres.test.ts
---

# F01 部分重复验收

## 版本与范围

基线 `2b184acaa96b12b4da30635493f30c9b28d20ca2`，独立 worktree 分支 `codex/dedup-partial-overlap`。只实现默认 SHA 部分重复、图片对照、手选版本及单对删除；不包含 F02 缓存重构、F03 规模扩展或视觉调参。功能边界以[当前规格](../features/artwork-deduplication.md)为准。

模型：核心 GPT-6 Astra/high；App 和独立审查 GPT-6.1 Sol/xhigh；浏览器 GPT-6.1 Sol/medium。最终提交后暂停，无发布标签、推送或部署；主目录、用户 5430 App、开发数据库与用户 Worker 未改动。

## 环境与样本

- worktree：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`。
- 独立 PostgreSQL `127.0.0.1:55432`：`dedup_partial_core` 用于串行定向测试，`dedup_partial_browser` 用于浏览器。
- App `http://localhost:5482`，Worker 健康端口 `55823`，三条 lane 均 READY。
- 临时数据根 `/private/tmp/pixishelf-partial-f01`；账号与环境值仅留在私有文件中，不进入仓库。A/B/C 各 100 张几何合成 PNG；A/B 有 80 张字节相同（B 改名反序），双方各 20 张未配对，C 为负例。仅 B（ID 2）获准删除。
- 合成生成脚本与初始 SHA 清单为重建依据；执行前审计 300 文件均存在且 SHA 相符。此依据不等于真实图库备份。

## 定向验证

后端最终 83 个不同测试通过（8 文件，初轮失败及复跑不重复计数）：

| 范围            | 通过数 | 主要覆盖                                                                     |
| --------------- | ------ | ---------------------------------------------------------------------------- |
| 扫描执行器      | 31     | 80% 边界、重复次数、短作品、旧 v3、动画/视频原件、缺失排除、热缓存零内容读取 |
| 扫描/维护契约   | 7      | v4/v5 与确认协议                                                             |
| PARTIAL 单元    | 10     | 独立摘要校验、准备重试协议矩阵                                               |
| 审核 PG         | 11     | 必须手选、排除推荐全选、拒绝混批、冻结 SHA                                   |
| PARTIAL PG      | 2      | 102 候选不截断、51 对处回滚与续行；历史非空迁移                              |
| 删除 PG（筛选） | 10     | PARTIAL 双向选择、双方变化零删除；原视觉与四来源包含回归                     |
| Worker 注册     | 12     | 新旧任务能力与协议解析                                                       |

四个后端包 `db/job-contracts/job-executors/worker` typecheck 通过。App 一次 `pnpm typecheck`（Next typegen + tsc）通过；必要 Worker 产物构建一次通过，保留已有 CJS/import.meta 三项构建警告，隔离实际启动 READY。

App 9 个定向组件/服务 mock 文件 91 断言通过；3 个服务 PostgreSQL 文件共 14 断言最终通过（其中 retry 文件修复夹具后单独复跑 8 断言通过，其余 6 断言取已通过运行，不重复计数）。范围 oxlint 44 文件、0 警告 0 错误。原范围重试用例补 MATCH/VISUAL 两种游标复位；PG 夹具缺 imageId、未绑定持久版本与遗留授权任务已修复，未改变生产行为。未运行全量 App lint/test/build。文档检查通过：275 份 Markdown 的链接/锚点/大小写/围栏；33 个图源及 23 处内嵌 Mermaid。图源未变化，不重生成 SVG。最终 diff 检查及主 App 路径大小写检查通过。

正式迁移 `20261026000100_artwork_dedup_partial`：122 个 migration 在两个空隔离库完整 deploy 成功。非空升级探针在事务内重建前一版视图/约束、保存旧 VISUAL/protocol3/job4 数据后应用新增迁移，确认旧数据与 scope digest 保留，新旧任务协议约束正确，随后回滚；并非真实旧库全量恢复演练。该 DDL 探针需显式 `ARTWORK_DEDUP_PARTIAL_UPGRADE_EXCLUSIVE=1` 且独占专用隔离库，普通 checkpoint 测试不绑定库名。

## 独立审查

Sol/xhigh 初审发现原范围重试删除结果后未清 PARTIAL 游标，可能漏掉已处理前段；已修复双游标归零，补 MATCH 取消及 VISUAL 失败场景。最终只读复审未发现未修复 P1/P2，核对候选完整性、次数、断点事务、协议兼容、双方原件复核、单对限制及页面语义。删除定向测试另发现协议 4 的认领/恢复矩阵遗漏，修复并复验后纳入最终审查。

## 浏览器与文件审计

浏览器通过 UI 默认快速检查与热缓存重查（未开启疑似版本），两次均只有 A/B 一对 PARTIAL，80 个相同、双方各 20 个未配对，C 未出现在结果中；无默认保留或批量框。

| 检查   | Run ID                                 | 原件读取字节 | 新计算 SHA | 缓存命中 |
| ------ | -------------------------------------- | ------------ | ---------- | -------- |
| 冷检查 | `b7cd0949-2547-42cd-b527-e7d4703d62da` | 1,946,870    | 300        | 0        |
| 热检查 | `01516d14-6288-4087-b00d-8ddfead4d79a` | 0            | 0          | 300      |

上述为数据库持久统计，均 COMPLETED/DONE、扫描定义 v4、无 errorCode；只证明本合成样本热缓存免原件重读，不等于关系匹配零成本。浏览器实际通过桌面 1280×900 与手机 390×844 CSS 视口：未配对优先、分页、相同/全部筛选、桌面并排和手机左右切换；媒体对照原件加载正常、无横向溢出。显式保留 A 后，缺任一确认项均不能执行；完整确认后仅删除 B。删除记录与刷新保留部分重复、双方数量及未配对摘要，B 无作品链接，艺术家页仅剩 A/C。手机有效证据为 `05-mobile-compare-left.jpg`、`06-mobile-compare-right.jpg`、`15-mobile-record-refreshed.jpg`（390×844，主 agent 已打开核对）；`13-mobile-deletion-complete.jpg` 切换视口过快捕获旧帧比例，不用于手机布局验收。

操作 `1907b58a-a4e2-429f-8ca1-b71b5c64e509` 的独立数据库审计为 DELETED/DONE、确认协议 4、已删 100 个文件、无 errorCode。文件系统逐项比对初始 SHA 与长度：A/C 共 200 文件未变、各自业务记录仍在；B 的 100 文件与业务记录均已删除。

合成样本没有生成派生封面，艺术家卡片的派生缩略图未提供；图片对照使用的原件正常。此夹具限制未引发产品代码扩展。

证据目录：`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-partial-f01-2026-10-26/`，含桌面/手机关键步骤截图及 `before-audit.json`、`scan-audit.json`、`after-audit.json`。核心与 App 测试摘要同时保存，原始定向命令日志仍在临时目录；摘要明确区分最终结果与初轮夹具失败。

## 限制与恢复启动

本批不证明 50 万吞吐、跨次关系缓存或真实有码/无码识别效果；F02–F04 保留后续计划。手机尺寸浏览器不能代替真机触控、iOS Safari 安全区和动态地址栏验证。

隔离重启脚本：`/private/tmp/pixishelf-partial-f01/start-app.sh` 与 `start-worker.sh`；私有 manifest、种子和 SHA 审计均在同目录。本任务 App/Worker 已通过 SIGTERM 正常停止，两个隔离端口已释放，Worker 无在执行任务且三条 lane 完成退出；数据和证据保留，用户服务未停止。开发环境使用本分支前，按[运维手册](../operations/runbooks/artwork-deduplication.md)应用正式迁移、重建配套 Worker，App 由用户启动；本轮没有代为升级开发库。
