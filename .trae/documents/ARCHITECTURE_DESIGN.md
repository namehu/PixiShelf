# PixiShelf 架构设计文档

## 1. 架构设计

### 1.1 系统架构图

```mermaid
graph TD
    A[用户浏览器] --> B[Next.js 应用]
    B --> C[App Router API]
    C --> D[Prisma ORM]
    D --> E[PostgreSQL 数据库]
    B --> F[静态资源服务]
    F --> G[本地文件系统]

    subgraph "前端层"
        B
        H[React 19 组件]
        I[TanStack Query]
        J[Tailwind CSS]
        K[Radix UI]
    end

    subgraph "API层"
        C
        L[认证中间件]
        M[文件扫描服务]
        N[图片处理服务]
    end

    subgraph "数据层"
        D
        E
    end

    subgraph "存储层"
        G
        O[图片文件]
        P[缩略图缓存]
    end
```

### 1.2 架构特点

* **全栈架构**: 基于Next.js 15的App Router，前后端一体化开发

* **类型安全**: 全栈TypeScript，从数据库到UI的端到端类型安全

* **现代化技术栈**: React 19、Prisma ORM、TanStack Query等最新技术

* **容器化部署**: Docker + Docker Compose，支持开发和生产环境

* **Monorepo管理**: pnpm workspace统一依赖管理

## 2. 技术描述

### 2.1 核心技术栈

* **前端框架**: Next.js\@15.5.3 + React\@19.1.0 + TypeScript\@5

* **样式方案**: Tailwind CSS\@4.1.13 + Radix UI组件库

* **状态管理**: TanStack Query\@5.52.1 (服务端状态) + React内置状态

* **数据库**: PostgreSQL + Prisma\@5.17.0 ORM

* **认证方案**: JWT + bcryptjs密码加密

* **构建工具**: Next.js内置Turbopack

* **代码质量**: ESLint + Prettier + Husky

### 2.2 开发工具

* **包管理**: pnpm workspace

* **容器化**: Docker + Docker Compose

* **开发环境**: VS Code Dev Container

* **CI/CD**: GitHub Actions

* **部署平台**: Vercel (前端) + 自托管 (数据库)

## 3. 路由定义

### 3.1 页面路由

| 路由                 | 用途       | 访问权限 |
| ------------------ | -------- | ---- |
| `/`                | 首页重定向到画廊 | 公开   |
| `/login`           | 用户登录页面   | 公开   |
| `/gallery`         | 主画廊页面    | 需认证  |
| `/artworks/[id]`   | 作品详情页面   | 需认证  |
| `/artists`         | 艺术家列表页面  | 需认证  |
| `/artists/[id]`    | 艺术家详情页面  | 需认证  |
| `/tags`            | 标签管理页面   | 需认证  |
| `/admin`           | 管理后台首页   | 管理员  |
| `/admin/scan`      | 文件扫描管理   | 管理员  |
| `/admin/tags`      | 标签管理     | 管理员  |
| `/admin/users`     | 用户管理     | 管理员  |
| `/change-password` | 修改密码页面   | 需认证  |

### 3.2 API路由

#### 认证相关

| 方法     | 路径                 | 描述       |
| ------ | ------------------ | -------- |
| `POST` | `/api/auth/login`  | 用户登录     |
| `POST` | `/api/auth/logout` | 用户登出     |
| `GET`  | `/api/auth/me`     | 获取当前用户信息 |

#### 作品管理

| 方法    | 路径                                 | 描述       |
| ----- | ---------------------------------- | -------- |
| `GET` | `/api/artworks`                 | 获取作品分页列表 |
| `GET` | `/api/artworks/[id]`            | 获取单个作品详情 |
| `GET` | `/api/artworks/recommendations` | 获取推荐作品   |

#### 艺术家管理

| 方法    | 路径                  | 描述      |
| ----- | ------------------- | ------- |
| `GET` | `/api/artists`      | 获取艺术家列表 |
| `GET` | `/api/artists/[id]` | 获取艺术家详情 |

#### 标签管理

| 方法     | 路径                          | 描述     |
| ------ | --------------------------- | ------ |
| `GET`  | `/api/v1/tags`              | 获取标签列表 |
| `GET`  | `/api/v1/tags/[id]`         | 获取标签详情 |
| `GET`  | `/api/v1/tags/popular`      | 获取热门标签 |
| `GET`  | `/api/v1/tags/random`       | 获取随机标签 |
| `GET`  | `/api/v1/tags/search`       | 搜索标签   |
| `POST` | `/api/v1/tags/update-stats` | 更新标签统计 |

#### 文件管理

| 方法     | 路径                         | 描述     |
| ------ | -------------------------- | ------ |
| `GET`  | `/api/v1/images/[...path]` | 获取图片文件 |
| `POST` | `/api/v1/scan/stream`      | 开始文件扫描 |
| `GET`  | `/api/v1/scan/status`      | 获取扫描状态 |
| `POST` | `/api/v1/scan/cancel`      | 取消扫描任务 |

#### 系统管理

| 方法     | 路径                           | 描述       |
| ------ | ---------------------------- | -------- |
| `GET`  | `/api/health`             | 健康检查     |
| `GET`  | `/api/suggestions`        | 获取搜索建议   |
| `GET`  | `/api/settings/scan-path` | 获取扫描路径设置 |
| `GET`  | `/api/v1/users`              | 获取用户列表   |
| `POST` | `/api/v1/users/password`     | 修改用户密码   |

## 4. 数据模型

### 4.1 数据模型定义

```mermaid
erDiagram
    Artist ||--o{ Artwork : creates
    Artwork ||--o{ Image : contains
    Artwork ||--o{ ArtworkTag : has
    Tag ||--o{ ArtworkTag : tagged

    Artist {
        int id PK
        string name
        string username
        string userId
        string bio
        datetime createdAt
        datetime updatedAt
    }

    Artwork {
        int id PK
        string title
        string description
        int artistId FK
        datetime createdAt
        datetime updatedAt
        int descriptionLength
        datetime directoryCreatedAt
        int imageCount
        int bookmarkCount
        string externalId
        boolean isAiGenerated
        string originalUrl
        string size
        datetime sourceDate
        string sourceUrl
        string thumbnailUrl
        string xRestrict
    }

    Tag {
        int id PK
        string name
        string description
        int artworkCount
        datetime createdAt
        datetime updatedAt
    }

    ArtworkTag {
        int id PK
        int artworkId FK
        int tagId FK
        datetime createdAt
    }

    Image {
        int id PK
        string path
        int width
        int height
        int size
        int sortOrder
        int artworkId FK
        datetime createdAt
        datetime updatedAt
    }

    User {
        int id PK
        string username
        string password
        datetime createdAt
        datetime updatedAt
    }

    Setting {
        int id PK
        string key
        string value
        string type
        datetime createdAt
        datetime updatedAt
    }
```

### 4.2 数据定义语言

#### 核心表结构

```sql
-- 艺术家表
CREATE TABLE "Artist" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "userId" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "unique_username_userid" UNIQUE ("username", "userId")
);

-- 作品表
CREATE TABLE "Artwork" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "artistId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "descriptionLength" INTEGER NOT NULL DEFAULT 0,
    "directoryCreatedAt" TIMESTAMP(3),
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER,
    "externalId" TEXT,
    "isAiGenerated" BOOLEAN,
    "originalUrl" TEXT,
    "size" TEXT,
    "sourceDate" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "thumbnailUrl" TEXT,
    "xRestrict" TEXT,
    CONSTRAINT "Artwork_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
);

-- 标签表
CREATE TABLE "Tag" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "artworkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- 作品标签关联表
CREATE TABLE "ArtworkTag" (
    "id" SERIAL PRIMARY KEY,
    "artworkId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtworkTag_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE,
    CONSTRAINT "ArtworkTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE,
    CONSTRAINT "ArtworkTag_artworkId_tagId_key" UNIQUE ("artworkId", "tagId")
);

-- 图片表
CREATE TABLE "Image" (
    "id" SERIAL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "artworkId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Image_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id"),
    CONSTRAINT "unique_artwork_path" UNIQUE ("artworkId", "path")
);

-- 用户表
CREATE TABLE "User" (
    "id" SERIAL PRIMARY KEY,
    "username" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- 设置表
CREATE TABLE "Setting" (
    "id" SERIAL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "value" TEXT,
    "type" TEXT NOT NULL DEFAULT 'string',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
```

#### 索引优化

```sql
-- 作品表索引
CREATE INDEX "Artwork_directoryCreatedAt_idx" ON "Artwork"("directoryCreatedAt");
CREATE INDEX "Artwork_imageCount_idx" ON "Artwork"("imageCount");
CREATE INDEX "Artwork_sourceDate_idx" ON "Artwork"("sourceDate");
CREATE INDEX "Artwork_externalId_idx" ON "Artwork"("externalId");

-- 标签表索引
CREATE INDEX "Tag_name_idx" ON "Tag"("name");
CREATE INDEX "Tag_artworkCount_idx" ON "Tag"("artworkCount");

-- 全文搜索支持
-- 启用 PostgreSQL 全文搜索扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Artwork_title_gin_idx" ON "Artwork" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Artwork_description_gin_idx" ON "Artwork" USING gin ("description" gin_trgm_ops);
```

## 5. 部署架构

### 5.1 开发环境架构

```mermaid
graph TD
    A[开发者] --> B[VS Code Dev Container]
    B --> C[Next.js Dev Server :5430]
    C --> D[PostgreSQL :5432]
    B --> E[本地文件系统]

    subgraph "Dev Container"
        B
        C
        F[pnpm]
        G[Node.js 20]
        H[Prisma CLI]
    end

    subgraph "数据库容器"
        D
    end
```

### 5.2 生产环境架构

```mermaid
graph TD
    A[用户] --> B[Nginx/CDN]
    B --> C[Next.js 应用容器]
    C --> D[PostgreSQL 容器]
    C --> E[文件存储卷]

    subgraph "Web层"
        B
        F[SSL终止]
        G[静态资源缓存]
    end

    subgraph "应用层"
        C
        H[Next.js Server]
        I[API Routes]
    end

    subgraph "数据层"
        D
        J[数据持久化]
    end

    subgraph "存储层"
        E
        K[图片文件]
        L[缩略图缓存]
    end
```

### 5.3 容器化配置

#### Docker Compose (开发环境)

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: .devcontainer/Dockerfile
    volumes:
      - .:/workspace:cached
      - /path/to/images:/app/data:cached
    working_dir: /workspace
    command: sleep infinity
    depends_on:
      - postgres
    environment:
      - DATABASE_URL=postgresql://pixishelf:password@postgres:5432/pixishelf
      - JWT_SECRET=your-jwt-secret-here
    ports:
      - "5430:5430"

  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_USER: pixishelf
      POSTGRES_PASSWORD: password
      POSTGRES_DB: pixishelf
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

volumes:
  postgres_data:
```

#### 生产环境部署

```yaml
version: '3.8'

services:
  web:
    image: pixishelf:latest
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://pixishelf:${POSTGRES_PASSWORD}@postgres:5432/pixishelf
      - JWT_SECRET=${JWT_SECRET}
      - SCAN_PATH=/app/data
    volumes:
      - ${IMAGE_PATH}:/app/data:ro
    ports:
      - "5430:5430"
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_USER: pixishelf
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: pixishelf
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - web

volumes:
  postgres_data:
```

## 6. 安全与性能

### 6.1 安全措施

* **认证机制**: JWT Token + HTTP-only Cookie

* **密码安全**: bcryptjs加密存储

* **CORS配置**: 严格的跨域资源共享策略

* **中间件保护**: 路由级别的认证中间件

* **环境变量**: 敏感信息通过环境变量管理

* **SQL注入防护**: Prisma ORM自动防护

### 6.2 性能优化

* **图片优化**: Next.js Image组件自动优化

* **缓存策略**: TanStack Query客户端缓存

* **懒加载**: React Intersection Observer

* **代码分割**: Next.js自动代码分割

* **数据库优化**: 索引优化和查询优化

* **静态资源**: CDN和浏览器缓存

### 6.3 监控与日志

* **错误监控**: Next.js内置错误边界

* **性能监控**: Web Vitals指标

* **日志记录**: 结构化日志输出

* **健康检查**: API健康检查端点

* **数据库监控**: Prisma查询日志

## 7. 开发工作流

### 7.1 开发环境设置

```bash
# 1. 克隆项目
git clone <repository-url>
cd PixiShelf

# 2. 安装依赖
pnpm install

# 3. 启动开发容器
code . # 在VS Code中打开，选择"在容器中重新打开"

# 4. 数据库迁移
pnpm db:push

# 5. 启动开发服务器
pnpm dev
```

### 7.2 代码质量保证

* **TypeScript**: 严格类型检查

* **ESLint**: 代码规范检查

* **Prettier**: 代码格式化

* **Husky**: Git钩子自动化

* **lint-staged**: 提交前代码检查

### 7.3 构建与部署

```bash
# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start

# Docker构建
docker build -t pixishelf .

# 部署到生产环境
docker-compose -f docker-compose.prod.yml up -d
```

## 8. 扩展性考虑

### 8.1 水平扩展

* **数据库**: PostgreSQL读写分离

* **文件存储**: 对象存储服务集成

* **缓存层**: Redis缓存集成

* **负载均衡**: Nginx负载均衡

### 8.2 功能扩展

* **搜索引擎**: Elasticsearch全文搜索

* **图片处理**: Sharp图片处理服务

* **任务队列**: BullMQ后台任务

* **实时通信**: WebSocket支持

* **API文档**: OpenAPI/Swagger集成

### 8.3 监控与运维

* **应用监控**: Prometheus + Grafana

* **日志聚合**: ELK Stack

* **错误追踪**: Sentry集成

* **性能分析**: Next.js Analytics

* **备份策略**: 自动化数据库备份

***

*本文档基于PixiShelf项目的实际实现情况编写，反映了项目的真实技术架构和设计决策。*
