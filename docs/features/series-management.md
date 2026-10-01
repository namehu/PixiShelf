---
status: current
scope: 系列列表、作品抽屉、成员草稿、虚拟排序及原子保存契约
last-verified: 2026-10-01
sources:
  - packages/pixishelf/app/admin/series/
  - packages/pixishelf/services/series-management-service.ts
  - packages/pixishelf/server/routers/series.ts
  - packages/pixishelf/tests/integration/series-management.postgres.test.ts
---

# 系列管理

系列管理主页面使用全宽系列列表，展示封面、名称、描述、来源、核对状态与作品数。Series 与 Artwork 是多对多成员关系，不新增子系列。列表支持标题搜索、来源与核对状态筛选和每页 20 个系列；点击系列打开右侧作品抽屉，桌面抽屉最大约 920px，手机使用全屏抽屉。关闭后保留列表筛选、页码和位置，并恢复到原系列的键盘焦点。地址更新为 `/admin/series/[id]`，直接打开旧详情链接同样打开作品抽屉。

## 整理与草稿

作品行使用约 80px 高度，展示序号、标题、作者、媒体数量和关系来源；作品列表、拖拽浮层与添加面板不展示作品图片。管理端一次加载轻量成员，不读取每件作品的完整媒体列表；TanStack Virtual 只挂载可见行及 overscan，dnd-kit 提供桌面手柄拖拽、DragOverlay 和边缘自动滚动。移动端使用指定序号、置顶及置底完成排序。序号从 1 起。

增删与排序统一进入页面内草稿，最多保留 50 步撤销/重做。添加面板支持作者筛选、搜索和跨页多选。系列内全选作用于全部当前筛选结果，包括尚未挂载的行；筛选期间暂停排序，清空筛选后恢复。保存前移除可以撤销，不修改数据库。

普通新作品默认追加末尾；已排除来源关系恢复原位置及来源归属。已有排序草稿时，添加作品的位置以页面显示的最终顺序为准。关闭作品抽屉、切换系列、站内导航、浏览器后退与刷新均保护未保存草稿。作品列表独立滚动，保存栏固定在抽屉底部。草稿不跨刷新保存；保存成功后撤销历史清空。系列资料独立通过编辑弹窗保存。

## 接口与提交

`getManagementDetail(seriesId)` 和 `saveManagementChanges` 使用 `authProcedure`。普通系列详情 `get` 保持原 DTO；`list/get` 的传输层 Session 边界不变。

管理查询在 RepeatableRead 事务中返回系列摘要、轻量活跃成员、可恢复成员位置、最大存储顺序与 SHA-256 成员指纹。指纹包含 seriesId、全部成员（含排除和软删除）的作品 ID、存储/来源顺序、排序覆盖、排除时间、归属、来源引用及作品软删除状态，按作品 ID 规范排序。标题、描述和封面编辑不产生成员冲突。

统一提交 `{ seriesId, expectedFingerprint, finalArtworkIds, explicitReorder }`，最终数组完整、去重、可为空。服务端从最终集合推断增删和恢复：

- SOURCE 移除写入 `excludedAt`；MANUAL/LEGACY 移除删除关系，作品始终保留。
- 已排除成员只清除排除标记，保留来源和排序覆盖；新成员按选择顺序追加为 MANUAL。
- `explicitReorder=false` 保留存储顺序，校验最终数组符合原位恢复与末尾追加后的自然顺序。
- `explicitReorder=true` 在增删之后按数组写入连续序号，并设置全体活跃成员 `orderOverridden=true`，沿用人工重排语义。仅增删不会冻结来源排序。

保存采用 ReadCommitted 事务：将当前全部关联作品与最终候选作品的并集按 ID 升序取得 Artwork `FOR NO KEY UPDATE`，再取得 Series `FOR UPDATE` 与成员行锁；重新读取指纹后校验并写入。Artwork 非键锁允许维护任务的外键检查，同时阻挡 Pixiv 发布的 Artwork 更新锁。Series 更新锁阻挡并发新关系的外键 KEY SHARE。排序通过参数化批量 UPDATE 写入并核对影响行数。

旧单项增删复用同一锁策略。旧 `reorderArtworks` 必须提供指纹和完整现有成员集合，不能作为无冲突保护的排序旁路。死锁或锁超时最多重试 3 次，每次仍比较原指纹；指纹变化返回 CONFLICT，校验失败返回 BAD_REQUEST，系列不存在返回 NOT_FOUND。任何失败都整笔回滚；客户端保留草稿，不自动合并或覆盖。

普通 Pixiv 核对保留本地排序；显式刷新仍按现有观察值保护规则尝试采用来源顺序。保存不是永久的“全系列本地模式”，后续新来源成员仍遵循来源同步规则。

## 验证与恢复

单测覆盖输入、轻量查询、来源排除/恢复、参数化批量更新、草稿历史和绝对位置。组件测试使用真实虚拟器验证 2,000 成员在 640px 视口下挂载少于 30 行，以及深层滚动、筛选禁排序、全部筛选结果选择、跨页添加、离开保护和失败保留。

隔离 PostgreSQL 测试使用 `SERIES_VALIDATION_DATABASE_URL`，只接受本机 `series_management_validation_*` 库，覆盖 2,000 成员读写、同基线并发提交、旧入口追加、软删除、故障注入回滚、实际 Pixiv 领域核对与维护锁交错。不能指向收藏库。

2026-10-01 验收记录：主应用 lint、TypeScript 检查、提权生产构建通过；全量测试 2,256 项通过、132 项按既有配置跳过，隔离 PostgreSQL 另行执行的 8 项全部通过。列表与抽屉改版使用 `pnpm run test:unit --maxWorkers=4` 完成相同的全量单测集合；默认并发运行曾出现实时事件断言与 5 秒超时，定向及降低并发的全量复测通过，未修改超时阈值。2,000 件浏览器 fixture 验证虚拟列表、键盘跨挂载范围排序、鼠标拖拽、首尾及指定位置移动、提交、撤销、筛选禁排序、系列列表第二页、关闭和切换保护和隐私遮罩；390/1024/1280/1440px 检查保存栏、作品抽屉和横向溢出。fixture 与临时账号仅存在于隔离验收库，未修改收藏库。

浏览器验收限制：工具没有持续按住鼠标的操作，长时间连续边缘自动滚动仍需人工复验；当前应用没有主题切换入口，深色样式继承已有语义 token，但没有强制深色的浏览器验收结果。不要将这两项标记为已验证。

发布前按[备份与恢复基线](../operations/backup-and-recovery.md)保留数据库检查点及版本、成员和顺序核验依据。本次无 Schema migration、无 Worker 改动、无媒体写入。保存前使用撤销/放弃恢复；保存后的手工归属可重新添加，SOURCE 排除可显式恢复，完整恢复旧顺序及 LEGACY 关系语义应依据保存前快照或数据库备份。代码回退不会撤销已经保存的成员变化。
