# PixiShelf

一个现代化的个人Web画廊，用于管理和展示本地图片收藏。将按文件夹组织的静态图片转变为动态、美观、易于导航的现代化Web应用。

## 🚀 项目特性

- **现代化技术栈**: React + TypeScript + Fastify + PostgreSQL
- **Monorepo架构**: 使用pnpm workspace管理多包项目
- **Docker支持**: 一键部署，环境一致性保障
- **图片管理**: 自动扫描、分类和展示本地图片收藏
- **艺术家识别**: 智能解析文件夹结构，自动识别艺术家信息
- **标签系统**: 灵活的标签管理和搜索功能
- **响应式设计**: 适配各种设备屏幕

## 📋 技术栈

### 前端

- **React 18** + **TypeScript** - 现代化UI框架
- **Vite** - 快速构建工具
- **TanStack Query** - 数据获取和状态管理
- **Tailwind CSS** - 实用优先的CSS框架
- **Lucide React** - 图标库

### 后端

- **Node.js** + **Fastify** - 高性能Web框架
- **TypeScript** - 类型安全
- **Prisma** - 现代化ORM
- **PostgreSQL** - 强大的关系型数据库
- **JWT** - 身份认证
- **bcryptjs** - 密码加密

### 开发工具

- **pnpm** - 高效的包管理器
- **ESLint** + **Prettier** - 代码质量保障
- **Husky** - Git hooks
- **Docker** + **Docker Compose** - 容器化部署

## 🛠️ 环境依赖

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
   - Windows: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - macOS: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Linux: 参考 [官方安装指南](https://docs.docker.com/engine/install/)

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd artisan-shelf
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 环境配置

#### 3.1 创建环境变量文件

```bash
# 复制示例环境变量文件
cp .env.example packages/api/.env
```

#### 3.2 配置API环境变量

编辑 `packages/api/.env` 文件：

```env
# 数据库配置
DATABASE_URL="postgresql://pixishelf:password@localhost:5432/pixishelf"

# JWT密钥（请更改为安全的随机字符串）
JWT_SECRET="your-secure-jwt-secret-here"

# 管理员账户初始化
INIT_ADMIN_USERNAME="admin"
INIT_ADMIN_PASSWORD="admin123"

# 图片扫描路径（修改为你的图片收藏路径）
SCAN_PATH="/path/to/your/artwork/directory"

# 服务器配置
PORT=3002
NODE_ENV=development

# 图片处理配置
THUMBNAIL_SIZES=150,300,600
IMAGE_CACHE_PATH="./cache/images"
SCAN_INTERVAL_HOURS=24
```

#### 3.3 配置Web环境变量

创建 `packages/web/.env` 文件：

```env
# API服务地址
VITE_API_URL=http://localhost:3002
```

### 4. 启动数据库

#### 4.1 使用Docker启动PostgreSQL

```bash
# 启动数据库服务
docker-compose up -d postgres

# 查看数据库状态
docker-compose ps
```

#### 4.2 等待数据库就绪

```bash
# 检查数据库健康状态
docker-compose logs postgres

# 或者使用以下命令测试连接
docker exec -it pixishelf-db pg_isready -U pixishelf -d pixishelf
```

### 5. 初始化数据库

#### 5.1 生成Prisma客户端

```bash
cd packages/api
pnpm db:generate
```

#### 5.2 推送数据库模式

```bash
# 将Prisma模式推送到数据库
pnpm db:push

# 或者使用迁移（推荐用于生产环境）
pnpm db:migrate
```

#### 5.3 查看数据库（可选）

```bash
# 启动Prisma Studio查看数据库
pnpm db:studio
```

### 6. 启动开发服务器

#### 6.1 启动所有服务

```bash
# 在项目根目录执行，同时启动API和Web服务
pnpm dev
```

#### 6.2 分别启动服务

```bash
# 启动API服务（端口3002）
cd packages/api
pnpm dev

# 启动Web服务（端口5173）
cd packages/web
pnpm dev
```

### 7. 访问应用

- **Web界面**: http://localhost:5173
- **API服务**: http://localhost:3002
- **Prisma Studio**: http://localhost:5555 (如果启动了)

## 📁 项目结构

```
artisan-shelf/
├── .env.example              # 环境变量示例文件
├── docker-compose.yml        # Docker编排文件
├── Dockerfile               # Docker构建文件
├── init.sql                 # 数据库初始化SQL
├── package.json             # 根项目配置
├── pnpm-workspace.yaml      # pnpm工作空间配置
├── docs/                    # 项目文档
│   ├── doc.md              # 详细设计文档
│   └── ...
└── packages/                # 子包目录
    ├── api/                 # 后端API服务
    │   ├── .env            # API环境变量
    │   ├── package.json    # API依赖配置
    │   ├── prisma/         # 数据库模式和迁移
    │   │   └── schema.prisma
    │   └── src/            # API源代码
    ├── web/                # 前端Web应用
    │   ├── .env           # Web环境变量
    │   ├── package.json   # Web依赖配置
    │   └── src/           # Web源代码
    └── shared/            # 共享代码库
        └── src/
```

## 🔧 开发命令

### 根目录命令

```bash
# 安装所有依赖
pnpm install

# 启动所有开发服务
pnpm dev

# 构建所有包
pnpm build

# 代码检查
pnpm lint

# 代码格式化
pnpm format

# 类型检查
pnpm type-check
```

### API服务命令

```bash
cd packages/api

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
pnpm db:studio      # 启动Prisma Studio
```

### Web应用命令

```bash
cd packages/web

# 开发模式启动
pnpm dev

# 构建生产版本
pnpm build

# 预览生产版本
pnpm preview
```

## 🐳 Docker部署

### 开发环境

```bash
# 启动数据库
docker-compose up -d postgres

# 查看日志
docker-compose logs -f postgres
```

### 生产环境

```bash
# 构建并启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止所有服务
docker-compose down
```

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
docker volume rm artisan-shelf_postgres_data

# 重新启动
docker-compose up -d postgres

# 重新初始化数据库
cd packages/api
pnpm db:push
```

## 🔍 故障排除

### 常见问题

1. **数据库连接失败**
   - 确保Docker服务正在运行
   - 检查数据库容器状态：`docker-compose ps`
   - 查看数据库日志：`docker-compose logs postgres`

2. **端口冲突**
   - 检查端口占用：`netstat -an | findstr :5432`
   - 修改docker-compose.yml中的端口映射

3. **依赖安装失败**
   - 清除缓存：`pnpm store prune`
   - 删除node_modules：`rm -rf node_modules packages/*/node_modules`
   - 重新安装：`pnpm install`

4. **Prisma相关问题**
   - 重新生成客户端：`pnpm db:generate`
   - 检查数据库连接字符串
   - 确保数据库服务正在运行

### 日志查看

```bash
# 查看API服务日志
cd packages/api
pnpm dev

# 查看数据库日志
docker-compose logs postgres

# 查看所有服务日志
docker-compose logs
```

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
2. 搜索已有的Issues
3. 创建新的Issue并提供详细信息

---

**享受你的个人画廊之旅！** 🎨✨
