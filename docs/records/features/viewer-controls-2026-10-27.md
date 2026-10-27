---
status: historical
scope: 作品全局预览工具栏、标记预取、200ms 停留与沉浸作品评分的本地验证
last-verified: 2026-10-27
sources:
  - packages/pixishelf/components/media-mark/media-mark-actions.tsx
  - packages/pixishelf/hooks/use-media-mark.ts
  - packages/pixishelf/app/viewer/_components/viewer-rating-dialog.tsx
---

# 预览与作品评分验证（2026-10-27）

适用本次 UI 补丁，发布目标为 `v0.54.12`。当前规则见[媒体标记](../../features/media-marks.md)、[详情自动浏览](../../features/artwork-auto-browse.md)、[作品评分](../../features/artwork-rating.md)与[沉浸交互](../../features/immersive-viewer-interactions.md)。本记录只证明本地验证，不推定镜像发布或生产部署成功。

## 环境与样本

macOS、Node.js 20.19.4、pnpm、Chrome、本地主应用开发环境。浏览器入口附加 `entry=direct`，使用已有登录账户；多图验证使用 F02 合成作品，评分验证使用现有活动作品。桌面及 375×812 视口覆盖工具栏和评分入口。测试完成后恢复原有评分和 1.5 秒轮播偏好，恢复浏览器视口。

本次无数据库 schema、migration、服务端 API 或部署配置改动。本机已有 Prisma Client 落后于仓库 schema，按 `pnpm --filter @pixishelf/db db:generate` 重新生成；未对数据库执行迁移或 `db:push`。

## 结果

- 全量 `pnpm test -- --maxWorkers=4`：455 个测试文件通过、48 个跳过；3321 项通过、326 项跳过。跳过项主要需要显式隔离 PostgreSQL/fixture 条件，不计入已通过。
- 主应用 `pnpm lint`、`pnpm typecheck`、提升权限的 `pnpm build` 均通过。
- `pnpm docs:check` 通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过，校验 33 个图源及 23 个内嵌 Mermaid 块。默认 Playwright headless shell 未安装，使用脚本已有 Chrome 通道选项完成检查。
- 主应用路径大小写检查、`git diff --check` 通过；Impeccable 定向检测无发现。
- 聚焦测试覆盖稳定按钮节点、切图未知状态、预取批量与缓存命中、保存竞争、媒体与账户迟到响应、200ms 完整停留和暂停取消、长按取消条件、全部评分档位转换、失败同档重试、Escape 与焦点恢复。
- 浏览器确认书签—轮播—喜欢同排对齐，窄屏无重叠，最快档显示 0.2 秒并能完成整部作品轮播；长按只打开选档，超爱保存后自动关闭且焦点回到爱心，更多菜单打开同一弹层。

首次全量运行受沙箱本地端口/tsx IPC 限制，并出现高负载测试超时及一处新增预取 hook 所需的旧测试 mock 缺失。修正 mock 后，提升权限并限制四个 worker 的完整复跑全部通过；未删除断言、提高超时或跳过失败测试。

## 独立审查

按用户要求由 GPT-6.1 Sol 独立审查本轮 diff，发现一项 P2：评分保存失败后丢失待确认目标，重试成功不能自动关闭弹层。修复为保留失败目标、仅在无错误且确认目标已保存时关闭，并补充同档重试与焦点恢复测试。Sol 复核通过，未发现新增问题。

## 覆盖限制与恢复

单图及 WebP 场景由相关组件测试覆盖，本轮未追加真实 WebP 样本或手机真机验证。真实网络故障、账户切换和迟到响应由组件/状态测试覆盖；不将其记作真实浏览器故障注入。未运行数据库集成测试，也未验证生产部署。

回退可恢复此前前端代码；已有评分及图片标记数据保持原语义，无数据迁移。旧版本会按原规则归一化新保存的 0.2 秒偏好。标签触发后的 CI 与镜像发布应分别查看 [GitHub Actions](https://github.com/namehu/PixiShelf/actions)，构建成功不代表已部署到 NAS。
