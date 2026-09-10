---
status: current
scope: 已归档来源与单个未归档链接的在线缩略图浏览、入口、会话与安全边界
last-verified: 2026-09-10
sources:
  - packages/pixishelf/services/archive-preview/
  - packages/pixishelf/server/routers/archive-preview.ts
  - packages/pixishelf/app/api/archive/preview/
  - packages/pixishelf/components/source-preview/
  - packages/pixishelf-job-executors/src/archive/providers/e-hentai.ts
---

# 原站缩略图预览

原站预览让已登录账户在线浏览受支持来源的画廊缩略图。它是纯浏览能力：不会创建收件项目或后台任务，不会执行完整归档解析、下载原图、写入媒体目录，也不会修改作品和发现目录。共享 Provider governor 仍会在 PostgreSQL 更新既有的节流状态和短期请求 lease；这些协调记录不代表加入收藏或归档。

## 用户入口

- 作品详情仅在存在有效、处于活动生命周期的来源引用时显示“本地图片 / 原站预览”页签。本地图片默认显示；单来源自动打开，多来源每次进入页签重新选择 `#GID`。
- 归档任务以“原站预览”为主操作；原有完整来源跳转保留在更多菜单。
- 收件项目在冻结身份有效，或尚未解析但提交链接可由本地规则识别时显示预览；可用性计算不请求远端。
- 发现结果提供与已有首图弹窗相互独立的预览操作。
- 添加链接弹窗仅在输入一个可识别链接时显示“仅预览”；该操作不提交收件表单。
- 独立页面的地址只携带随机预览 ID，不携带原站 URL、GID 或 token。

隐私模式继续遮蔽预览标题和图片。作品详情切换到原站页签时，本地媒体列表卸载，并暂停本地自动浏览；返回本地页签后重新建立本地浏览运行时。

## 浏览行为

普通页面按单列显示较小的来源缩略图；点击后进入纵向全屏浏览，关闭全屏会回到刚才的活动缩略图。自动滚动和全屏轮播都必须由用户手动启动；到分页边界时先等待下一页，载入后继续，图片或分页失败时暂停并由用户选择重试。每次从业务入口进入都会创建新会话并从第一页开始，多来源作品也不会沿用上次选择。

缩略图片由浏览器使用 `Referrer-Policy: no-referrer` 直接向已验证的图片主机加载，App 服务器不代理图片内容。服务器只取得并解析画廊列表 HTML；图片页 `/s` 入口仅允许一次既有身份查询以恢复该链接指向的精确画廊，随后读取缩略图列表，不访问 `/s` 大图、单张原图页或完整解析链路，也不跟随原站的更新版本。

## 服务契约

`archivePreview` 的 `sources`、`open`、`page` 和 `reload` 均使用 `authProcedure`：

- `sources({ artworkId })` 只返回有效引用 ID、provider key 和安全标签，不返回 canonical URL 或 token；
- `open({ source })` 接受作品引用、任务、收件项目、发现目录项目，或 mutation body 中的单个 URL，创建绑定当前账户的随机不透明会话，并返回第一页；
- `page({ previewId, page })` 只允许从零开始的顺序分页；
- `reload({ previewId })` 使该来源的解析页缓存失效并重新加载第一页。

任务和发现目录使用各自冻结的 provider、GID 和 canonical URL；作品引用还要求所属作品未删除且归档生命周期为 `ACTIVE`。服务不读取旧 `Artwork.externalId` 推断归档身份。Provider 返回的 provider、GID 与 canonical URL 必须和服务端预期身份一致，否则整页拒绝。

完整来源地址只通过 `GET /api/archive/preview/[id]/source` 暴露给用户主动导航。Route 在读取会话前再次验证 Better Auth Session，并按当前账户检查会话所有权；响应禁止缓存和发送 Referrer。

## 远端访问与内存边界

预览复用默认 Provider 注册表、PostgreSQL Provider governor 和现有 `RESOLVE` 配额。一次会话最多有一个 HTML 请求在途；不同会话的相同页请求会合并，但 reload 和会话过期不会取消其他会话共享的请求。

进程内会话空闲 30 分钟过期，解析页缓存保留 5 分钟。会话数、缓存页、在途请求、单会话页、全局保留页和缩略图总数都有固定上限；达到上限时按最近使用顺序清理旧会话或旧缓存。进程重启后会话自然失效，客户端需要重新打开。

服务逐页校验 HTTPS 缩略图主机、无凭据/端口/query/hash 的图片地址、尺寸、sprite crop、连续 ordinal、`total`、`nextPage`、标题和跨页连续性。失败响应不进入缓存；已成功加载的页在后续失败时保留。限流只返回有上界的安全重试提示，不向客户端或普通错误日志回显 locator、token 或 canonical URL。

## 当前验证范围

聚焦测试覆盖未授权零 Provider I/O、严格账户所有权、来源生命周期与身份漂移、缩略图清洗、顺序分页、缓存合并和过期、reload 并发、全局内存预算、失败重试、无任务/收件写入，以及隔离 PostgreSQL 上的真实 governor 获取与释放。Provider 解析使用固定 HTML fixture 覆盖普通缩略图、sprite、分页和异常响应。

当前 CI 没有真实浏览器端到端测试，也不会访问真实原站验证站点当日 HTML。Provider 页面结构变化仍需通过隔离 fixture 更新、人工浏览器抽样和安全审查发现；进程内会话不提供重启恢复承诺。
