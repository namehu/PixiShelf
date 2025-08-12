# PixiShelf 项目开发记录

## 项目基本信息
- 项目名称：PixiShelf
- 仓库根目录：d:\code\pixishelf
- 技术栈：Fastify + React + Prisma + PostgreSQL
- 架构：Monorepo (pnpm workspace)

## 核心功能实现状态

### 一、用户认证系统 ✅
- JWT Token 认证机制
- 默认管理员账户初始化 (admin/admin123)
- 受保护的 API 路由
- 前端登录状态管理

### 二、文件扫描与管理 ✅
- 递归目录扫描
- 图片文件识别与入库
- 扫描进度实时显示
- 增量扫描支持
- 扫描状态 API

### 三、图片服务 ✅
- 静态图片文件服务
- 路径安全验证
- 缓存头设置
- 图片元数据支持

### 四、前端界面 ✅
- 响应式画廊布局
- 图片懒加载
- 分页导航
- 设置页面
- 扫描进度显示

## 关键文件说明

### 后端核心文件
- <mcfile name="index.ts" path="d:\code\pixishelf\packages\api\src\index.ts"></mcfile>
  - Fastify 服务器主入口，注册所有路由和中间件
- <mcfile name="scanner.ts" path="d:\code\pixishelf\packages\api\src\services\scanner.ts"></mcfile>
  - 文件扫描核心逻辑，支持递归扫描和增量更新
- <mcfile name="package.json" path="d:\code\pixishelf\packages\api\package.json"></mcfile>
  - 后端依赖管理，包含 Fastify、Prisma 等核心依赖

### 前端核心文件
- <mcfile name="Settings.tsx" path="d:\code\pixishelf\packages\web\src\pages\Settings.tsx"></mcfile>
  - 设置页面，包含扫描路径配置和手动扫描触发
- <mcfile name="Gallery.tsx" path="d:\code\pixishelf\packages\web\src\pages\Gallery.tsx"></mcfile>
  - 新增顶部全局扫描进度条、轮询 /api/v1/scan/status 与取消扫描按钮，封装 useScanStatus/useCancelScan。
- <mcfile name="vite.config.ts" path="d:\code\pixishelf\packages\web\vite.config.ts"></mcfile>
  - 代理 /api -> http://localhost:3002。

四、后端接口定义与说明
- 设置
  - GET /api/v1/settings/scan-path：返回 { scanPath }
  - PUT /api/v1/settings/scan-path：Body { scanPath }，更新扫描根路径
- 扫描
  - POST /api/v1/scan：触发扫描；扫描期间 SSE 于 /api/v1/scan/stream 输出命名事件（start、progress、done、cancelled、error）
  - POST /api/v1/scan/cancel：设置取消标记，扫描循环检查并中断
  - GET /api/v1/scan/status：返回 { scanning, message }，供前端顶部进度条与状态显示
- 图片
  - GET /api/v1/images/*：在扫描根目录下定位文件并返回
    - 支持 decodeURIComponent，阻止越界访问，设置 Content-Type/Length、ETag/Last-Modified/Cache-Control
    - preHandler 放行 /api/v1/images/*（不需要 API Key）

五、验证要点与结果
- 图片接口
  - 通过前端代理（3001）访问图片：成功返回实际大小数据（示例约 21.9MB），不再出现 content-length: 0。
  - 直接访问后端（3002）图片接口：返回包含 Content-Length、Content-Type 的正确头部。
- 扫描流程
  - Settings 页面可配置 scanPath，手动触发扫描；SSE 自动重连有效；可在扫描期间取消。
  - Gallery 页面顶部进度条实时显示扫描状态，支持取消操作。
- 认证系统
  - 登录后获得 JWT Token，存储在 localStorage；受保护路由正确验证 Token。
  - 默认管理员账户 admin/admin123 可正常登录。

## 数据库设计

### 核心表结构
```sql
-- 艺术家表
CREATE TABLE Artist (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  userId VARCHAR(255),
  bio TEXT,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- 作品表
CREATE TABLE Artwork (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  artistId INTEGER REFERENCES Artist(id),
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- 图片表
CREATE TABLE Image (
  id SERIAL PRIMARY KEY,
  path VARCHAR(500) NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  size BIGINT,
  artworkId INTEGER REFERENCES Artwork(id),
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

## 部署说明

### 开发环境
```bash
# 安装依赖
pnpm install

# 启动数据库
docker-compose up postgres -d

# 运行数据库迁移
cd packages/api && pnpm prisma migrate dev

# 启动开发服务器
pnpm dev
```

### 生产环境
```bash
# 使用 Docker Compose 一键部署
docker-compose up -d
```