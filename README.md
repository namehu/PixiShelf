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

- **现代化架构**: 基于Next.js 15 App Router的分层架构设计
- **类型安全**: 全面使用TypeScript，确保代码质量和开发体验
- **高性能数据库**: PostgreSQL + Prisma ORM，支持全文搜索和复杂查询
- **图片处理**: 集成imgproxy和thumbor，提供高性能图片和视频处理
- **容器化部署**: Docker + Docker Compose，一键部署和环境一致性
- **响应式设计**: 基于Tailwind CSS，适配各种设备屏幕
- **Monorepo管理**: 使用pnpm workspace管理项目结构

## 🛠️ 技术栈

### 前端技术

- **Next.js 15** - 全栈React框架，支持App Router和RSC
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
- **thumbor** - 视频缩略图生成和处理
- **fast-glob** - 高效的文件系统扫描

### 开发工具

- **pnpm** - 快速、节省磁盘空间的包管理器
- **ESLint 9** - 代码质量检查
- **Prettier** - 代码格式化
- **Husky** - Git hooks管理
- **Docker** - 容器化部署

## 📋 环境要求

### 系统要求

- **Node.js**: >= 20.0.0 (推荐使用最新LTS版本)
- **pnpm**: >= 8.0.0
- **Docker**: >= 24.0.0
- **Docker Compose**: >= 2.20.0

### 开发环境安装

1. **安装Node.js**

   ```bash
   # 使用nvm管理Node.js版本（推荐）
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 20
   nvm use 20
   ```

2. **安装pnpm**

   ```bash
   npm install -g pnpm@latest
   ```

3. **安装Docker**
   - **Windows/macOS**: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - **Linux**: 参考 [官方安装指南](https://docs.docker.com/engine/install/)

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/PixiShelf.git
cd PixiShelf
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 环境配置

#### 3.1 创建环境变量文件

```bash
# 复制环境变量模板
cp build/.env.example packages/pixishelf/.env
```

#### 3.2 配置环境变量

编辑 `packages/pixishelf/.env` 文件：

```env
# 数据库配置
POSTGRES_USER=pixishelf
POSTGRES_PASSWORD=your-secure-password-123
POSTGRES_DB=pixishelf
DATABASE_URL=postgresql://pixishelf:your-secure-password-123@localhost:5432/pixishelf?connection_limit=20&pool_timeout=20

# JWT配置（生产环境必须修改）
JWT_SECRET=your-very-secure-jwt-secret-key-at-least-32-characters-long
JWT_TTL=604800

# Webhook 扫描令牌（用于 POST /api/webhooks/scan 的 Bearer Token 认证）
SCAN_WEBHOOK_TOKEN=your-secure-random-token

# 管理员账户（首次启动时创建）
INIT_ADMIN_USERNAME=admin
INIT_ADMIN_PASSWORD=admin123

# 图片处理服务
NEXT_PUBLIC_IMGPROXY_URL=http://localhost:5431
NEXT_PUBLIC_THUMBOR_VIDEO_URL=http://localhost:5433

# 运行环境
NODE_ENV=development
```

Webhook 触发扫描时，请在请求头中携带：

```http
Authorization: Bearer <SCAN_WEBHOOK_TOKEN>
```

#### 3.3 配置图片目录

编辑 `build/docker-compose.yml`，修改图片目录挂载路径：

```yaml
# 将以下路径修改为你的图片目录
volumes:
  # Windows示例
  - 'C:/Users/YourName/Pictures/Collection:/app/data:cached'
  # macOS/Linux示例
  # - "/Users/yourname/Pictures/Collection:/app/data:cached"
```

### 4. 启动服务

#### 4.1 使用Docker启动（推荐）

```bash
cd build
docker-compose up -d
```

#### 4.2 开发环境启动

```bash
# 1. 启动数据库
cd build
docker-compose up -d postgres

# 2. 等待数据库就绪
docker-compose logs -f postgres

# 3. 初始化数据库
cd ../packages/pixishelf
pnpm db:generate
pnpm db:push

# 4. 启动开发服务器
pnpm dev
```

### 5. 访问应用

- **主应用**: http://localhost:5430
- **管理后台**: http://localhost:5430/admin
- **Prisma Studio**: http://localhost:5555 (开发环境)

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
│   ├── prisma/                 # 数据库模式
│   │   ├── schema.prisma       # 数据模型
│   │   └── migrations/         # 数据库迁移
│   └── public/                 # 静态资源
├── build/                      # Docker配置
│   ├── docker-compose.yml     # 开发环境
│   ├── docker-compose.deploy.yml # 生产环境
│   ├── Dockerfile              # 应用镜像
│   └── thumbor/                # Thumbor配置
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

# 代码格式化
pnpm format
```

#### 应用命令

```bash
cd packages/pixishelf

# 数据库操作
pnpm db:generate    # 生成Prisma客户端
pnpm db:push        # 推送模式变更
pnpm db:migrate     # 创建迁移
pnpm db:deploy      # 部署迁移
pnpm db:studio      # 启动数据库管理界面

# 开发和构建
pnpm dev           # 开发模式（端口5430）
pnpm build         # 构建生产版本
pnpm start         # 启动生产版本
pnpm lint          # 代码检查

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

   # 提交前检查
   pnpm lint         # 代码检查
   pnpm format       # 格式化代码
   ```

2. **数据库变更**

   ```bash
   # 修改 prisma/schema.prisma
   pnpm db:generate  # 生成客户端
   pnpm db:push      # 推送到开发数据库

   # 生产环境迁移
   pnpm db:migrate   # 创建迁移文件
   ```

## 🤖 AI Coding 配置

本项目已配置 AI Coding 工具（Trae / OpenCode）以提升开发效率。

> **提示**: 在进行前端开发时，AI 工具会自动使用 `frontend-design` skill 来生成代码。该 skill 强调独特的设计方向、精选的字体、有特色的配色和精心设计的动画效果。

详细配置说明和安装方法请参阅 [AI-CODING-SETUP.md](AI-CODING-SETUP.md)。

## 🐳 部署指南

### Docker部署

#### 开发环境

```bash
cd build

# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f app
```

#### 生产环境

```bash
cd build

# 使用生产配置
docker-compose -f docker-compose.deploy.yml up -d

# 健康检查
docker-compose -f docker-compose.deploy.yml ps
```

### 服务配置

| 服务          | 端口 | 描述                       |
| ------------- | ---- | -------------------------- |
| app           | 5430 | 主应用服务                 |
| postgres      | 5432 | PostgreSQL数据库           |
| imgproxy      | 5431 | 图片处理服务               |
| thumbor       | 5433 | 视频处理服务               |
| prisma-studio | 5555 | 数据库管理界面（开发环境） |

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
   docker-compose ps postgres
   docker-compose logs postgres

   # 重启数据库
   docker-compose restart postgres
   ```

2. **端口冲突**

   ```bash
   # 检查端口占用
   lsof -i :5430  # macOS/Linux
   netstat -ano | findstr :5430  # Windows

   # 修改端口配置
   # 编辑 docker-compose.yml 或 package.json
   ```

3. **图片处理服务异常**

   ```bash
   # 检查服务状态
   curl http://localhost:5431/health
   curl http://localhost:5433/healthcheck

   # 重启服务
   docker-compose restart imgproxy thumbor
   ```

4. **依赖安装问题**

   ```bash
   # 清理缓存
   pnpm store prune
   rm -rf node_modules packages/*/node_modules

   # 重新安装
   pnpm install
   ```

### 性能优化

- **数据库优化**: 定期执行 `VACUUM` 和 `ANALYZE`
- **图片缓存**: 配置imgproxy缓存策略
- **内存管理**: 监控Node.js内存使用
- **磁盘空间**: 定期清理日志和临时文件

## 📚 文档

- [系统设计文档](docs/SYSTEM_DESIGN.md) - 详细的架构设计说明
- [部署指南](DEPLOYMENT.md) - 生产环境部署说明

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献流程

1. Fork 项目到你的GitHub账户
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交变更: `git commit -m 'Add amazing feature'`
4. 推送分支: `git push origin feature/amazing-feature`
5. 创建Pull Request

### 代码规范

- 遵循ESLint和Prettier配置
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
