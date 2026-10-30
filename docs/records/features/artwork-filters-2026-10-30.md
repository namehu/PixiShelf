---
status: historical
scope: 增强作品筛选、艺术家独立预设与沉浸固定范围的本地验收
date: 2026-10-30
baseline: 478f9d75
sources:
  - packages/pixishelf/schemas/__tests__/artwork-filter.test.ts
  - packages/pixishelf/tests/integration/artwork-favorites.postgres.test.ts
  - packages/pixishelf/tests/integration/artwork-quick-filter.postgres.test.ts
  - packages/pixishelf/app/artists/[id]/_components/__tests__/detail-filters.test.tsx
  - packages/pixishelf/app/viewer/__tests__/viewer-filters.test.tsx
---

# 增强作品筛选验收

本记录对应 2026-10-30 本地工作区，未部署。当前规则分别维护在[搜索与喜欢](../../features/artwork-search-and-favorites.md)、[快捷筛选](../../features/artwork-quick-filters.md)、[评分](../../features/artwork-rating.md)及[账户接口边界](../../security/access-control.md)，此处仅记录验证证据。

## 环境与恢复依据

使用新建的 `postgres:16-alpine` 临时容器，仅绑定 `127.0.0.1:55434`，没有挂载既有数据库目录。空库 `favorites_verification` 应用仓库现有完整迁移，再克隆空结构到 `pixishelf_quick_filter_test`。未新增数据库迁移、未使用 `db:push`、未读取或修改业务数据库。事务测试按随机前缀创建并清理账户和作品。

浏览器使用独立源码副本、5438 端口、合成作品、临时账户及只读挂载合成媒体的临时 ImgProxy。既有开发服务和业务媒体保持不变。恢复依据是测试环境从空库生成且无业务状态，已停止本任务开发进程并删除两个临时容器；不需要恢复生产备份。

## 自动验证

- 查询与预设的隔离 PostgreSQL 套件：2 个文件、13 个测试通过。覆盖精确单档／多档／全部／不限评分、一般与未评分、账户隔离；单／多作者排除、合作作品、包含与排除冲突；普通／随机续页、条件变更拒绝旧游标；账户、A、B、全局之间的预设隔离、独立名称／容量、跨作用域 CRUD 拒绝、导航限制、版本冲突和失效排除引用。
- 组件与边界回归覆盖新字段 URL 往返、旧链接与旧预设、显式空等级优先、搜索及标签建议、艺术家清除和预设不能替换固定作者、排除自身提示、跨艺术家草稿／编辑／迟到响应隔离、沉浸清空范围及全局偏好隔离、相同条件重新应用后获取新候选。
- `pnpm lint`、`pnpm typecheck`：通过，lint 零警告、零错误。
- 主应用全量测试：`pnpm run test:unit --maxWorkers=2` 通过，476 个测试文件通过、49 个按原有环境条件跳过；3512 项通过、351 项跳过。该命令执行 `pnpm test` 同一完整单元套件，仅限制并发。
- 提升权限 `pnpm build`：最终代码构建通过。
- `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`：通过。图示检查使用已安装 Chrome，因为默认 Playwright headless 缓存不可用。
- 主应用路径大小写检查和 `git diff --check`：通过。

首次沙箱全量运行中的网络／IPC 用例受监听权限限制；提升权限后这些用例通过。一次默认并发运行中既有归档批量选择用例超过 5 秒，聚焦复核通过，最终限制为 2 个 worker。新增艺术家清除测试改为等待 Nuqs 的 URL 提交完成再执行下一步，保持全部业务断言，未提高超时或跳过失败用例。

## 浏览器与独立复核

通过 CUA 在本机应用使用 `entry=direct` 验证桌面 1280×900 与移动 390×844：

1. 全局列表选择喜欢和夯爆了并排除 B，应用前保持草稿，应用后只显示对应两件合成作品；刷新保持已选条件。
2. 艺术家 A 面板提供固定范围和完整条件。移动端保存「A 的超爱作品」时没有导航选项，保存后原列表未自动改变；手动点击预设后仅显示超爱作品。
3. 排除当前 A 正常应用，显示明确原因；进入沉浸继承该空结果。清空沉浸条件后 URL 和面板仍固定 A，等级与排除条件清空；通过返回按钮回到详情的原条件 URL。
4. 独立 Impeccable 审查使用通用新代理替代当前环境未注册的专用角色；检测报告无发现。首轮唯一 material fix 为重复 `ariaLabel`，修正后 lint／typecheck 通过并重新捕获桌面和移动画面，verdict 为 `ship`，该 verdict 的范围仅为该修复项。独立文档代理核对既有 shadcn、SSheet、主题 token 与领域文档，结论 `No changes`，没有创建或改写设计系统文档。

| 证据 | 内容 |
| --- | --- |
| [桌面筛选](../evidence/artwork-filters-2026-10-30/desktop.png) | 两档选中、全局条件与真实合成作品结果 |
| [移动筛选](../evidence/artwork-filters-2026-10-30/mobile.png) | 艺术家面板、等级选择、固定操作区 |
| [艺术家预设](../evidence/artwork-filters-2026-10-30/mobile-presets.png) | 专属预设列表，无导航管理 |
| [固定范围与排除](../evidence/artwork-filters-2026-10-30/mobile-scope.png) | 当前艺术家不可替换，允许排除自身 |
| [空结果原因](../evidence/artwork-filters-2026-10-30/mobile-empty.png) | 当前艺术家被排除的提示与清空入口 |

## 限制

移动验证使用桌面浏览器的响应式视口，不等同于实体手机。无站内历史返回与全局沉浸可切换作者由组件回归覆盖；本次真实浏览器重点验证艺术家来源的清空及正常返回。未进行生产部署或生产数据验收。此前搜索与喜欢的验收见[历史记录](./artwork-search-and-favorites.md)。
