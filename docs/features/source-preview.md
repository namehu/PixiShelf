---
status: current
scope: 站内原站图片预览退役与保留的受保护原站导航
last-verified: 2026-10-19
sources:
  - packages/pixishelf/services/artwork/source-links.ts
  - packages/pixishelf/services/archive/archive-task-source-service.ts
  - packages/pixishelf/app/api/artworks/[id]/sources/[source-id]/route.ts
  - packages/pixishelf/app/api/archive/tasks/[id]/source/route.ts
  - packages/pixishelf-job-executors/src/archive/providers/e-hentai.ts
---

# 原站图片预览退役

站内远程阅读器已退役。作品详情仅浏览本地媒体；添加链接、收件项目、归档任务、发现结果和回收站不再提供站内原站预览。`/source-preview`、`/api/archive/preview/[id]/source` 和 `archivePreview` tRPC router 已删除，旧地址依然先经过既有认证门禁：匿名 API 请求返回 401，匿名页面访问跳转登录；通过认证后的旧地址及调用按框架常规返回 404，不提供兼容读取或重定向。

预览专用的服务、进程内会话、页/展示图缓存、共享请求合并、Provider `previewPage/previewImage` 契约、专用 governor 包装和 E-Hentai 缩略图 HTML/sprite 解析已删除。站内不再为在线阅读抓取远端列表页或图片页。发现列表的首图与卡片封面继续使用归档/扫描 metadata 的 `thumb` 字段，不依赖已经移除的预览类型或解析逻辑。

## 保留的原站入口

添加链接弹窗只在输入单个有效来源 URL 时显示“打开原站”，无效输入或多条链接不显示；点击仅打开新标签页，不提交收件表单、不关闭弹窗。收件项目的“打开原站”使用已验证的提交地址，无效地址显示禁用按钮；回收站有来源任务 ID 时保留“打开原站”，缺少任务 ID 时禁用；任务地址无效时由受保护跳转 Route 拒绝。所有原站外链统一使用 `target="_blank"`、`rel="noopener noreferrer"` 和 `referrerPolicy="no-referrer"`。

作品详情在存在有效 E-Hentai 来源引用时，逐条显示 `E-Hentai #GID`，新标签页进入原站。服务端查询 `ArtworkExternalRef`，要求关联作品 `deletedAt: null` 且 `archiveLifecycleState: ACTIVE`，只向页面提供 `{ id, label, href }`；`href` 是同源 `/api/artworks/[id]/sources/[source-id]`，不序列化 canonical URL 或 token。

跳转 Route 在每次导航时独立验证 Better Auth Session，重读引用并检查作品归属、未删除和活动生命周期。来源使用现有 `archiveTaskSourceUrl` 严格验证 provider、HTTPS、精确主机、端口、凭据、画廊路径与 GID，再生成去除 query/hash 的规范画廊 URL。合法请求返回 302，所有响应均设置 `Cache-Control: private, no-store` 与 `Referrer-Policy: no-referrer`。路径 ID 非法、缺失/失效引用、数据库或 Session 异常均返回通用错误，不回显或记录敏感 locator；客户端 query 中的 URL 不参与目的地计算。整个过程不访问远端。

归档任务继续使用 `/api/archive/tasks/[id]/source`，发现封面和标题继续使用受保护的目录来源跳转，在新标签打开数据库中已验证的原站地址；无封面或封面加载失败仍可导航，有效目录缺失时不推测地址。收件、下载、扫描、归档发布、阅读记录、隐私模式和本地媒体播放的领域行为不因本次退役改变。

## 数据与恢复边界

本次是代码与产品入口退役，无数据库迁移、数据清理或媒体写入，也不修改任务、部署、代理、安全 HTTP、Provider governor、配额或 lease。归档下载和来源扫描继续使用现有 Provider、代理与配额。

数据库旧 `ArchivePreviewSession` 属于独立的历史冻结预览流程，与此次删除的进程内在线阅读会话没有生命周期关系。本次保留该表、旧归档服务遗留类型、维护阶段及 `deletedPreviewSessions` 清理统计；既有保留任务继续按原规则清理旧记录，不据此声称在线阅读仍可用。

恢复依据是本次发布前的代码/应用镜像版本。回退相应 App 与共享执行器代码即可恢复旧产品入口，无需数据库逆迁移或媒体恢复；旧进程内会话本就不保证跨进程恢复，回退后需重新打开。未来若清理历史表和遗留契约，应单独评审迁移与恢复方案。

## 验证边界

聚焦测试覆盖 Session 门禁、非法 ID、引用归属、删除/生命周期失效、provider/GID/URL 不匹配、数据库异常、规范跳转、私有响应头和无敏感 URL 的页面 DTO。Provider 与 governor 的归档解析、来源扫描和下载回归保留；不访问真实原站。完整发布验证以测试策略和交付记录为准。
