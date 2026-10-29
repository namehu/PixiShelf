---
status: historical
scope: 已有功能验证、发布与恢复证据的索引
last-verified: 2026-10-22
sources:
  - docs/records/features/
---

# 功能验证与发布记录

这里保存有日期和环境边界的既有证据。移入本目录不代表本轮重新测试或部署；没有提交号的结果只对应原记录当时工作区。当前规则从[功能目录](../../features/README.md)进入，不能用历史测试数量证明当前版本已通过。

| 记录                                                                 | 内容                                         |
| -------------------------------------------------------------------- | -------------------------------------------- |
| [Android 核心阅读页面迁移](./android-core-parity-2026-10-28.md)      | 详情／沉浸对齐、原生往返与阅读语义验证       |
| [三项归档功能集成验证](./archive-features-integration-2026-10-29.md) | 独立审查关闭、跨功能范围、迁移重放与最终检查 |
| [部分归档隔离验证](./archive-partial-coverage-2026-10-29.md)         | 独立环境、空库初始化与尚待完成的验收         |
| [归档收件验证记录](./archive-intake.md)                              | 批量收件、锁等待与失败记录删除的隔离验证     |
| [标题来源精准匹配与人工复核验证与发布记录](./archive-title-rules.md) | 标题规则、复核、绑定清理与浏览器覆盖限制     |
| [作品详情页自动浏览验证与发布记录](./artwork-auto-browse.md)         | 自动滚动、轮播、预加载及 WebP 协同测试       |
| [作品删除与删除总结验证与发布记录](./artwork-deletion.md)            | 删除事务回滚与部分文件失败重试               |
| [作品快捷筛选验证与发布记录](./artwork-quick-filters.md)             | 快捷预设事务、导航与 Android 手势覆盖        |
| [作品搜索与我的喜欢验证记录](./artwork-search-and-favorites.md)      | 喜欢账户隔离、分页、标签译名检索与浏览器验证 |
| [作品评分与喜欢合并验证记录](./artwork-rating.md)                    | 历史喜欢迁移、评分阈值、计数及两入口联动     |
| [单图书签与喜欢验证记录](./media-marks.md)                           | 独立媒体标记、失效保留、精确定位与手机回归   |
| [作品阅读记录与进度验证与发布记录](./artwork-reading.md)             | 阅读初始实现、手动进度、视频、分页及反馈验证 |
| [作品堆叠浏览验证与发布记录](./artwork-summary.md)                   | 堆叠分组、记读、旧请求兼容与视觉验证限制     |
| [后台任务失败诊断验证与发布记录](./background-job-diagnostics.md)    | 执行证据、正常让行与归档恢复的分阶段验证     |
| [后台任务执行历史验证记录](./background-job-history.md)              | 历史分页与批量失败确认的隔离数据库验证       |
| [后台任务实时进度验证与发布记录](./background-job-live-progress.md)  | 混合动图探测吞吐、进度与 SSE 恢复验证        |
| [浏览器隐私偏好验证与发布记录](./browser-privacy.md)                 | 跨标签、记忆、URL 入口与浏览器生命周期验证   |
| [沉浸浏览交互验证与发布记录](./immersive-viewer-interactions.md)     | 手势、进度、倍速、自动浏览及设备覆盖限制     |
| [旧身份字段清理验证记录](./legacy-identity-retirement.md)            | 旧字段迁移验证及证据尚不完整的生产完成声明   |
| [Pixiv 导入默认已读验证与发布记录](./pixiv-import-reading.md)        | 生产版本、历史回填、最终核验与专项恢复材料   |
| [Pixiv 扫描根身份验证与发布记录](./pixiv-root-identity.md)           | 扫描根首次升级、标记绑定与恢复验证           |
| [系列管理验证与发布记录](./series-management.md)                     | 原子成员编辑、并发、虚拟排序及浏览器验证     |
| [创作者关系验证记录](./creator-relations.md)                         | 关系、来源证据、维护任务与浏览器验证         |

[Android 验证版 2026-10-28](./android-app-2026-10-28.md)：独立工作区、Flutter 与原网页回归、模拟器及未覆盖项。

- [Android 图库与作品内选图验证（2026-10-28）](./android-gallery-2026-10-28.md)
- [Android 图片加载与崩溃修复（2026-10-28）](./android-media-loading-2026-10-28.md)
