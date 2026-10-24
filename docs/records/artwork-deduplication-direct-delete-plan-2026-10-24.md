---
status: historical
scope: 用户批准去重简化方案后的文档替代关系、实施批次与文档验证证据
last-verified: 2026-10-24
---

# 去重直接删除方案调整

日期：2026-10-24，Asia/Shanghai。适用独立工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication`，基线 HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 加既有未提交改动。本记录仅覆盖文档，不证明后端、UI、正式迁移或新删除能力已通过验收；不修改历史 records 的当时结论。

## 批准范围与替代

[总计划](../design/artwork-deduplication.md)已改为检查、选 keeper、服务端冻结预览、一次不可恢复确认（含外部停写）、Worker 原地逐文件删除、删除记录。四种 ArtworkSource 及混合组全支持为目标；普通 URL 删除仍回收，去重专用绕过回收。隔离/移动/恢复/到期清理不再实施。新独立能力门禁保持关闭，旧 ISOLATION 预览不能授权 DIRECT_DELETE。

保留已验证指纹/检测、分页审核、PREPARE、Claim/来源证明、reader 和逐文件日志基础；不重跑 50 万检测性能。旧隔离与清理页改为兼容入口，旧共享契约标明历史及可保留部分。新增直接删除契约，更新写入口/归档 WIP 的适用边界、页面稿/原型和五张图（检测缓存时序保留语义）。必要文档入口和产品基线只注明目标例外与未开放状态。

剩余三批为：设计及必要写保护；四来源直接删除后端/故障测试；正式 UI/最终验证。每批报告后暂停等待用户，只允许一个活动子 agent，不恢复自动化 80；复杂锁/删除/崩溃 Astra/high，其余实现及独立审查 GPT-6.1 Sol/xhigh，最终浏览器 GPT-6.1 Sol/medium。第一批必须处理暂停记录中明确的 catalog 隐含锁、App 媒体与归档 WIP、双向来源代次、必要写入口和真实 drain，不借机新增通用体系。

## 验证环境、结果与限制

样本为文档、Mermaid 图源和纯前端示例原型，无数据库连接或真实媒体操作。仅运行文档相关格式/链接/图生成与语法检查；功能测试、build、性能与正式浏览器验收由相应批次完成。本轮未提交，不修改主工作区、暂存区或用户服务。

- `pnpm docs:check`：通过，250 份 Markdown 的本地链接、锚点、路径大小写与围栏有效。
- 默认 `pnpm docs:diagrams`：因 Playwright 默认 Chromium 缓存缺失失败；未下载浏览器。
- `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams`：使用本机已安装 Chrome，成功生成 33 图并解析 23 个内嵌 Mermaid 块。
- `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`：通过，33 图源及 23 内嵌块。
- 仅保留本批五张去重 SVG。全量生成额外重写 13 张开工时干净的 SVG，源哈希未变；直接覆盖恢复首次被自动审批阻止。已先将全部 13 个当前文件及 SHA-256 备份到 `/tmp/dedup-docs-svg-backup-yljqg93e/manifest.json`，核对无并发变化后恢复本轮无关生成差异，备份仍可取回。
- 成图检查发现 lifecycle 默认 HTML label 产生非法 SVG；补回 `htmlLabels: false` 并仅重生该图。五张去重 SVG 的 XML 全部有效，四张维护图可解码且已打开缩略图核对无裁切；图示证据 `/tmp/dedup-direct-delete-diagrams.png`。源哈希检查在修正后再次通过。
- 原型 inline JavaScript 的 `node --check`：通过；impeccable mechanical detector：空结果。此结果不是正式 UI 浏览器或功能验收。
- `git diff --check`：通过；主应用大写路径检查无匹配。

文档侧无未解决阻塞。新直接删除、第一批写保护其余实现/审查及最终 UI 均未由本轮文档检查证明完成。
