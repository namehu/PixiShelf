# GitHub Actions CI/CD 配置指南

本文档说明如何配置 GitHub Actions 来自动构建和发布 PixiShelf 的 Docker 镜像。

## 🔧 必需的 Secrets 配置

在 GitHub 仓库的 Settings > Secrets and variables > Actions 中添加以下 secrets：

### Docker Hub 配置 (可选)

如果要发布到 Docker Hub，需要配置：

- `DOCKERHUB_USERNAME`: 你的 Docker Hub 用户名
- `DOCKERHUB_TOKEN`: Docker Hub 访问令牌

**获取 Docker Hub Token：**
1. 登录 [Docker Hub](https://hub.docker.com/)
2. 进入 Account Settings > Security
3. 点击 "New Access Token"
4. 创建一个具有 Read, Write, Delete 权限的 token

### GitHub Container Registry

GitHub Container Registry 使用内置的 `GITHUB_TOKEN`，无需额外配置。

## 🌍 环境变量配置

在 Settings > Secrets and variables > Actions > Variables 中添加：

- `VITE_API_URL`: 前端构建时的 API URL (可选，默认为 http://localhost:3002)

## 🚀 触发构建

### 自动触发

当推送版本标签时自动触发构建：

```bash
# 创建并推送版本标签
git tag v1.0.0
git push origin v1.0.0
```

### 手动触发

1. 进入 GitHub 仓库的 Actions 页面
2. 选择 "Build and Deploy" workflow
3. 点击 "Run workflow" 按钮

## 📦 构建产物

成功构建后，会生成以下 Docker 镜像：

### GitHub Container Registry
- `ghcr.io/your-username/pixishelf-api:latest`
- `ghcr.io/your-username/pixishelf-api:v1.0.0`
- `ghcr.io/your-username/pixishelf-web:latest`
- `ghcr.io/your-username/pixishelf-web:v1.0.0`

### Docker Hub (如果配置了)
- `your-username/pixishelf-api:latest`
- `your-username/pixishelf-api:v1.0.0`
- `your-username/pixishelf-web:latest`
- `your-username/pixishelf-web:v1.0.0`

## 🔒 镜像权限

### GitHub Container Registry

默认情况下，GHCR 镜像是私有的。要使其公开：

1. 进入 GitHub 个人资料页面
2. 点击 "Packages" 标签
3. 选择相应的包
4. 进入 "Package settings"
5. 在 "Danger Zone" 中点击 "Change visibility"
6. 选择 "Public"

## 📋 Workflow 功能

当前的 GitHub Actions workflow 包含以下功能：

- ✅ 多架构构建 (linux/amd64, linux/arm64)
- ✅ 同时发布到 GitHub Container Registry 和 Docker Hub
- ✅ 自动版本标签管理
- ✅ 构建缓存优化
- ✅ 安全漏洞扫描
- ✅ 自动创建 GitHub Release
- ✅ 发布部署文件到 Release

## 🛠️ 自定义配置

### 修改构建参数

编辑 `.github/workflows/build-and-deploy.yml` 文件：

```yaml
# 修改支持的架构
platforms: linux/amd64,linux/arm64,linux/arm/v7

# 修改构建参数
build-args: |
  VITE_API_URL=https://api.yourdomain.com
  NODE_ENV=production
```

### 添加环境特定的构建

可以为不同环境创建不同的 workflow：

- `.github/workflows/build-staging.yml` - 测试环境
- `.github/workflows/build-production.yml` - 生产环境

## 🔍 故障排除

### 常见问题

1. **构建失败：权限不足**
   - 确保 GITHUB_TOKEN 有 packages:write 权限
   - 检查仓库的 Actions 权限设置

2. **Docker Hub 推送失败**
   - 验证 DOCKERHUB_USERNAME 和 DOCKERHUB_TOKEN
   - 确保 Docker Hub 仓库存在且有推送权限

3. **多架构构建失败**
   - 检查依赖是否支持目标架构
   - 可以临时移除不支持的架构

### 查看构建日志

1. 进入 GitHub 仓库的 Actions 页面
2. 选择失败的 workflow run
3. 展开相应的步骤查看详细日志

## 📚 相关文档

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [GitHub Container Registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Hub 文档](https://docs.docker.com/docker-hub/)
- [Docker Buildx 文档](https://docs.docker.com/buildx/)