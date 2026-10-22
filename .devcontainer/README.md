---
status: draft
scope: 现存 Dev Container 配置的实际能力与启动缺口
last-verified: 2026-10-22
sources:
  - .devcontainer/devcontainer.json
  - .devcontainer/docker-compose.yml
  - .devcontainer/Dockerfile
---

# Dev Container：非标准启动入口

当前配置只是 Node.js 22 编辑容器加 PostgreSQL 15，尚未对齐项目标准本地运行栈。首次开发优先使用[根 README](../README.md#本地开发)；不要把“容器启动成功”当成 PixiShelf 可用。

| 当前配置     | 实际行为/缺口                                                                           |
| ------------ | --------------------------------------------------------------------------------------- |
| app 编辑容器 | node 用户，`/workspace` 挂载仓库，执行 `sleep infinity`，不会自动启动 Next.js           |
| postCreate   | 设置 Git 行尾并执行 `pnpm install`，不生成 Prisma Client、不 deploy migration           |
| 数据目录     | 写死宿主机 `C:\Users\pc\Downloads\pixiv` 到 `/app/data`，使用前必须按本机修改并核对权限 |
| PostgreSQL   | 默认用户名/密码为开发占位值，映射 5432；不能原样用于生产                                |
| 端口转发     | 5430/5431；5431 标签仍写 Backend API，但当前产品使用它作为 ImgProxy 端口                |
| 缺失服务     | Compose 没有 ImgProxy、通用 Worker 或 scheduler，也没有完整派生/Pixiv data 挂载         |
| 工具链       | Node 22 + pnpm 8；现行 CI/镜像为 Node 20，未据此宣称环境等价                            |
| Git 初始化   | initializeCommand 会在宿主机执行全局 `safe.directory '*'`，影响范围超出本仓库           |

若继续使用此环境，应先明确补齐依赖、三个媒体根、容器数据库地址和 migration/Worker 启动流程；本次文档整理仅纠正说明，没有修改这些配置或运行环境。端口冲突、路径和 Git 信任配置也应在启用前检查。
