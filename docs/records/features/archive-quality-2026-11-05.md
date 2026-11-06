---
status: historical
scope: EH 实收画质、历史记录核验与原图升级的本地实现验证；未部署生产
last-verified: 2026-11-05
sources:
  - packages/pixishelf-job-executors/src/archive/__tests__/quality-evidence.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/quality-audit-executor.test.ts
  - packages/pixishelf-job-contracts/src/__tests__/archive-quality.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts
  - packages/pixishelf/services/archive/__tests__/archive-task-service.postgres.test.ts
  - packages/pixishelf/app/artworks/[id]/_components/__tests__/archive-quality-panel.test.tsx
---

# EH 归档画质本地验证

适用版本是 2026-11-05 当前工作区，未登记发布提交或镜像 digest。环境为本机 macOS、Node 20、pnpm 8。数据库迁移和文件替换使用独立 PostgreSQL 16 实例与临时合成媒体。生产数据库通过获准的 `pixishelf_diagnostics` 连接作有限只读核对，生产全库核验和原图升级留待管理员从页面发起。

架构和集成审查由主线程负责，代码和缺陷修复由 GPT-6.1 Sol xhigh 完成，GPT-6.1 Terra 独立执行 PostgreSQL 全链与反例回归。用户确认当前没有可用的 EH 登录态，真实第 3 页原图下载验收保留为待验证项。

## 核验内容

- 新增增量 migration `20261105010000_archive_quality_evidence`：逐项成功交付凭据、修订逐页证据与汇总，新插入归档默认 DISPLAY；历史画质偏好不重写。原图升级独立意图使用 `20261105011000_archive_original_upgrade`。
- 历史核验从归档记录证明最后成功尝试，匹配文件 SHA-256、字节数、快照与当前 Image ID／路径／顺序。缺失、冲突及不可信地址返回 UNKNOWN 及理由，不读取媒体文件。
- 冻结复用页只在未发生新下载尝试、来源页／页码／文件摘要／大小均一致时继承旧证据。新增回归覆盖新原图与旧展示图恰好相同字节时，使用本次成功凭据。
- 后台任务每批保存游标后让出 Writer；测试覆盖暂停、取消、失败父任务游标续跑与最终累计汇总。
- 发现结果、任务抽屉及作品详情显示当前实际画质；任务偏好明确标为“请求”。未核验记录不展示伪造的零页质量统计。详情显式发起原图升级，失败重试沿用同一幂等键。
- 原站整部大小与本地大小分别展示，新增 232 页／1.04 GiB 格式化与列表断言；来源缺值不回退为下载累计。

## 已执行验证

| 检查                                 | 结果                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Prisma validate / generate / deploy  | 隔离 PostgreSQL 完整迁移通过，重复 deploy 无待处理迁移；重新生成客户端后验证新增 DISPLAY 默认与升级意图 CHECK 约束 |
| job-contracts 全量                   | 185 项通过                                                                                                         |
| job-executors 全量（提升权限）       | 1120 项通过，563 项 PostgreSQL／外部条件测试跳过                                                                   |
| Worker 与依赖链 typecheck            | DB、contracts、runtime、executors、Worker 全部通过                                                                 |
| Worker 全量                          | 121 项通过，12 项 PostgreSQL 条件测试跳过                                                                          |
| job-runtime 全量                     | 35 项通过，106 项 PostgreSQL 条件测试跳过                                                                          |
| 隔离 PostgreSQL 下载／发布／退休整套 | 58 项通过，无跳过；包含 EH 部分升级与后续补全                                                                      |
| 隔离 PostgreSQL 归档任务控制整套     | 44 项通过，无跳过；包含已有 ORIGINAL 恢复和三条重试入口                                                            |
| 画质证据／批次定向                   | 最新 26 项通过，包含尝试时间窗口、快照损坏时全部页待核验、当前媒体数量不符、冻结继承和新下载优先                   |
| Terra 独立核验／Cookie／重定向       | 5 个文件共 93 项通过                                                                                               |
| 详情／发现列表／任务布局             | 34 项通过                                                                                                          |
| 任务逐页 wire／管理抽屉              | 47 项通过，含旧请求偏好不冒充实收与失效凭据拒绝                                                                    |
| 按需画质原因／详情／本地容量         | 4 个文件共 17 项通过，覆盖分页、历史任务缺失、脱敏及修订变化后的缓存                                               |
| 主应用 lint / typecheck / unit       | 最新全量 3774 项通过、386 项外部条件测试跳过；后续详情小改通过上述定向回归，最终 lint 无错误／警告，typecheck 通过 |
| Worker 与依赖链 build                | 全部通过；保留现有 CJS 构建的 3 条 import.meta 警告                                                                |
| 主应用 build                         | 使用完成全部迁移的隔离 QA 数据库通过，退出码 0；日志无 Prisma 错误、缺列或其他告警                                 |
| 文档链接检查                         | 390 个 Markdown 文件通过                                                                                           |
| 文档图示检查                         | 使用本机 Chrome 检查 34 个图源、23 个内嵌 Mermaid 块通过；本轮没有图源变更                                         |

普通沙箱禁止测试监听本地端口和部分隔离子进程 IPC，首次执行器／Worker 全量中的相应失败在提升权限后消失。Worker capability 清单新增核验任务及升级版本后修正固定快照，受影响注册表 13 项复跑通过。测试输出保存在本机 `/tmp/pixishelf-audit-*-test-elevated.log`；这些临时文件不是长期归档或生产证据。

隔离 PostgreSQL 场景使用 EH 来源标识及合成 H@H 交付证据，覆盖 30 页来源先归档 20 页，其中 1 页已证实原图。升级复用该页、下载另外 19 页，保留 Image ID、阅读位置、书签、单图喜欢和作品评分。之后补全只下载余下 10 页，最终 30 页全部为原图。清理在旧目录发现未知文件时保留现场，移除该合成障碍后重试成功。新旧文件字节和摘要不同的情况也经过这条链路。

独立回归曾检出严格原图门禁把升级或补全的可信复用页当作旧不明检查点的问题。修复通过已核验的基础修订与冻结页身份匹配允许复用，使用 EH 来源标识重新执行上述链路通过。数据库测试还发现生成客户端携带旧 ORIGINAL 默认值；重新生成后，SQL 与 Prisma 新增记录的 DISPLAY 默认均验证通过。

完整下载套件的首次回归受本次新增测试未清理的维护任务影响。修正 fixture 的清理集合并移除隔离库内确定的合成孤儿任务后，58 项完整套件通过。没有修改退休校验来规避这些失败。新增 Schema 导致 TypeScript 对整个扩展 Prisma 客户端的比较超过深度，Better Auth 参数改为适配器实际使用的四个模型 delegate 的类型，保留现有事务客户端与运行时行为，11 项认证及移动边界测试通过。

主要复验命令需要将数据库 URL 指向明确的隔离测试实例。

```bash
QUEUE_KERNEL_TEST_DATABASE_URL='<isolated-qa-url>' pnpm --filter @pixishelf/job-executors exec vitest run --config vitest.config.ts src/archive/__tests__/download-lane.postgres.test.ts --testTimeout 30000
PIXISHELF_TEST_DATABASE_URL='<isolated-qa-url>' DATABASE_URL='<isolated-qa-url>' pnpm --filter @pixishelf/next exec vitest run services/archive/__tests__/archive-task-service.postgres.test.ts --testTimeout 30000
pnpm --filter @pixishelf/worker... typecheck
pnpm --filter @pixishelf/worker... build
```

首次主应用构建读取本机现有数据库时，系列页预渲染捕获到缺少既有 `Artwork.logicalMediaCount` 字段的错误。保留该数据库，显式用已迁移的隔离 QA `DATABASE_URL` 重跑完整构建，结果通过且日志无该错误。最终构建日志位于本机 `/tmp/pixishelf-delivery-app-build-qa.log`。验证结束后关闭本次独立临时 PostgreSQL 容器，现有实例的升级和迁移仍依照发布流程执行。

## 限制与发布前检查

生产样本作品 `21909` 的 232 页通过只读 SQL 核对成功尝试、SHA-256、字节数、发布快照与当前媒体身份；30 页 `/om/` 派生件证据和 202 页 `/h/` 的 `xres=1280` 证据均与实收记录对应。第 3 页的原件描述为 1992 × 2912 PNG、4,670,970 字节，交付件与成功记录为 1280 × 1871 WebP、136,342 字节。该结果说明归档记录对应缩放展示版；今天 NAS 上的字节尚未复读，生产画质字段尚未写入。

真实 EH 登录下载、浏览器联调与生产部署尚待验证。升级上线前仍需按[备份恢复基线](../../operations/backup-and-recovery.md)登记同点数据库和媒体检查点，配套部署 App/Worker 和密钥，并用有效登录态确认示例第 3 页实收 4,670,970 字节的 PNG。生产作品 `21909` 的原图升级由用户在详情单独发起。

历史核验批次的暂停、取消与失败续跑已通过模拟事务测试，尚未单独执行 PostgreSQL 批次故障演练。隔离媒体使用合成图片，真实 NAS 吞吐和公网 EH 额度、会话有效性留待上线前验证。

## 本地开发 Worker 启动验证

2026-11-05 按用户要求构建并启动本地开发 Worker。目标为 `build/docker-compose.dev.yml` 的 `build-worker-1` 和本机 `127.0.0.1:5432/pixishelf`，媒体根为 `/Users/namehu/Downloads/pixiv`。镜像 ID 为 `sha256:c4a35626c5e78ef26ba92a999a3ff63f206083ef3f8dec3e6f04d35f7a8fc966`。

停写后保存数据库、三个媒体目录、配置及旧 Worker 镜像，检查点位于 `/private/tmp/pixishelf-local-worker-20261105-o7s0m5dv`。受限目录包含文件校验清单、custom-format dump、旧镜像、迁移前后输出及隔离恢复演练结果。已在独立 PostgreSQL 15 实例完整恢复并部署待应用迁移，再对本地目标应用 5 条迁移。全部 140 条 migration 已就绪，阅读 postflight 逐项核对通过，保留 23 条阅读记录和封存的 175 条旧已读成员。演练容器已关闭。

本地 `build/.env` 和 `packages/pixishelf/.env.local` 已配置相同的独立 32 字节 EH 密钥，Worker 已验证注入。Cookie 由用户在设置页录入，记录不包含凭据值。容器显示 healthy，READY 命令退出 0，capability 审计确认 1 个 READY Worker、41 个任务类型及 57 个版本组合。解析、下载和 writer 三个通道均启动；原有两条 `TRASH_ARCHIVE` 等待任务已按队列完成。

## 本地手工回归清单

Web 使用现有 F5 配置或在仓库根执行 `pnpm -C packages/pixishelf dev`，入口为 `http://127.0.0.1:5430/admin/archive/inbox?entry=direct`。下面的未勾选项表示留给用户操作的 UI 验收。

- [x] 本地 Worker 镜像构建、数据库迁移、阅读数据核对、三个通道 READY 和能力审计通过。
- [ ] 从发现列表加入收件箱，在等待解析时确认已知页数和“原站整部”大小立即出现；选择前 20 页后仍显示整部大小。
- [ ] 直接粘贴新链接，解析完成后显示原站整部大小；缺失大小时显示未知。
- [ ] 新归档各入口默认缩放展示版；已保存为原图的旧任务重新打开或重试仍选择原图。
- [ ] 在归档任务页点击“历史画质核验”，直达 `/admin/setting?tab=system#archive-quality` 后发起核验；在 `/admin/tasks` 暂停并继续，进度从已完成批次续行，任务列表不增加图片下载任务。
- [ ] 核验后检查作品详情和已归档发现结果的画质；逐类页数与当前归档页数对应，待核验页可以展开具体原因及翻页。
- [ ] 作品详情默认收起归档信息，展开后查看原站整部大小、画质页数和“根据下载和发布记录核验”说明；相同原因按批合并页码，翻页保留总数；任务详情区分请求与实际画质。
- [ ] 未配置有效 Cookie 时尝试原图下载，任务暂停并说明原因；已有作品仍可阅读。
- [ ] 获得有效登录态后，在设置页保存 Cookie，刷新后仅显示配置状态，原图任务可以继续。
- [ ] 为一部前 20 页测试归档设置阅读位置、书签、单图喜欢和评分，再发起下载原图；下载期间旧版可读，成功后仍为 20 页且这些状态保留。
- [ ] 升级后查看逐页原图证据、旧文件清理维护任务及媒体读取；继续“下载剩余图片”时仅补剩余页，并沿用原图画质。
- [ ] 有有效 EH 登录态后，核对示例第 3 页实收为 1992 × 2912 PNG、4,670,970 字节。生产作品 `21909` 的升级由用户独立发起。

清理失败恢复、Cookie 重定向泄漏和冲突证据等故障场景已由隔离自动回归覆盖，手工清单使用正常管理入口验证。

当前用户规则见[EH 归档画质](../../features/archive-quality.md)，本记录不作为持续维护的规则正文。

## 本地样本的判定与展示修正

用户反馈本地作品 `41`（EH `4289474`）的 254 页显示原图 8、展示图 20、未知 226，未知原因全部为“交付地址中的缩放档位互相冲突”。2026-11-05 在本机 `127.0.0.1:5432/pixishelf` 使用只读事务重放实际成功记录及当前修订，没有读取媒体文件、请求 EH 或写回核验结果。

确认 175 页为可信 `/h/` 地址上的 `xres=800` 且实收宽度 800，原解析器未支持该档。另 48 页为 `xres=1280`、3 页为 `xres=800`，交付宽度与档位不同。旧分支把未支持档位和宽度不符都归入同一“冲突”原因。修复后 175 页通过展示版判断，另外 51 页保留待核验并提示缺少原图对照；不同档位值相互矛盾才使用冲突原因。

只读重放确认 254 个媒体、发布快照、下载项和成功交付回执全部关联。新结果为原图 **8**、展示图 **195**、待核验 **51**；这是实际记录复算结果，旧修订字段须由管理员重新发起历史核验后更新。旧回执保留不改写，规则定义版本更新为 2，JSON 结构版本仍为 1。

阅读区改为默认收起的一行归档信息；展开后按原因合并页码，并注明本批条数及总数。归档任务页和作品信息增加历史核验直达入口。按用户要求，本轮未继续真实 EH Cookie 与原图下载验收。

修正规则及回执兼容的定向回归共 162 项通过；UI 六个套件共 53 项通过。Terra 独立复验后，主应用全量 3786 项通过、386 项数据库条件测试跳过，lint 无警告或错误；Worker 依赖链 typecheck 通过。首次沙箱执行的监听权限失败和超时已分别在提升权限、限制并发后复验通过。最后的原因缓存刷新小改独立复跑面板 6 项通过。

使用实际 React 组件及应用编译样式，在本机 Chrome 的 1200×760 和 390×740 视口检查收起、展开、44 px 触发区及原因翻页；没有横向溢出。截图及临时组件脚本位于 `/private/tmp/pixishelf-quality-preview.lfrPWb`。查询、导航和待核验页码为测试数据，主界面的认证会话未接入，此结果属于组件浏览器验证。自动界面连接连续超时，未把组件验证记为真实登录端到端验收。

文档检查通过 390 个 Markdown、34 个图源和 23 个内嵌 Mermaid 块；界面技能检测未报告问题。

主应用最终 `pnpm build` 与完整 `pnpm typecheck` 通过，运行中的本地开发服务仍在 5430 端口。已构建并启用修正后的本地 Worker，镜像 ID 为 `sha256:0a1fb8b9185a0b2ddcc785ca66fb72c48a52c6075b16e84d681b18426789be07`；READY 和 capability 检查通过，报告 1 个 READY Worker、41 种任务及 57 个版本组合。

启动时 Docker 的 59 GB 虚拟磁盘耗尽，PostgreSQL 写入 Worker 在线状态报 `53100 / No space left on device`。暂停重启中的 Worker，仅清理本任务两次构建产生且未被镜像共享的中间缓存 `k2m0vhxhp15j0kdn8r98thbhj` 与 `vpj0rtrc0rhepqk6vub3wpb6h`，共约 921 MB；随后可用空间为 874 MB，Worker 正常恢复。数据库卷、媒体、新旧镜像及此前恢复检查点均保留。构建日志位于 `/private/tmp/pixishelf-quality-worker-rebuild.log`。

## 图片版本文案与旧统计收尾

用户再次反馈“原图／展示图／待核验”无法解释新下载的结果，页面仍为 8／20／226。只读确认本地作品 `41` 的当前修订保留规则版本 1，上一轮只读复算没有写回旧统计。

补充核对 8 张原图：全部由可信 H@H 地址标记 `xres=org`；8 份成功回执的实收 SHA-1 与地址文件描述一致，尺寸、格式、字节数吻合，SHA-256 及发布页映射通过既有规则核对。此依据证明归档时保存版本，不表示已重读今天的磁盘文件。

在事务中对该作品唯一当前修订调用现有 `refreshArchiveQualityEvidence`，写回版本 2 的 **8 张原图、195 张网页阅读版、51 张无法确认**。写入前备份画质字段到 `/private/tmp/pixishelf-artwork-41-quality-backup.oe0tJG/before.json`（目录 0700、文件 0600）；临时脚本为 `/private/tmp/pixishelf-quality-refresh.Q0dDge/refresh-artwork-41.ts`。仅更新派生画质证据、统计和核验时间；原下载回执、媒体快照、图片及阅读记录保留，未请求原站或触发下载。

详情改为完整说明保存的图片版本，定义原图和网页阅读版；已识别但无法确认的结果不再写成“待核验”。具体原因按需展开，避免把内部“交付／档位”术语当作正文。核验入口保留，不承诺重新核对一定能确定全部图片版本。管理进度与结果统计同步使用“网页阅读版／无法确认”。

本轮六个 UI 定向套件 54 项通过；Terra 最终独立回归为主应用 3787 项通过、386 项条件测试跳过，lint、完整 typecheck 和生产 build 均通过。实际组件在桌面与手机视口完成两级展开、懒加载、分页及无横向溢出检查，测试查询截图位于 `/private/tmp/pixishelf-image-versions-preview.ITPRel`。数据库读回为版本 2、8／195／51，旧 `CONFLICTING_HATH_XRES` 页数为 0；本地 Worker 保持 healthy。文档及图示检查通过。

## 新下载遗漏原件对照的根因与修复

用户要求继续查清剩余 51 张新下载为何不能识别。只读数据库确认这 51 份成功回执都没有原图说明。代码根因为 Provider 在同一图片页已经解析 `Download original` 的尺寸与大小，却仅在请求 ORIGINAL 时返回 `originalClaim`；DISPLAY 分支丢弃了它。下游存储、下载回执和发布记录因此无从保存该事实，旧识别器又把实际宽度与数字档位不同视为缺少对照。

本次在线诊断以本地 EH `4289474` 的 51 个来源页为边界，不带 Cookie，只读取公开 HTML。51／51 页当前均有可解析的同源原图链接及尺寸、大小声明；51／51 页的当前阅读图文件描述 SHA-1、字节数与保存时的文件及实收 SHA-1 一致；全部宽高与原图说明相同，但实收字节数严格小于原图声明的舍入区间。示例第 4 页原图声明为 900×1200、626.1 KiB（641,076–641,177 字节），保存文件为同尺寸 WebP、100,500 字节。因此本次在线对照可确认这 51 份已保存文件属于网页阅读版。未保存下载当时的 HTML，不能把今天的页面观察冒充当时的回执。

修复在 DISPLAY 成功下载中保留单独的 `sourceOriginalClaim`。Provider 将声明与同页选中的文件绑定，Storage 比较声明与实际文件并计算摘要，Executor 保存同一成功尝试的证据，Publisher 和离线核验继续使用该字段。规则定义版本为 3、证据 JSON 结构版本仍为 1，无新增迁移。匹配尺寸和舍入大小不升级为原图；不可信节点、文件摘要不符、矛盾档位及缺失成功尝试仍拒绝定级。

使用实际 Provider 和 Storage 在临时目录下载第 4、63 页阅读文件，分别得到 100,500 字节／900×1200 与 85,562 字节／750×1075 的 WebP。两份实收 SHA-1、SHA-256 通过核对，原图说明被保存，序列化回执后离线重算均为 DISPLAY。临时媒体验证后清理，没有下载原图或写业务数据库。另将 51 页当前 HTML 与旧实收记录在内存中配对验证新规则，51／51 均为 DISPLAY；历史回执缺少该字段的标准离线核验仍保持 UNKNOWN。旧下载回执未被回填。

受限证据目录为 `/private/tmp/pixishelf-eh-source-proof-5jhpbm8l`（逐页 HTML、脱敏报告），临时验证脚本位于 `/private/tmp/pixishelf-eh-live-reading-check.gunKWo`。公开页面中的临时下载签名不复制到仓库或报告正文。

Terra 最终独立回归：执行器 1157 项通过、564 项条件测试跳过；契约 185 项通过；主应用 3787 项通过、386 项条件测试跳过；Worker 依赖链 typecheck、主应用 lint/typecheck/build 均通过。新增反例发现原站小数字节声明会产生空区间，解析器拒绝无效区间后已纳入最终全量复跑。图文检查通过 390 个 Markdown、34 个图源及 23 个内嵌 Mermaid 块。

本地 Worker 已切换为 `sha256:19973620bde85ec3cbc5967d09d15f008135270423d7cbe987182ecb176a83d6`，容器 healthy，READY 与 41 种任务／57 个版本能力检查通过。构建后仅回收本次中间缓存 `xtqk6eunnq4v08zn6qx2eq55s`（约 460 MB），Docker 剩余空间约 767 MB；数据库与媒体保留。构建日志 `/private/tmp/pixishelf-source-original-worker-build.log`。本轮没有将今天的原站信息写回旧成功下载回执；旧 51 页的离线结果与本次在线复查结论分别记录。
