# PixiShelf

一个现代化的个人Web画廊，专为艺术家和收藏家设计，用于管理和展示本地图片收藏。将按文件夹组织的静态图片转变为动态、美观、易于导航的现代化Web应用。

## 🚀 项目特性

### 核心功能
- **智能图片管理**: 自动扫描、分类和展示本地图片收藏
- **艺术家识别**: 智能解析文件夹结构，自动识别艺术家信息
- **标签系统**: 灵活的标签管理、搜索和批量翻译功能
- **多媒体支持**: 支持图片和视频文件的展示和处理
- **全文搜索**: 基于PostgreSQL的高性能全文搜索
- **用户认证**: 安全的JWT身份认证系统

### 技术特性
- **现代化技术栈**: Next.js 15 + React 19 + TypeScript + Prisma + PostgreSQL
- **Monorepo架构**: 使用pnpm workspace管理项目结构
- **图片处理**: 集成imgproxy和thumbor提供高性能图片处理
- **Docker支持**: 一键部署，环境一致性保障
- **响应式设计**: 适配各种设备屏幕
- **实时更新**: SSE流式数据更新

## 📋 技术栈

### 前端
- **Next.js 15** - 全栈React框架，支持App Router
- **React 19** - 现代化UI框架
- **TypeScript** - 类型安全的JavaScript
- **Tailwind CSS** - 实用优先的CSS框架
- **Radix UI** - 无障碍的UI组件库
- **TanStack Query** - 数据获取和状态管理
- **Lucide React** - 现代化图标库

### 后端
- **Next.js API Routes** - 服务端API
- **Prisma** - 现代化ORM和数据库工具
- **PostgreSQL** - 强大的关系型数据库
- **JWT** - 身份认证
- **bcryptjs** - 密码加密
- **Winston** - 日志管理

### 图片处理
- **imgproxy** - 高性能图片处理服务
- **thumbor** - 视频缩略图和处理服务
- **Fast-glob** - 文件系统扫描

### 开发工具
- **pnpm** - 高效的包管理器
- **ESLint** + **Prettier** - 代码质量保障
- **Husky** - Git hooks
- **Docker** + **Docker Compose** - 容器化部署

## 🛠️ 环境要求

### 系统要求
- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0
- **Docker**: >= 20.0.0
- **Docker Compose**: >= 2.0.0

### 开发环境安装

1. **安装Node.js**
   ```bash
   # 推荐使用nvm管理Node.js版本
   nvm install 18
   nvm use 18
   ```

2. **安装pnpm**
   ```bash
   npm install -g pnpm
   ```

3. **安装Docker**
   - Windows/macOS: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Linux: 参考 [官方安装指南](https://docs.docker.com/engine/install/)

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone <repository-url>
cd PixiShelf
```

### 2. 安装依赖
```bash
pnpm install
```

### 3. 环境配置

#### 3.1 创建环境变量文件
```bash
# 复制环境变量模板文件
cp build/.env.example .env
```

#### 3.2 配置环境变量
编辑 `.env` 文件，配置以下关键参数：

```env
# 数据库配置
POSTGRES_USER=pixishelf
POSTGRES_PASSWORD=your-secure-password  # 请修改为安全密码
POSTGRES_DB=pixishelf
DATABASE_URL=postgresql://pixishelf:your-secure-password@localhost:5432/pixishelf

# JWT密钥（必须修改，至少32字符）
JWT_SECRET=your-very-secure-jwt-secret-key-here-at-least-32-characters

# 管理员账户
INIT_ADMIN_USERNAME=admin
INIT_ADMIN_PASSWORD=admin123  # 请修改为安全密码

# 图片处理服务URL
NEXT_PUBLIC_IMGPROXY_URL=http://localhost:5431
NEXT_PUBLIC_THUMBOR_VIDEO_URL=http://localhost:5433

# 图片数据目录（根据实际情况修改）
# Windows示例: C:\Users\Administrator\Downloads\pixiv
# macOS/Linux示例: /Users/username/Pictures/collection
```

### 4. 启动服务

#### 4.1 使用Docker启动所有服务（推荐）
```bash
cd build
docker-compose up -d
```

#### 4.2 开发环境启动
```bash
# 启动数据库
cd build
docker-compose up -d postgres

# 等待数据库启动完成
docker-compose logs -f postgres

# 初始化数据库
cd ../packages/pixishelf
pnpm db:generate
pnpm db:push

# 启动开发服务器
pnpm dev
```

### 5. 访问应用
- **Web界面**: http://localhost:5430
- **图片处理服务**: http://localhost:5431 (imgproxy)
- **视频处理服务**: http://localhost:5433 (thumbor)
- **数据库**: localhost:5432
- **Prisma Studio**: http://localhost:5555 (如果启动了)

## 📁 项目结构

```
PixiShelf/
├── .env                          # 环境变量配置
├── package.json                  # 根项目配置
├── pnpm-workspace.yaml          # pnpm工作空间配置
├── build/                       # Docker构建和部署文件
│   ├── .env.example            # 环境变量模板
│   ├── docker-compose.yml     # Docker编排文件
│   ├── Dockerfile              # 应用Docker构建文件
│   ├── init.sql                # 数据库初始化脚本
│   └── thumbor/                # Thumbor配置
├── docs/                        # 项目文档
│   ├── SYSTEM_DESIGN.md       # 系统设计文档
│   └── tag_refactor.md        # 标签重构文档
├── packages/                    # 子包目录
│   └── pixishelf/              # 主应用包
│       ├── package.json        # 应用依赖配置
│       ├── next.config.ts      # Next.js配置
│       ├── prisma/             # 数据库模式和迁移
│       │   ├── schema.prisma   # 数据库模式定义
│       │   └── generated/      # Prisma生成的客户端
│       ├── src/                # 源代码
│       │   ├── app/            # Next.js App Router
│       │   │   ├── api/        # API路由
│       │   │   ├── (auth)/     # 认证相关页面
│       │   │   └── globals.css # 全局样式
│       │   ├── components/     # React组件
│       │   ├── lib/            # 工具库和服务
│       │   ├── types/          # TypeScript类型定义
│       │   └── utils/          # 工具函数
│       └── public/             # 静态资源
└── .github/                     # GitHub配置
    └── workflows/              # CI/CD工作流
```

## 🔧 开发命令

### 根目录命令
```bash
# 安装所有依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建项目
pnpm build

# 代码格式化
pnpm format
```

### 应用命令
```bash
cd packages/pixishelf

# 开发模式启动
pnpm dev

# 构建生产版本
pnpm build

# 启动生产版本
pnpm start

# 数据库相关
pnpm db:generate    # 生成Prisma客户端
pnpm db:push        # 推送模式到数据库
pnpm db:migrate     # 运行数据库迁移
pnpm db:deploy      # 部署数据库迁移
pnpm db:studio      # 启动Prisma Studio
```

## 🐳 Docker部署

### 开发环境
```bash
cd build

# 启动数据库
docker-compose up -d postgres

# 查看数据库日志
docker-compose logs -f postgres

# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 生产环境
```bash
cd build

# 使用生产配置启动
docker-compose -f docker-compose.deploy.yml up -d

# 查看服务状态
docker-compose -f docker-compose.deploy.yml ps

# 查看日志
docker-compose -f docker-compose.deploy.yml logs -f
```

### 服务说明
- **postgres**: PostgreSQL数据库服务 (端口5432)
- **app**: PixiShelf主应用 (端口5430)
- **imgproxy**: 图片处理服务 (端口5431)
- **thumbor**: 视频处理服务 (端口5433)

## 🗄️ 数据库管理

### 备份数据库
```bash
# 创建数据库备份
docker exec pixishelf-db pg_dump -U pixishelf -d pixishelf > backup.sql
```

### 恢复数据库
```bash
# 从备份恢复数据库
docker exec -i pixishelf-db psql -U pixishelf -d pixishelf < backup.sql
```

### 重置数据库
```bash
# 停止服务
docker-compose down

# 删除数据卷
docker volume rm build_postgres_data

# 重新启动
docker-compose up -d postgres

# 重新初始化数据库
cd packages/pixishelf
pnpm db:push
```

## 🔍 故障排除

### 常见问题

1. **数据库连接失败**
   - 确保Docker服务正在运行
   - 检查数据库容器状态：`docker-compose ps`
   - 查看数据库日志：`docker-compose logs postgres`
   - 验证DATABASE_URL配置是否正确

2. **端口冲突**
   - 检查端口占用：`lsof -i :5430` (macOS/Linux) 或 `netstat -an | findstr :5430` (Windows)
   - 修改docker-compose.yml中的端口映射

3. **依赖安装失败**
   - 清除缓存：`pnpm store prune`
   - 删除node_modules：`rm -rf node_modules packages/*/node_modules`
   - 重新安装：`pnpm install`

4. **Prisma相关问题**
   - 重新生成客户端：`cd packages/pixishelf && pnpm db:generate`
   - 检查数据库连接字符串
   - 确保数据库服务正在运行

5. **图片处理服务问题**
   - 检查imgproxy服务状态：`curl http://localhost:5431/health`
   - 检查thumbor服务状态：`curl http://localhost:5433/healthcheck`
   - 确保图片目录正确挂载

6. **环境变量问题**
   - 确保.env文件存在且配置正确
   - 检查JWT_SECRET是否设置且足够长
   - 验证图片目录路径是否正确

### 日志查看
```bash
# 查看应用日志
docker-compose logs -f app

# 查看数据库日志
docker-compose logs -f postgres

# 查看图片处理服务日志
docker-compose logs -f imgproxy
docker-compose logs -f thumbor

# 查看所有服务日志
docker-compose logs -f
```

### 性能优化
- 确保为PostgreSQL分配足够的内存
- 定期清理未使用的Docker镜像和容器
- 监控磁盘空间，特别是图片存储目录
- 考虑使用SSD存储以提高I/O性能

## 📝 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🤝 贡献

欢迎提交Issue和Pull Request！

1. Fork本项目
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add some amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交Pull Request

## 📞 支持

如果你在使用过程中遇到问题，请：

1. 查看本README的故障排除部分
2. 查看项目文档目录下的相关文档
3. 搜索已有的Issues
4. 创建新的Issue并提供详细信息

---

**享受你的个人画廊之旅！** 🎨✨
