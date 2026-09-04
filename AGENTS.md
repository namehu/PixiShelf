# PixiShelf 智能体指南

PixiShelf 是一个使用 pnpm 的本地图片画廊工作区，主要包包括：

- `packages/pixishelf`：Next.js 应用和任务控制平面。
- `packages/pixishelf-db`：Prisma 架构、迁移和客户端。
- `packages/pixishelf-job-*`：任务契约、运行时和执行器。
- `packages/pixishelf-worker`：调度 Worker。
- `packages/zip-convert`：Pixiv zip/APNG 转换服务。

## 工作规则

- 使用 `pnpm` 和 `rg`，改动应保持在任务范围内。除非任务需要，否则不要修改生成文件、锁文件或部署资源。
- 新增抽象前先沿用现有模式。应用没有 `src/`，源码目录直接位于 `packages/pixishelf` 下。
- 优先使用类型安全的 Prisma 数据访问和现有 Zod 校验器。合适的 UI 图标使用 lucide-react。
- 保留工作区内与任务无关的改动。未经明确要求，不要执行破坏性 Git 操作。

## 主应用路径

`packages/pixishelf` 下的普通路径必须使用全小写 kebab-case。允许 `_components`、`__tests__`、`[id]` 和 `.test.ts` 等框架约定，但其中的单词仍须小写。

完成前运行：

```bash
rg --files packages/pixishelf | rg '[A-Z]'
```

## 测试与验证

- 单元测试和组件测试放在附近的 `__tests__` 目录，不要与实现文件并列。如果包内已有顶层 `tests` 约定，则沿用该目录。
- 根据重构的影响范围按需运行相关测试，迭代中优先运行范围最小的测试。
- 全量任务只在两种情况下运行：完成大范围调整后；任务最终交付前。具体检查范围遵循 `docs/development/testing-strategy.md`。
- 主应用的全量任务是在 `packages/pixishelf` 中运行 `pnpm lint`、`pnpm test` 和 `pnpm build`。
- 主应用构建应使用提升权限，因为 Next.js/Turbopack 可能在沙箱中挂起。
- 如果因缺少服务、环境变量或网络而无法执行检查，须明确说明。

## 本地开发

- 遵循根目录 `README.md`；不要在根目录运行 `pnpm dev`，它会启动无关的工作区服务。
- `build/.env` 用于 Compose，`packages/pixishelf/.env.local` 用于本地应用；两者的数据库主机通常不同。
- 启动或升级时禁止使用 `db:push`，因为它不会更新 `_prisma_migrations`；应使用文档中的 generate/deploy 流程。

## 文档与风险

- 先查看 `docs/README.md`，确认文档的权威性和状态。
- 修改用户、工作流、不变量或产品边界前，先阅读 `docs/product/product-baseline.md`。
- 修改认证、路由、可信请求头、令牌、端口、网络或媒体权限前，先阅读 `docs/security/access-control.md`。
- 产品边界、跨包契约、数据库含义或迁移、认证/API 契约、部署、环境变量、备份恢复或难以撤销的决策发生变化时，须同步更新文档。
- 代码和运行时配置优先于冲突的文档；应修正文档或降低其状态。
- 涉及迁移、存储、部署、批量或破坏性操作时，遵循 `docs/operations/backup-and-recovery.md` 并记录恢复依据。
