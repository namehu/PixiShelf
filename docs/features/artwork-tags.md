---
status: current
scope: 作品详情的标签草稿编辑、关联所有权与保存边界
last-verified: 2026-11-03
sources:
  - packages/pixishelf/app/artworks/[id]/_components/tag-area.tsx
  - packages/pixishelf/app/artworks/[id]/_components/tag-edit-dialog.tsx
  - packages/pixishelf/schemas/artwork-tags.dto.ts
  - packages/pixishelf/services/artwork-service/tags.ts
  - packages/pixishelf/server/routers/artwork.ts
  - packages/pixishelf-db/prisma/schema.prisma
---

# 作品详情标签整理

本文负责作品详情页的标签添加、移除与新建。来源同步的更新范围见[Pixiv 作品在线同步](./pixiv-artwork-online-sync.md)，统一身份与管理权限见[权限边界](../security/access-control.md)。标签是实例共享的作品整理数据，不按账户分别保存。

## 详情与草稿

详情标签继续使用可跳转到标签页的 pill 链接，在末尾显示轻量“编辑”入口；无标签时显示“添加标签”。普通阅读直接使用作品详情已提供的标签，不增加查询。编辑入口及弹窗操作支持触屏与键盘。

弹窗以当前标签为草稿，支持按名称或译名搜索已有标签并加入，也支持明确选择“创建并加入”。新标签只填名称，标记为“待创建”，保存时才创建，使用默认 `general` 分类。名称去首尾空白，同一名称按精确大小写匹配；名称相同但分类不同不合并。

已有标签和待创建标签都能从草稿移除，草稿没有变化时禁用保存。取消、Escape 或保存前关闭弹窗均不写入标签或作品关联。保存期间禁用编辑和关闭操作，避免重复提交；失败保留草稿，展示可公开的业务原因并允许重试或取消。成功使用接口返回的标签更新当前区域，相关查询标记过期，不刷新整页或重建阅读媒体状态。

弹窗适应可视视口高度，标签和搜索内容滚动，取消／保存按钮保持可见。打开编辑会暂停自动浏览，并用独立 `tag-edit` 来源阻止阅读交互；关闭或卸载只解除自身阻止。标签名称与译名的只读展示复用[浏览器隐私偏好](./browser-privacy.md)，输入框保留正常编辑能力。

## 保存与所有权

`artwork.updateTags` 使用管理 mutation，提交作品 ID、增加的标签 ID、移除的标签 ID 和待创建名称，返回保存后的详情标签 DTO。输入在 tRPC 边界统一校验：有效正整数 ID、去空白后非空名称、去重及禁止同一 ID 同时增删。

保存使用一个 Prisma 事务，沿用创作者目录锁 → 作品结构写入门禁的锁序，并复核作品仍未删除且处于 `ACTIVE`。增加的已有标签必须仍存在。待创建名称按精确 `general/name` upsert；若其解析到同次明确移除的标签，整次保存拒绝。任何步骤失败均回滚，不能留下本次新建的孤立标签。

移除只删除本作品明确提交的标签关联，不删除标签本体、不影响其他作品。用户可移除来源或自动产生的标签；新增关联为 `MANUAL`，重复关联跳过，未改动的 `SOURCE`／`DERIVED` 等关联保留原有所有权和来源引用。标签计数继续由既有数据库 trigger 维护。后台作品编辑的旧 `updateArtwork(tags)` 仍只替换 `MANUAL/LEGACY`，与详情的显式关联增删分别使用各自契约。

移除自动标签不代表永久排除。界面固定说明：“扫描、来源同步或媒体更新后，自动标签可能重新出现。”本功能不新增排除设置、数据库迁移或 Worker 行为，也不提供标签改名、翻译编辑或全局删除。

## 验收条件

- 有标签仍可导航，零标签能进入编辑；普通阅读和仅打开弹窗不搜索标签。
- 搜索选择和新名称只进入草稿；取消不写入，恢复原集合后不能保存。
- 保存返回值立即呈现；失败保留草稿，自动浏览保持暂停，其他浮层的阅读阻止不被误解除。
- 精确名称复用已有 general 标签，添加不改写已有来源关联，移除不按 provenance 限制，也不删除标签本体。
- 非活动作品、缺失的添加 ID 或事务内故障均不能留下部分关联和本次新建标签；未认证请求在服务写入前拒绝。
- 深浅主题、长名称、移动端受限视口、键盘选择与焦点返回及隐私模式分别验证；组件模拟不替代真实浏览器验收。

代码与回归入口：

- [输入校验](../../packages/pixishelf/schemas/__tests__/artwork-tags.dto.test.ts)、[标签服务](../../packages/pixishelf/services/artwork-service/__tests__/tags.test.ts)。
- [详情组件](../../packages/pixishelf/app/artworks/[id]/_components/__tests__/tag-area.test.tsx)、[接口鉴权](../../packages/pixishelf/server/routers/__tests__/artwork-tags-auth.test.ts)。
- [真实 PostgreSQL 事务](../../packages/pixishelf/tests/integration/artwork-tags.postgres.test.ts)：仅接受其声明的隔离测试库，验证所有权、计数与故障回滚。
