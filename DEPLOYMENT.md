# PixiShelf 部署指南

本文档详细说明了如何在生产环境中部署 PixiShelf 应用。

## 🎯 部署方式选择

### 方式一：使用预构建镜像 (推荐)

适用于生产环境，使用 GitHub Actions 自动构建的镜像：
- ✅ 快速部署
- ✅ 版本管理
- ✅ 安全扫描
- ✅ 多架构支持

### 方式二：本地构建

适用于开发环境或需要自定义构建的场景：
- 🔧 完全控制构建过程
- 🔧 可自定义构建参数
- ⚠️ 构建时间较长

---

## 🚀 方式一：使用预构建镜像部署

### 1. 环境准备

确保你的服务器已安装：
- Docker (>= 20.0.0)
- Docker Compose (>= 2.0.0)

### 2. 获取部署文件

从 GitHub Releases 下载最新的部署文件：

```bash
# 下载最新版本的部署文件
wget https://github.com/your-username/PixiShelf/releases/latest/download/docker-compose.deploy.yml
wget https://github.com/your-username/PixiShelf/releases/latest/download/.env.example
wget https://github.com/your-username/PixiShelf/releases/latest/download/init.sql
wget https://github.com/your-username/PixiShelf/releases/latest/download/DEPLOYMENT.md
```

或者克隆仓库：

```bash
git clone https://github.com/your-username/PixiShelf.git
cd PixiShelf/build
```

### 3. 配置环境变量

```bash
# 复制环境配置模板
cp .env.example .env

# 编辑配置文件
nano .env
```

**重要配置项：**

```bash
# 安全配置 (必须修改)
POSTGRES_PASSWORD=your-secure-password
JWT_SECRET=your-jwt-secret-32-chars-min

```

### 4. 部署应用

```bash
# 拉取最新镜像并启动服务
docker-compose -f docker-compose.deploy.yml pull
docker-compose -f docker-compose.deploy.yml up -d

# 查看服务状态
docker-compose -f docker-compose.deploy.yml ps

# 查看日志
docker-compose -f docker-compose.deploy.yml logs -f
```

### 5. 验证部署

```bash
# 检查服务健康状态
curl http://localhost:5431/api/health
curl http://localhost/health

# 访问Web界面
open http://localhost
```

---

## 🔄 CI/CD 流程

### GitHub Actions 自动构建

项目配置了完整的 CI/CD 流水线：

1. **触发构建**：推送版本标签 (如 `v1.0.0`)
2. **自动构建**：构建 API 和 Web 镜像
3. **多平台支持**：支持 linux/amd64 和 linux/arm64
4. **双重发布**：同时发布到 GitHub Container Registry 和 Docker Hub
5. **安全扫描**：自动进行漏洞扫描
6. **创建 Release**：自动创建 GitHub Release 并附带部署文件

### 发布新版本

```bash
# 创建并推送版本标签
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions 会自动构建并发布镜像
```

### 更新生产环境

```bash
# 更新到最新版本
docker-compose -f docker-compose.deploy.yml pull
docker-compose -f docker-compose.deploy.yml up -d

# 或更新到指定版本
echo "IMAGE_TAG=v1.0.0" >> .env
docker-compose -f docker-compose.deploy.yml pull
docker-compose -f docker-compose.deploy.yml up -d
```

---

## 🚀 方式二：本地构建部署

### 1. 环境准备

确保你的服务器已安装：
- Docker (>= 20.0.0)
- Docker Compose (>= 2.0.0)

### 2. 克隆项目

```bash
git clone <repository-url>
cd PixiShelf
```

### 3. 配置环境变量

```bash
# 复制环境配置模板
cd build
cp .env.example .env

# 编辑配置文件
nano .env
```

**重要配置项：**
- `POSTGRES_PASSWORD`: 数据库密码（必须修改）
- `JWT_SECRET`: JWT密钥（必须修改，至少32字符）
- `INIT_ADMIN_PASSWORD`: 管理员密码（必须修改）

### 4. 部署应用

```bash
# 使用生产环境配置启动
docker-compose -f docker-compose.deploy.yml up -d

# 查看服务状态
docker-compose -f docker-compose.deploy.yml ps

# 查看日志
docker-compose -f docker-compose.deploy.yml logs -f
```

## 🔧 开发环境

### Vite 配置说明

开发环境的 Vite 配置已更新以支持动态 API URL：

```typescript
// packages/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5431',
        changeOrigin: true,
      },
    },
  },
})
```

### 开发环境启动

```bash
# 启动开发环境数据库
cd build
docker-compose -f docker-compose.dev.yml up -d postgres imgproxy thumbor

# 启动 Next.js 服务
cd ../packages/pixishelf
pnpm dev

# 启动Web服务
cd packages/web
VITE_API_URL=http://localhost:5431 pnpm dev
```

## 🐳 Docker 配置详解

### 多阶段构建

项目使用多阶段 Docker 构建：

1. **base**: Node.js 基础镜像
2. **deps**: 安装依赖
3. **api-build**: 构建 API 服务
4. **web-build**: 构建 Web 应用
5. **api**: API 生产镜像
6. **web**: Web 生产镜像（Nginx）

### 构建参数

```bash
# 自定义 API URL 构建 Web 镜像
docker build --target web --build-arg VITE_API_URL=https://api.yourdomain.com .

# 构建 API 镜像
docker build --target api .
```


## 📁 目录结构

```
PixiShelf/
├── build/
│   ├── Dockerfile                 # 多阶段构建文件
│   ├── docker-compose.dev.yml     # 开发环境配置
│   ├── docker-compose.deploy.yml  # 生产环境配置
│   └── .env.example               # Docker Compose 环境变量模板
└── packages/
    └── pixishelf/                  # Next.js 应用
```

## 🔒 安全建议

### 1. 密码安全
- 修改所有默认密码
- 使用强密码（至少12位，包含大小写字母、数字、特殊字符）
- JWT_SECRET 至少32字符

### 2. 网络安全
- 使用防火墙限制端口访问
- 考虑使用 HTTPS（推荐使用 Let's Encrypt）
- 定期更新 Docker 镜像

### 3. 数据安全
- 定期备份数据库
- 图片目录使用只读挂载
- 启用日志轮转

## 🔄 更新部署

```bash
# 拉取最新代码
git pull

# 进入构建目录
cd build

# 开发环境默认只启动基础设施
docker-compose -f docker-compose.dev.yml up -d

# 如需调试容器化应用，再显式启用 container-app profile
docker-compose -f docker-compose.dev.yml --profile container-app up -d --build app

# 清理旧镜像
docker image prune -f
```

## 📊 监控和日志

### 查看日志
```bash
# 查看所有服务日志
docker-compose -f docker-compose.deploy.yml logs -f

# 查看特定服务日志
docker-compose -f docker-compose.deploy.yml logs -f app
docker-compose -f docker-compose.deploy.yml logs -f scheduler
```

### 健康检查
```bash
# 检查服务状态
curl http://localhost:5431/api/health
curl http://localhost/health
```

## 🆘 故障排除

### 常见问题

1. **API 连接失败**
   - 检查 `API_BASE_URL` 配置
   - 确认防火墙设置
   - 查看 API 服务日志

2. **数据库连接失败**
   - 检查数据库密码配置
   - 确认数据库服务状态
   - 查看数据库日志

3. **图片无法显示**
   - 确认目录权限
   - 验证图片文件路径

### 重置部署
```bash
# 停止所有服务
docker-compose -f docker-compose.deploy.yml down

# 删除数据卷（注意：会丢失数据）
docker volume rm build_postgres_data

# 重新启动
docker-compose -f docker-compose.deploy.yml up -d
```

## 📞 支持

如果遇到问题，请：
1. 查看日志文件
2. 检查配置文件
3. 参考故障排除部分
4. 提交 Issue 到项目仓库
