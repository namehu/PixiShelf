---
status: historical
scope: 同艺术家去重当前入口、六张图及历史导航的文档整理与验证
last-verified: 2026-10-28
sources:
  - docs/features/artwork-deduplication.md
  - docs/diagrams/features/artwork-deduplication/business-flow.mmd
  - docs/diagrams/features/artwork-deduplication/architecture.mmd
  - docs/diagrams/features/artwork-deduplication/detection.mmd
  - docs/diagrams/features/artwork-deduplication/processing-limits.mmd
  - docs/diagrams/features/artwork-deduplication/lifecycle.mmd
  - docs/diagrams/features/artwork-deduplication/recovery.mmd
---

# 去重当前文档与图示整理

日期：2026-10-28。基线提交 `2ad7b40a6fab28ecadc1aba4448c179665c6919f`，分支 `codex/dedup-scale-validation-f03`，工作目录 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`。本轮仅整理文档和图；未进入下一批功能开发，未修改主目录、数据库、服务或部署配置。

## 交付

以[当前功能规格](../features/artwork-deduplication.md)作为唯一详细阅读入口，依次解释当前范围、用户流程、四类关系、系统职责、三层缓存、处理上限、删除及故障续行。首屏分别标明已实现、待完成和取消的范围，详细契约与历史验收从正文跳转。

重写原五张图并新增一张，共六张 Mermaid／SVG：

| 图                                                                           | 回答的问题                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [业务流程](../diagrams/features/artwork-deduplication/business-flow.svg)     | 怎样从同艺术家检查走到人工选择、确认删除和删除记录？          |
| [架构](../diagrams/features/artwork-deduplication/architecture.svg)          | App、数据库、三条 Worker 通道、受控子进程和媒体目录各做什么？ |
| [检测与缓存](../diagrams/features/artwork-deduplication/detection.svg)       | 文件 SHA、视觉特征、兼容作品关系如何复用？                    |
| [处理上限](../diagrams/features/artwork-deduplication/processing-limits.svg) | 正常让行、暂停／重启和达到硬上限有什么区别？                  |
| [删除状态](../diagrams/features/artwork-deduplication/lifecycle.svg)         | 什么时候可以取消，什么时候只能停止或续行？                    |
| [故障续行](../diagrams/features/artwork-deduplication/recovery.svg)          | 删除意图、文件动作和回执之间中断后如何核对现场？              |

修正 docs、features、design、diagrams 的导航及当前架构、产品基线和去重 runbook 的局部过时摘要。历史总计划保留当时范围，并将当前图引回功能入口；旧节点与测试对应关系明确使用提交 `5dec7b58` 的历史图源。未将历史验收重写为今天的生产证明。

## 事实复核

正文及图源由 GPT-6.1 Sol / xhigh 整理，主线程核对相关契约、执行器和数据库边界，并检查成图。重点澄清：

- 当前四类关系和直接删除已实现；不再把直接删除写成待开放目标，不恢复已取消的隔离流程。
- 普通时间片让行、暂停及正常 Worker 重启已有续跑能力；硬上限耗尽后继续完成仍未实现。
- 硬上限中止视觉阶段时，不发布本轮截断视觉结果；局部作品不支持视觉时，其他完整合格作品对仍可发布。整次环境失败另行处理，不能统称为完整成功。
- 首个删除意图前取消，经安全核验可解除占用、恢复已隐藏副本可见；开始删除后的停止不撤销已删文件。
- 10 万预制特征测试不覆盖原图读取／解码、真实 NAS 或 50 万当前算法完整吞吐。代码实现、隔离验收、镜像发布和 NAS 部署分开陈述。

## 验证

验证环境为本机独立 worktree、现有 Mermaid 渲染脚本及已安装 Chrome；没有连接应用或数据库。

| 检查 | 结果 |
| --- | --- |
| `pnpm docs:check` | 通过：304 份 Markdown 的本地链接、锚点、路径大小写及代码围栏 |
| `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams` | 生成成功：34 个独立图源，解析 23 个内嵌 Mermaid 块 |
| `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` | 通过：34 个图源与 SVG 源哈希一致，23 个内嵌图语法有效 |
| 六张成图截图复核 | 已逐张查看：业务、架构、缓存、处理上限、删除状态和故障续行；修复首轮架构标题遮挡及过密换行 |
| `git diff --check`、主应用路径大小写扫描 | 通过；无主应用文件变更 |

六张实际 SVG 的本地 PNG 预览及尺寸记录保存在 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-docs-overview-20261028/`。随仓库保留的交付为上表 SVG 及同名 `.mmd` 图源。首轮架构图存在标题遮挡，已简化分组并重新生成；额外生成的其他主题 SVG 无源变更，已移除这些无关渲染差异。

## 限制与下一步

未运行应用 lint、test、build 或性能测量，本轮不新增运行时验收结论。主目录继续留给其他功能；本轮整理完成后停在文档交付，F03 剩余实现和规模测试须按后续安排推进。
