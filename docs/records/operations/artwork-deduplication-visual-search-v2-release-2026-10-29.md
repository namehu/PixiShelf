---
status: historical
scope: v0.55.1 去重内存检索与阶段进度发布交接；生产由用户更新和验证
last-verified: 2026-10-29
sources:
  - docs/records/artwork-deduplication-visual-search-v2-2026-10-29.md
  - docs/records/artwork-deduplication-visual-search-v2-review-2026-10-29.md
  - docs/operations/runbooks/artwork-deduplication.md
  - .github/workflows/build-and-deploy.yml
---

# v0.55.1 发布交接

## 本轮授权与范围

用户在上一轮提交暂停后批准“那就把12做了呀 3我自己去生产验证”。对应两项为：补实际 Node Worker 进程重启续跑和持续检查时桌面浏览验证；合入最新 main 并准备 patch 发布。该授权替代上一轮“不自动合并、发布”的停止点。第三项 NAS 更新与生产性能验证由用户执行；本轮不操作生产数据库、媒体或容器，也不查询 GitHub 工作流／镜像发布状态。

## 合并基线

- 去重功能提交：`4ade7b44`，共同基线 `3a5b5ee2`。
- 合并前主目录、origin/main 与 `v0.55.0`：`8ea4d57c90b9f82f3ec9508b496f2205b5bccbe2`；主目录与暂存区干净。
- 在独立 `codex/dedup-visual-search-v2` worktree 合入主线，保留归档来源忽略、稍后决定、部分下载／补全及其后续修复。
- 仅两处冲突：Worker 完整能力的测试总数与异常文案。保留双方任务版本，合并后 39 种任务、63 个版本；实际验收仍核对完整 capability 清单，不用数量代替。
- 目标 patch 标签 `v0.55.1`，不覆盖旧标签。标签与 main 一起原子推送；镜像状态由用户查看，本记录不证明镜像已经生成。

## 验收依据

已有算法、缓存、统一进度、专项故障、混合媒体和实际删除证据见[主验收记录](../artwork-deduplication-visual-search-v2-2026-10-29.md)及[独立审查](../artwork-deduplication-visual-search-v2-review-2026-10-29.md)。本轮只补两项运行验收与合并交集检查，不重复全量应用 lint/test/build。

5,000 条预制特征同样本：检索与配对 46.221 秒降至 9.174 秒（80.15%），事务 2,046 降至 103（94.97%）；完整热检无重新解码或候选检索。该结果不代表生产图片解码、NAS 或全库速度。1 万登记原件的生产上限保持不变。

主线合并提交 `a7f2eedb`。独立 GPT‑6.1 Sol / xhigh 复审核对：两方交集仅 Schema、Worker capabilities、registry 测试三个文件；其余 101 个主线变更文件与合并前逐字节一致。Schema 相对主线只新增去重四字段；主线的执行上下文仅新增可选的子任务版本，未改 finalizer 语义；去重调度让行修复与原功能提交逐字节一致。无新增 P0/P1/P2。

隔离合成库完成主线三条追加迁移、Prisma generate，合并后的必要 Worker 依赖链构建通过（存在已有 CJS import.meta 提示），registry 专项 13/13 通过。未重复 typecheck、全量应用验证或全部测试。本轮实际 Node 进程重启与计数证据见[补充验收记录](../artwork-deduplication-visual-search-v2-release-validation-2026-10-29.md)。真实终止仅发生在新增合成样本，旧租约自然到期后同一 run/job 自动续跑；浏览器观察到特征 127/2,000、刷新后 1,211/2,000、视觉 1,792/2,000，最终 25 组，无需点继续，无整体 99%。[恢复截图](../evidence/visual-search-v2/release-restart-resumed.jpg)、[视觉阶段](../evidence/visual-search-v2/release-restart-visual.jpg)、[完成截图](../evidence/visual-search-v2/release-restart-completed.jpg)。

桌面并发浏览只部分形成可用证据：扫描期间艺术家列表可打开，导航 API 返回 1.822 秒；点击作品详情后浏览器 URL 等待与状态工具超时，随后完整 40 张详情正常显示。服务日志该详情 HTTP 200 / 1.824 秒，不能据此替代端到端交互耗时或排除浏览器问题。[详情恢复截图](../evidence/visual-search-v2/release-detail-blocked.jpg)。检查结束后展开图片与结果翻页正常。此次未建立生产浏览性能达标结论，留给用户 NAS 实测；没有把工具超时隐藏为通过。

首轮 2,000 张检查先自然完成，未赶上进程终止，作为并发浏览证据保留；第二轮通过原领域 start 入口发 FULL，仅补一次真实 SIGKILL，未修改租约或任务状态。实际 kill 位于原件阶段，纯视觉计算中 kill 的 OS 级覆盖仍未增加；先前真实 PG 的执行器续跑专项保留原有范围。文档链接检查通过；图示检查首轮因缺少 Playwright 内置 Chromium 未执行，按仓库说明用已安装 Chrome 完成 34 张图源及 23 个内嵌 Mermaid 的检查，未重新生成图或安装浏览器。

## NAS 更新

用户先查看 tag 对应流水线与两镜像发布成功，再成对使用：

- `dockernamehu/pixishelf:v0.55.1`
- `dockernamehu/pixishelf-worker:v0.55.1`

GHCR 对应 `ghcr.io/namehu/pixishelf:v0.55.1`、`ghcr.io/namehu/pixishelf-worker:v0.55.1`。Compose 使用 `IMAGE_TAG=v0.55.1`；这些是目标镜像名，不表示本轮查询过镜像状态。

相对 v0.55.0 只新增正式迁移 `20261029000300_artwork_dedup_visual_search_v2`：增加可空运行指标、检索版本和输入摘要，完整静图覆盖默认为 false，并允许扫描协议 v8；不读取媒体、不删除作品、不把旧结果回填为完整。若当前 NAS 仍早于 v0.55.0，还须按[归档部分下载升级](../../operations/runbooks/archive-partial-coverage.md)处理已经在主线的归档迁移和兼容约束。

沿用[标准发布步骤](../../operations/deployment.md#标准发布)：停止调度／外部触发，活动任务经业务入口收口，停止旧 App/Worker，建立数据库与媒体同点备份；拉取配套目标镜像，用目标 App 的 Prisma `migrate deploy` 正式迁移；先启动 Worker 并检查 READY 和完整 capability，再开放 App，最后恢复原本启用的调度。禁止 db:push。新 Worker 兼容扫描 v1–v8、维护 v1–v6；旧任务继续原协议，新建检查才使用 v8，不能手改旧任务版本。

存在活动 v8 检查时不能直接回退为不理解其检查点的 Worker。保留迁移和检查点，按[去重升级与恢复手册](../../operations/runbooks/artwork-deduplication.md)处理；本轮没有替用户创建生产备份。

## 生产性能验证交给用户

先在现有上限内选一个艺术家新建检查，再在输入不变时正常检查第二次。首次 v8 仍可复用有效旧特征，但不能复用旧算法的完整无匹配结论；第二次完整热命中才跳过候选遍历。不要用“完整检查”模式衡量缓存。

记录两次 runId，使用[单次瓶颈只读 SQL](../../operations/queries/artwork-dedup-run-status.sql)与[两次对比只读 SQL](../../operations/queries/artwork-dedup-run-compare.sql)核对版本、输入摘要、采集截止时间和完整性，再比较耗时、读取量、解码、候选精比、事务／DB 调用及排队时间。DB 调用数不等于 SQL 条数，事务耗时不等于磁盘耗时。三个页面展示当前阶段与已提交数量；不是总任务 99%，也不估算整项剩余时间。

本轮自建 App 5498、ImgProxy 5499、Worker 55838 及已采样读取子进程已停止；隔离数据库、合成媒体和证据保留，未停止用户其他服务。主目录仅接收代码快进，不迁移或启动主目录开发环境。
