---
status: current
scope: 当前功能规格的唯一分类目录与阅读分工
last-verified: 2026-10-22
sources:
  - docs/features/
  - docs/product/product-baseline.md
---

# 领域功能目录

先读[产品基线](../product/product-baseline.md)理解边界，再按当前工作选择下面的规格。每篇负责用户行为、业务不变量、失败／恢复与验收条件；精确字段以 Schema 和共享契约为准。实现机制集中在[架构](../architecture/current-architecture.md)，历史测试与生产证据集中在[功能验证记录](../records/features/README.md)。

这里的 `current` 表示已经核对当前实现，不代表已部署到生产。已有开发与生产验收分别记录，不因缺少生产验证把已实现功能写成未来草案。

## 作品与创作者

| 规格                                              | 负责内容                               |
| ------------------------------------------------- | -------------------------------------- |
| [创作者、社团与作品](./creator-relations.md)      | 有效归属、证据、人工抑制与发现绑定     |
| [艺术家合并](./artist-merge.md)                   | 合并预览、原子提交、身份冲突与恢复     |
| [系列管理](./series-management.md)                | 成员草稿、排序、并发保护与保存         |
| [旧身份字段清理](./legacy-identity-retirement.md) | 正式迁移、依赖替换及不可直接回退的边界 |

## 导入与来源

| 规格                                                 | 负责内容                         |
| ---------------------------------------------------- | -------------------------------- |
| [Pixiv 扫描根身份](./pixiv-root-identity.md)         | 稳定 UUID、重挂载与旧库绑定恢复  |
| [Pixiv 作品在线同步](./pixiv-artwork-online-sync.md) | 元数据、标签、系列发布与人工覆盖 |
| [Pixiv 系列来源与核对](./pixiv-series-sync.md)       | 来源身份、成员所有权与连续核对   |
| [Pixiv 艺术家补全](./pixiv-artist-enrichment.md)     | 外部身份、补全任务与作者图片     |
| [Pixiv 标签补全](./pixiv-tag-enrichment.md)          | 候选、空字段补全与封面存储       |
| [Pixiv 导入默认已读](./pixiv-import-reading.md)      | 账户偏好、历史回填与专项恢复     |
| [原站导航与预览退役](./source-preview.md)            | 受保护外链与旧数据保留           |

## 归档与回收

| 规格                                                      | 负责内容                                   |
| --------------------------------------------------------- | ------------------------------------------ |
| [来源发现](./archive-discovery.md)                        | 人工扫描、候选接纳、绑定与来源删除         |
| [标题来源规则与人工复核](./archive-title-rules.md)        | 本地组合规则、全量预览、原子应用与人工决定 |
| [归档收件箱](./archive-intake.md)                         | 持久 URL 解析、下载意图、批量控制与诊断    |
| [归档生命周期](./archive-lifecycle.md)                    | 文件准备、原子数据库发布、维护与保留       |
| [历史归档默认标签补全](./archive-default-tag-backfill.md) | 冻结预览、追加所有权、分批与取消           |
| [归档回收站](./archive-trash.md)                          | 恢复资格、永久清理及持久删除意图           |
| [作品删除与删除总结](./artwork-deletion.md)               | 预览文件范围、逐项结果、失败重试           |

## 浏览与阅读

| 规格                                                    | 负责内容                                   |
| ------------------------------------------------------- | ------------------------------------------ |
| [作品阅读记录与进度](./artwork-reading.md)              | 真实观察、逻辑媒体、手动完成及版本失效     |
| [作品堆叠浏览](./artwork-summary.md)                    | 即时分组、组内翻阅、整组已读与旧摘要兼容   |
| [作品详情自动浏览](./artwork-auto-browse.md)            | 自动滚动、轮播、WebP 协同与暂停            |
| [沉浸浏览](./immersive-viewer-interactions.md)          | 浮层、手势、倍速、筛选记忆与跨作品自动浏览 |
| [作品快捷筛选](./artwork-quick-filters.md)              | 账户预设、导航入口及并发约束               |
| [作品搜索与我的喜欢](./artwork-search-and-favorites.md) | 当前账户喜欢集合、标签原名及译名检索       |
| [作品评分与喜欢](./artwork-rating.md)                   | 五档滑杆、沉浸爱心、个人评分与喜欢阈值     |

## 后台任务

| 规格                                                  | 负责内容                           |
| ----------------------------------------------------- | ---------------------------------- |
| [后台任务执行记录](./background-job-history.md)       | 游标历史、筛选、实时合并与失败确认 |
| [后台任务实时进度](./background-job-live-progress.md) | 持久快照、SSE、降级与事件保留      |
| [后台任务失败诊断](./background-job-diagnostics.md)   | 每次执行的完整证据、过期与恢复     |
| [后台任务兼容层退役](./background-task-retirement.md) | 当前中央执行、v0 历史与约束        |

## 隐私偏好

| 规格                                   | 负责内容                                 |
| -------------------------------------- | ---------------------------------------- |
| [浏览器隐私偏好](./browser-privacy.md) | 首屏遮挡、跨标签同步、固定记忆与生命周期 |

## 图与技术说明

- [核心领域 UML](../../CONTEXT.md#concept-relationships)：本地身份、来源、创作者、系列及账户阅读。
- [归档泳道](./archive-lifecycle.md#从发现到发布)：管理员、App、解析通道、媒体写通道、数据库和文件系统。
- [删除与恢复状态](./archive-trash.md#删除与恢复状态)：回收期限、维护失败与重新归档。
- [来源同步泳道](./pixiv-artwork-online-sync.md#来源同步与人工整理)：来源更新、人工保护与发布报告。
- [阅读架构](../architecture/reading.md)与[WebP 播放器](../architecture/webp-player.md)：阅读协议、分页、播放器状态和资源生命周期。

更新功能时修改对应章节；发布记录与测试结果写入 records，再从规格引用。跨域规则只维护在其负责文档内，避免在本目录重复参数或发布状态。
