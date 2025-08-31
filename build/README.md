# Build 构建配置目录

本目录包含了 PixiShelf 项目的所有构建和部署相关配置文件。

## 📁 目录结构

```
build/
├── README.md                    # 本说明文件
├── .env.example                 # 环境变量配置模板
├── Dockerfile                   # Docker 多阶段构建文件
├── nginx.conf                   # Nginx 配置文件
├── docker-compose.yml           # 开发/本地构建用 Docker Compose
└── docker-compose.deploy.yml    # 生产部署用 Docker Compose (使用预构建镜像)
```

## 🔧 文件说明

### Dockerfile
- **用途**: 多阶段 Docker 构建文件
- **包含**: API 和 Web 两个构建目标
- **特性**: 支持多架构构建 (linux/amd64, linux/arm64)

### nginx.conf
- **用途**: Nginx 反向代理配置
- **功能**: 
  - 静态文件服务
  - API 请求代理
  - SPA 路由支持
  - Gzip 压缩
  - 安全头设置

### docker-compose.yml
- **用途**: 开发环境和本地构建
- **特点**: 从源码构建镜像
- **适用**: 开发调试、自定义构建

### .env.example
- **用途**: 环境变量配置模板
- **特点**: 包含所有可配置项和详细说明
- **适用**: 开发环境和生产部署的配置参考

### docker-compose.deploy.yml
- **用途**: 生产环境部署
- **特点**: 使用预构建镜像，默认加载 .env 文件
- **适用**: 快速部署、版本管理

## 🚀 使用方法

### 开发环境

```bash
# 从项目根目录运行
docker-compose -f build/docker-compose.yml up -d
```

### 生产部署

```bash
# 进入 build 目录
cd build

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 启动服务
docker-compose -f docker-compose.deploy.yml up -d
```

### 单独构建镜像

```bash
# 构建统一镜像（包含 Web + API）
docker build -f build/Dockerfile --target production -t pixishelf .

# 或者使用默认 target（production 是默认的）
docker build -f build/Dockerfile -t pixishelf .
```

## 📝 注意事项

1. **构建上下文**: 所有 Docker 构建都使用项目根目录作为构建上下文
2. **路径引用**: 配置文件中的路径都是相对于项目根目录
3. **环境变量**: 生产部署需要正确配置 `.env.deploy` 文件
4. **网络配置**: 所有服务都在 `pixishelf-network` 网络中通信

## 🔄 CI/CD 集成

GitHub Actions 工作流会自动使用这些配置文件：
- 使用 `build/Dockerfile` 构建镜像
- 将 `build/docker-compose.deploy.yml` 发布到 Release
- 支持多架构构建和安全扫描

## 🛠️ 自定义配置

如需自定义配置，可以：
1. 修改相应的配置文件
2. 创建新的 docker-compose 文件用于特定环境
3. 通过环境变量覆盖默认设置

---

*将构建配置集中管理，让项目结构更加清晰和专业。*