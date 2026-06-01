# Build 构建配置目录

本目录包含了 PixiShelf 项目的所有构建和部署相关配置文件。

## 📁 目录结构

```
build/
├── README.md                    # 本说明文件
├── .env.example                 # 环境变量配置模板
├── Dockerfile                   # Docker 多阶段构建文件
├── docker-compose.dev.yml       # 开发/本地构建用 Docker Compose
└── docker-compose.deploy.yml    # 生产部署用 Docker Compose (使用预构建镜像)
```

## 🔧 文件说明

### Dockerfile
- **用途**: 多阶段 Docker 构建文件
- **包含**: API 和 Web 两个构建目标
- **特性**: 支持多架构构建 (linux/amd64, linux/arm64)


### docker-compose.dev.yml
- **用途**: 开发环境基础设施
- **特点**: 默认只启动 PostgreSQL、ImgProxy、Thumbor；Next.js 应用通常在宿主机通过 `pnpm dev` 运行
- **适用**: 本机开发调试

### .env.example
- **用途**: 环境变量配置模板
- **特点**: 包含所有可配置项和详细说明
- **适用**: Docker 开发环境和生产部署的配置参考

### docker-compose.deploy.yml
- **用途**: 生产环境部署
- **特点**: 使用预构建镜像，默认加载 .env 文件
- **适用**: 快速部署、版本管理

## 🚀 使用方法

### 开发环境

```bash
# 进入 build 目录，让 Docker Compose 自动读取 build/.env
cd build
cp .env.example .env
# 编辑 .env，至少修改 PIXISHELF_DATA_PATH 和安全密钥
docker-compose -f docker-compose.dev.yml up -d

# 然后在另一个终端启动 Next.js
cd ../packages/pixishelf
cp .env.example .env.local
pnpm dev
```

如需调试容器化应用或 scheduler：

```bash
cd build
docker-compose -f docker-compose.dev.yml --profile container-app up -d --build app
docker-compose -f docker-compose.dev.yml --profile scheduler up -d scheduler
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
3. **环境变量**: Docker Compose 需要正确配置 `build/.env` 文件；本机运行 Next.js 使用 `packages/pixishelf/.env.local`
4. **网络配置**: 所有服务都在 `pixishelf-network` 网络中通信

## 🔄 CI/CD 集成

GitHub Actions 工作流会自动使用这些配置文件：
- 使用 `build/Dockerfile` 构建镜像
- 将 `build/docker-compose.deploy.yml` 发布到 Release

## 🛠️ 自定义配置

如需自定义配置，可以：
1. 修改相应的配置文件
2. 创建新的 docker-compose 文件用于特定环境
3. 通过环境变量覆盖默认设置

---

*将构建配置集中管理，让项目结构更加清晰和专业。*
