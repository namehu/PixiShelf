# PixiShelf

一个现代化的个人Web画廊应用，专为艺术收藏家和创作者设计，用于管理和展示本地图片收藏。将按文件夹组织的静态图片转变为动态、美观、易于导航的现代化Web应用。

## ✨ 项目特性

### 🎯 核心功能

- **智能文件扫描**: 自动扫描本地目录，解析文件夹结构和元数据
- **艺术家管理**: 智能识别和管理艺术家信息，支持多种命名格式
- **标签系统**: 灵活的标签管理，支持全文搜索、批量翻译和智能建议
- **作品展示**: 响应式画廊界面，支持无限滚动和多种排序方式
- **多媒体支持**: 支持图片和视频文件的展示，自动生成缩略图
- **用户认证**: 基于JWT的安全认证系统，支持管理员权限控制
- **实时更新**: 使用SSE（Server-Sent Events）实现扫描进度实时推送

### 🚀 技术特性

- **现代化架构**: 基于 Next.js 16 App Router 的分层架构设计
- **类型安全**: 全面使用TypeScript，确保代码质量和开发体验
- **高性能数据库**: PostgreSQL + Prisma ORM，支持全文搜索和复杂查询
- **媒体处理**: ImgProxy 负责静态图片优化，FFmpeg 后台任务预生成视频封面和其他派生媒体
- **容器化部署**: Docker + Docker Compose，一键部署和环境一致性
- **响应式设计**: 基于Tailwind CSS，适配各种设备屏幕
- **Monorepo管理**: 使用pnpm workspace管理项目结构

## 🛠️ 技术栈

### 前端技术

- **Next.js 16** - 全栈 React 框架，支持 App Router 和 RSC
- **React 19** - 现代化UI框架，支持并发特性
- **TypeScript 5** - 类型安全的JavaScript超集
- **Tailwind CSS 4** - 实用优先的CSS框架
- **Radix UI** - 无障碍的高质量UI组件库
- **TanStack Query** - 强大的数据获取和状态管理
- **Framer Motion** - 流畅的动画库
- **Zustand** - 轻量级状态管理

### 后端技术

- **Next.js API Routes** - 服务端API和中间件
- **Prisma 5** - 现代化ORM和数据库工具
- **PostgreSQL 15** - 强大的关系型数据库
- **JWT** - 无状态身份认证
- **bcryptjs** - 密码加密和验证
- **Winston** - 结构化日志管理
- **Zod** - 运行时类型验证

### 图片处理

- **imgproxy** - 高性能图片处理和优化服务
- **FFmpeg** - 由后台 Worker 预生成视频封面、章节截图和代表帧
- **fast-glob** - 高效的文件系统扫描

### 开发工具

- **pnpm** - 快速、节省磁盘空间的包管理器
- **oxlint** - 快速代码质量检查
- **Prettier** - 代码格式化
- **Husky** - Git hooks管理
- **Docker** - 容器化部署

## 📋 环境要求

### 系统要求

- **Git**：用于克隆仓库。
- **Node.js**：20 LTS。
- **pnpm**：8.15.1，与根目录 `packageManager` 保持一致。
- **Docker**：24 或更高版本。
- **Docker Compose**：V2.20 或更高版本，命令形式为 `docker compose`。

推荐通过 Corepack 安装项目指定的 pnpm：

```bash
corepack enable
corepack prepare pnpm@8.15.1 --activate
```

Windows 和 macOS 可安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)；Linux 请参考
[Docker Engine 官方安装指南](https://docs.docker.com/engine/install/)。Windows 使用 Docker Desktop 时，媒体所在磁盘必须允许 Docker 访问。

## 🚀 本地开发：从零启动

这是当前项目唯一的标准本地启动流程：PostgreSQL、ImgProxy 和通用 Worker 运行在 Docker 中，Next.js App
运行在宿主机并通过 VS Code F5 或 `pnpm dev` 启动。当前版本不再使用 Thumbor，也没有 5433 服务。

### 1. 克隆项目

```bash
git clone https://github.com/namehu/PixiShelf.git
cd PixiShelf
```

### 2. 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 3. 环境配置

#### 3.1 创建环境变量文件

PowerShell：

```powershell
Copy-Item build/.env.example build/.env
Copy-Item packages/pixishelf/.env.example packages/pixishelf/.env.local
```

Bash：

```bash
cp build/.env.example build/.env
cp packages/pixishelf/.env.example packages/pixishelf/.env.local
```

#### 3.2 配置环境变量

Docker Compose 使用 `build/.env`，宿主机 Next.js 使用 `packages/pixishelf/.env.local`。容器内数据库地址是
`postgres:5432`，宿主机数据库地址是 `127.0.0.1:5432`，所以两份文件不能直接互相替代。

| 配置         | 要求                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL   | `build/.env` 的用户、密码、数据库名必须与 `.env.local` 的 `DATABASE_URL` 一致。                                                                                |
| 原媒体目录   | `PIXISHELF_DATA_PATH`、`SCAN_PATH` 和 `ARCHIVE_STORAGE_PATH` 必须指向同一份真实媒体目录。                                                                      |
| 派生媒体目录 | 本地开发必须显式配置 `DERIVED_MEDIA_HOST_PATH` 和 `DERIVED_MEDIA_STORAGE_PATH`，并让它们指向同一个绝对路径。                                                   |
| Dispatcher   | 本地完整功能验证时，两份环境文件里的 `CENTRAL_DISPATCHER_CUTOVER_ENABLED` 与 `WORKER_DISPATCH_ENABLED` 都设置为 `true`。                                       |
| 安全配置     | 修改 `JWT_SECRET`、`BETTER_AUTH_SECRET`、管理员密码、`INTERNAL_JOB_TOKEN` 和 `SCAN_WEBHOOK_TOKEN`；启用 scheduler 时两份文件的 `INTERNAL_JOB_TOKEN` 必须一致。 |
| ImgProxy     | 本地使用 `NEXT_PUBLIC_IMGPROXY_URL=http://127.0.0.1:5431`。                                                                                                    |

Windows 路径示例：

```dotenv
# build/.env
PIXISHELF_DATA_PATH=D:\SynologyDrive\pixiv
DERIVED_MEDIA_HOST_PATH=D:\Projects\PixiShelf\packages\pixishelf\.local-data\derived-media
CENTRAL_DISPATCHER_CUTOVER_ENABLED=true
WORKER_DISPATCH_ENABLED=true

# packages/pixishelf/.env.local
DATABASE_URL=postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20
SCAN_PATH=D:\SynologyDrive\pixiv
ARCHIVE_STORAGE_PATH=D:\SynologyDrive\pixiv
DERIVED_MEDIA_STORAGE_PATH=D:\Projects\PixiShelf\packages\pixishelf\.local-data\derived-media
CENTRAL_DISPATCHER_CUTOVER_ENABLED=true
WORKER_DISPATCH_ENABLED=true
```

macOS/Linux 使用相应绝对路径。Webhook 调用需要请求头 `Authorization: Bearer <SCAN_WEBHOOK_TOKEN>`。

### 4. 启动 PostgreSQL 和 ImgProxy

先不要启动 Worker；全新数据库必须先完成 migration：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d postgres imgproxy
docker compose --env-file build/.env -f build/docker-compose.dev.yml ps
```

确认 PostgreSQL 显示 `healthy`，并且 `http://127.0.0.1:5431/health` 返回 200。

### 5. 生成 Prisma Client 并部署迁移

Prisma CLI 不会自动读取 Next.js 的 `.env.local`，因此需要在当前终端显式提供同一个 `DATABASE_URL`。

PowerShell：

```powershell
$env:DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db exec prisma migrate status --schema prisma/schema.prisma
```

Bash：

```bash
export DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db exec prisma migrate status --schema prisma/schema.prisma
```

只接受 `Database schema is up to date!`。普通启动和升级必须使用 `db:deploy`；不要使用 `db:push` 代替迁移，
否则会造成数据库结构和 `_prisma_migrations` 历史不一致。`db:migrate` 只用于开发者创建新的迁移文件。

### 6. 构建并启动通用 Worker

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
```

健康检查必须成功，后台任务页面应显示一个 `READY` 实例。如果 Worker 只显示心跳却不领取任务，首先检查
`build/.env` 中的 `WORKER_DISPATCH_ENABLED=true`。

### 7. 启动 Next.js App

VS Code 中选择 `PixiShelf: debug full stack` 或 `PixiShelf: debug server-side` 后按 F5；两个配置都使用 5430。
也可以使用命令行：

```bash
cd packages/pixishelf
pnpm dev
```

### 8. 启动后验收

PowerShell：

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5430/login).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5431/health).StatusCode
```

Bash：

```bash
curl -fsS http://127.0.0.1:5430/login > /dev/null
curl -fsS http://127.0.0.1:5431/health > /dev/null
```

两个请求都应返回 200。随后检查容器和 Worker 日志：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml ps
docker compose --env-file build/.env -f build/docker-compose.dev.yml logs --tail=100 worker
```

- 主应用：`http://127.0.0.1:5430`
- 管理后台：`http://127.0.0.1:5430/admin`
- ImgProxy：`http://127.0.0.1:5431`
- Prisma Studio（可选）：保持 `DATABASE_URL` 已设置后运行 `pnpm --filter @pixishelf/db db:studio`

视频封面、章节截图和代表帧由 Worker 使用 FFmpeg 预生成，再由 ImgProxy 读取静态派生媒体。封面缺失时显示占位图；
原视频只通过播放器读取。不要恢复 Thumbor、`NEXT_PUBLIC_THUMBOR_VIDEO_URL`、5433 或 `/_video` 路由。

### 9. 可选：启动计划任务容器

确认 App 已运行且两份环境文件的 `INTERNAL_JOB_TOKEN` 一致后执行：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml --profile scheduled up -d scheduler
```

不需要自动调度时保持 scheduler 未启动。

### 10. 停止开发环境

先在 F5/`pnpm dev` 终端停止 Next.js，再执行：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml down
```

该命令保留 PostgreSQL 命名卷。除非明确要永久删除本地数据库，否则不要添加 `-v`。

### 11. 已有数据库或启动失败

- 升级已有数据库前先备份 PostgreSQL、原媒体和派生媒体，然后仍然执行 `db:deploy`。
- 遇到 `P3009`、重复列、迁移校验失败或数据库结构漂移时立即停止；不要执行 `db:push`、不要盲目标记迁移完成，也不要删除数据库卷。
- 使用 `docker compose --env-file build/.env -f build/docker-compose.dev.yml logs postgres worker` 保存日志后再排查。
- 生产部署、备份、回滚和 Traefik 步骤不使用本节命令，必须遵循下方生产文档。

## 📁 项目架构

### 目录结构

```
PixiShelf/
├── packages/pixishelf/          # 主应用
│   ├── src/
│   │   ├── app/                # Next.js App Router
│   │   │   ├── (auth)/         # 认证页面组
│   │   │   ├── (protected)/    # 受保护页面组
│   │   │   ├── admin/          # 管理后台
│   │   │   └── api/            # API路由
│   │   ├── components/         # React组件
│   │   │   ├── ui/             # 基础UI组件
│   │   │   ├── artwork/        # 作品相关组件
│   │   │   ├── auth/           # 认证组件
│   │   │   └── admin/          # 管理组件
│   │   ├── lib/                # 核心库
│   │   │   ├── repositories/   # 数据访问层
│   │   │   ├── services/       # 业务逻辑层
│   │   │   └── prisma.ts       # 数据库客户端
│   │   ├── types/              # TypeScript类型
│   │   ├── hooks/              # React Hooks
│   │   └── utils/              # 工具函数
│   └── public/                 # 静态资源
├── packages/pixishelf-db/      # Prisma schema、完整迁移历史和数据库客户端
├── packages/pixishelf-job-contracts/ # 后台任务 wire contracts 和 Zod payload
├── packages/pixishelf-job-runtime/   # 通用生命周期、心跳和运行时协议
├── packages/pixishelf-worker/ # 可独立构建/部署的后台 Worker
├── build/                      # Docker配置
│   ├── docker-compose.dev.yml # 开发环境
│   ├── docker-compose.deploy.yml # 生产环境
│   └── Dockerfile              # 应用镜像
└── docs/                       # 项目文档
```

### 分层架构

```mermaid
graph TB
    A[表示层 - Presentation] --> B[服务层 - Service]
    B --> C[数据访问层 - Repository]
    C --> D[数据库 - PostgreSQL]

    subgraph "表示层"
        A1[React组件]
        A2[API路由]
        A3[页面路由]
    end

    subgraph "服务层"
        B1[业务逻辑]
        B2[数据验证]
        B3[权限控制]
    end

    subgraph "数据访问层"
        C1[Repository模式]
        C2[Prisma ORM]
        C3[查询优化]
    end
```

## 🔧 开发指南

### 常用命令

#### 根目录命令

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建项目
pnpm build

# 快速质量检查（主应用 lint + typecheck）
pnpm check:quick

# 完整质量检查（主应用快速检查 + 单元测试 + build）
pnpm check:full

# 代码格式化
pnpm format
```

#### 应用命令

```bash
cd packages/pixishelf

# 数据库操作
pnpm db:generate    # 生成Prisma客户端
pnpm db:deploy      # 普通启动、升级：应用仓库中的正式迁移
pnpm db:migrate     # 仅限开发者修改 schema 后创建新迁移
pnpm db:push        # 仅限明确可丢弃的实验数据库，禁止用于普通启动或升级
pnpm db:studio      # 启动数据库管理界面

# 开发和构建
pnpm dev           # 开发模式（端口5430）
pnpm build         # 构建生产版本
pnpm start         # 启动生产版本
pnpm lint          # oxlint 代码检查
pnpm typecheck     # TypeScript 类型检查
pnpm check:quick   # 快速检查：lint + typecheck
pnpm test:unit     # 单元测试：排除集成、e2e 和 fixture 集成测试
pnpm test:integration # 关键集成测试
pnpm check:full    # 完整检查：快速检查 + 单元测试 + build，适合提交前或 CI

# 添加新组件
# https://ui.shadcn.com/docs/monorepo
pnpm dlx shadcn@canary add [COMPONENT]
```

### 开发工作流

1. **功能开发**

   ```bash
   # 创建功能分支
   git checkout -b feature/new-feature

   # 开发过程中
   pnpm dev          # 启动开发服务器
   pnpm db:studio    # 查看数据库

   # 日常快速检查
   pnpm check:quick  # lint + typecheck
   pnpm test:unit    # 需要验证逻辑时运行单元测试
   pnpm format       # 格式化代码
   ```

   `pnpm check:full` 会额外执行生产构建，更适合提交前或 CI；普通开发不需要每次都运行最重检查。

2. **数据库变更**

   ```bash
   # 修改 ../pixishelf-db/prisma/schema.prisma 后创建并审查迁移文件
   pnpm db:migrate
   pnpm db:generate

   # 验证已有正式迁移可以部署；普通启动也只使用该命令
   pnpm db:deploy
   ```

   `db:push` 仅允许用于明确可随时删除的实验数据库，禁止对共享数据库、长期本地数据库或生产数据库执行。

## 🐳 部署指南

### 开发环境

开发环境不要直接执行“启动全部服务”。请严格遵循上方[从零启动](#-本地开发从零启动)：先启动 PostgreSQL
和 ImgProxy，完成 `db:deploy`，再启动 Worker，最后通过宿主机 F5/`pnpm dev` 启动 App。

### 生产环境

生产发布涉及停写审查、数据库与媒体一致性备份、migration、Worker 暗启动、Traefik 调整和回滚锚点，不能用
一条 `docker compose up` 代替。当前服务、环境变量和挂载以 `build/docker-compose.deploy.yml`、
`build/.env.example` 及 [Build 与部署说明](build/README.md) 为准；阶段 1–7 的切换记录用于复用审查、备份和
回滚门禁，不能照搬其中已经退役的服务：

- [阶段 1–7 生产切换归档](docs/deployment/background-task-cutover-deployment.md)
- [回滚手册](docs/deployment/background-task-cutover-rollback.md)
- [上线后待办](docs/deployment/background-task-follow-up.md)

当前版本已移除 Thumbor。验证静态视频封面、缺失封面占位和原视频播放后，生产环境还需要删除遗留 Thumbor
容器以及外部 Traefik `/_video` 路由；回滚旧版本时必须恢复该版本归档的 Compose 与路由配置。

### 服务配置

| 服务          | 端口          | 描述                   |
| ------------- | ------------- | ---------------------- |
| app           | 5430          | 宿主机 Next.js 主应用  |
| postgres      | 5432          | PostgreSQL 数据库      |
| imgproxy      | 5431          | 静态图片和派生媒体处理 |
| worker        | 仅容器内 3011 | 后台任务执行与健康检查 |
| prisma-studio | 5555          | 可选数据库管理界面     |

## 🔍 功能说明

### 文件扫描

- 自动扫描指定目录下的图片和视频文件
- 解析文件夹结构，提取艺术家和作品信息
- 支持多种元数据格式（JSON、文件名解析等）
- 实时进度反馈和错误处理

### 标签管理

- 智能标签提取和管理
- 支持中英文标签和批量翻译
- 全文搜索和模糊匹配
- 标签统计和热门标签展示

### 作品展示

- 响应式瀑布流布局
- 无限滚动加载
- 多种排序和筛选选项
- 作品详情页面和图片查看器

### 用户管理

- JWT身份认证
- 管理员权限控制
- 用户偏好设置
- 安全的密码管理

## 🛠️ 故障排除

### 常见问题

1. **数据库连接失败**

   ```bash
   # 检查数据库状态
   docker compose --env-file build/.env -f build/docker-compose.dev.yml ps postgres
   docker compose --env-file build/.env -f build/docker-compose.dev.yml logs postgres

   # 重启数据库
   docker compose --env-file build/.env -f build/docker-compose.dev.yml restart postgres
   ```

2. **端口冲突**

   ```bash
   # 检查端口占用
   lsof -i :5430  # macOS/Linux
   netstat -ano | findstr :5430  # Windows

   # 修改端口配置
   # 编辑 build/.env 或 package.json
   ```

3. **图片处理服务异常**

   ```bash
   # 检查服务状态
   curl http://localhost:5431/health

   # 重启服务
   docker compose --env-file build/.env -f build/docker-compose.dev.yml restart imgproxy
   ```

4. **依赖安装问题**

   ```bash
   # 清理缓存
   pnpm store prune
   rm -rf node_modules packages/*/node_modules

   # 重新安装
   pnpm install --frozen-lockfile
   ```

### 性能优化

- **数据库优化**: 定期执行 `VACUUM` 和 `ANALYZE`
- **图片缓存**: 配置imgproxy缓存策略
- **内存管理**: 监控Node.js内存使用
- **磁盘空间**: 定期清理日志和临时文件

## 📚 文档

- [系统设计文档](docs/SYSTEM_DESIGN.md) - 详细的架构设计说明
- [Build 与部署说明](build/README.md) - 当前 Compose、环境变量与运行边界
- [阶段 1–7 生产切换归档](docs/deployment/background-task-cutover-deployment.md) - 历史备份、迁移、切换与验收门禁
- [回滚手册](docs/deployment/background-task-cutover-rollback.md) - 应用级和完整恢复流程
- [上线后待办](docs/deployment/background-task-follow-up.md) - 稳定期观察与阶段 8

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献流程

1. Fork 项目到你的GitHub账户
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交变更: `git commit -m 'Add amazing feature'`
4. 推送分支: `git push origin feature/amazing-feature`
5. 创建Pull Request

### 代码规范

- 遵循 oxlint 和 Prettier 配置
- 编写清晰的提交信息
- 添加必要的测试用例
- 更新相关文档

### 问题报告

- 使用GitHub Issues报告bug
- 提供详细的复现步骤
- 包含环境信息和错误日志

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

感谢以下开源项目的支持：

- [Next.js](https://nextjs.org/) - React全栈框架
- [Prisma](https://www.prisma.io/) - 现代化数据库工具
- [Tailwind CSS](https://tailwindcss.com/) - CSS框架
- [Radix UI](https://www.radix-ui.com/) - UI组件库

---

**开始你的艺术收藏数字化之旅！** 🎨✨
