# Docker 生产环境部署指南

本指南详细说明如何在生产环境中部署 PixiShelf，包括新的配置系统的使用方法。

## 概述

PixiShelf 现在包含了一个强大的配置系统，支持：
- 多源配置加载（环境变量、配置文件、Docker secrets）
- 类型安全的配置访问
- 实时配置验证
- Docker 环境优化

## 快速开始

### 1. 准备配置文件

```bash
# 复制环境变量模板
cp build/.env.example .env

# 编辑配置文件
vim .env
```

### 2. 配置必需的环境变量

```bash
# 数据库配置
POSTGRES_USER=pixishelf
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=pixishelf

# 安全配置
JWT_SECRET=your-very-secure-jwt-secret-key-here-at-least-32-characters

# 管理员账户
INIT_ADMIN_USERNAME=admin
INIT_ADMIN_PASSWORD=your-admin-password

# 文件路径
SCAN_PATH=/path/to/your/artwork/directory

# Docker 镜像配置
DOCKER_REGISTRY=ghcr.io
DOCKER_USERNAME=your-github-username
IMAGE_NAME=pixishelf
IMAGE_TAG=latest
```

### 3. 启动服务

```bash
# 使用 Docker Compose 启动
docker-compose -f build/docker-compose.deploy.yml up -d
```

## 配置系统详解

### 环境变量优先级

配置系统按以下优先级加载配置：

1. **Docker Secrets** (`/run/secrets/`)
2. **环境变量** (系统环境变量)
3. **配置文件** (`/app/config/.env`, `/app/.env`)
4. **默认值** (代码中定义的默认值)

### 支持的配置项

#### 基础应用配置
- `NODE_ENV`: 运行环境 (development/production/test)
- `APP_NAME`: 应用名称
- `APP_VERSION`: 应用版本

#### 数据库配置
- `DATABASE_URL`: 数据库连接字符串
- `DATABASE_CONNECTION_LIMIT`: 连接池大小 (默认: 20)
- `DATABASE_CONNECTION_TIMEOUT`: 连接超时 (默认: 30000ms)
- `DATABASE_QUERY_TIMEOUT`: 查询超时 (默认: 60000ms)
- `DATABASE_ENABLE_QUERY_LOGGING`: 查询日志 (默认: false)

#### 服务器配置
- `PORT`: 服务端口 (默认: 3002)
- `HOST`: 绑定地址 (默认: 0.0.0.0)
- `ENABLE_CORS`: 启用 CORS (默认: true)
- `BODY_LIMIT`: 请求体大小限制 (默认: 10mb)
- `ENABLE_REQUEST_LOGGING`: 请求日志 (默认: true)

#### 认证配置
- `JWT_SECRET`: JWT 密钥 (必需，至少32字符)
- `JWT_EXPIRES_IN`: JWT 过期时间 (默认: 7d)
- `ENABLE_AUTH`: 启用认证 (默认: false)
- `BCRYPT_ROUNDS`: 密码加密轮数 (默认: 12)

#### 扫描器配置
- `SCANNER_ENABLE_OPTIMIZATIONS`: 启用优化 (默认: true)
- `SCANNER_MAX_CONCURRENCY`: 最大并发数 (默认: 8)
- `SCANNER_BATCH_SIZE`: 批处理大小 (默认: 500)
- `SCANNER_CACHE_SIZE_LIMIT`: 缓存大小限制 (默认: 10000)
- `SCANNER_ENABLE_PERFORMANCE_LOGGING`: 性能日志 (默认: false)
- `SCANNER_PERFORMANCE_LOG_INTERVAL`: 性能日志间隔 (默认: 5000ms)

#### 日志配置
- `LOG_LEVEL`: 日志级别 (debug/info/warn/error)
- `LOG_ENABLE_FILE_LOGGING`: 文件日志 (默认: false)
- `LOG_FILE_PATH`: 日志文件路径
- `LOG_ENABLE_STRUCTURED_LOGGING`: 结构化日志 (默认: true)
- `LOG_FORMAT`: 日志格式 (json/pretty)

#### 监控配置
- `MONITORING_ENABLED`: 启用监控 (默认: false)
- `MONITORING_METRICS_PORT`: 指标端口
- `MONITORING_HEALTH_CHECK_INTERVAL`: 健康检查间隔 (默认: 30000ms)

## Docker 部署

### 使用预构建镜像

```bash
# 拉取最新镜像
docker pull ghcr.io/your-username/pixishelf-api:latest
docker pull ghcr.io/your-username/pixishelf-web:latest

# 启动服务
docker-compose -f build/docker-compose.deploy.yml up -d
```

### 自定义构建

```bash
# 构建镜像
docker-compose -f build/docker-compose.yml build

# 启动服务
docker-compose -f build/docker-compose.yml up -d
```

## 配置验证

### 验证配置

```bash
# 在容器中验证配置
docker exec pixishelf-api npm run config:validate-docker

# 检查配置健康状态
docker exec pixishelf-api npm run config:health

# 查看当前配置
docker exec pixishelf-api npm run config:show
```

### 查看容器日志

```bash
# 查看 API 容器日志
docker logs pixishelf-api

# 查看数据库容器日志
docker logs pixishelf-db

# 查看 Web 容器日志
docker logs pixishelf-web
```

## 安全最佳实践

### 1. 使用 Docker Secrets

```bash
# 创建 secrets
echo "your-jwt-secret" | docker secret create jwt_secret -
echo "your-db-password" | docker secret create postgres_password -

# 在 docker-compose.yml 中使用
secrets:
  - jwt_secret
  - postgres_password
```

### 2. 环境变量安全

- 不要在代码中硬编码敏感信息
- 使用强密码和密钥
- 定期轮换密钥
- 限制容器权限

### 3. 网络安全

```yaml
# 使用自定义网络
networks:
  pixishelf-network:
    driver: bridge
    internal: true  # 内部网络
```

## 故障排除

### 常见问题

#### 1. 配置加载失败

```bash
# 检查环境变量
docker exec pixishelf-api env | grep -E "(DATABASE|JWT|SCAN)"

# 验证配置
docker exec pixishelf-api npm run config:validate-docker
```

#### 2. 数据库连接失败

```bash
# 检查数据库状态
docker exec pixishelf-db pg_isready -U pixishelf

# 检查网络连接
docker exec pixishelf-api nc -z postgres 5432
```

#### 3. 文件扫描问题

```bash
# 检查挂载路径
docker exec pixishelf-api ls -la /app/data

# 检查权限
docker exec pixishelf-api stat /app/data
```

### 日志分析

```bash
# 查看配置加载日志
docker logs pixishelf-api 2>&1 | grep -i "config"

# 查看错误日志
docker logs pixishelf-api 2>&1 | grep -i "error"

# 实时监控日志
docker logs -f pixishelf-api
```

## 性能优化

### 1. 扫描器优化

```bash
# 调整并发数
SCANNER_MAX_CONCURRENCY=16

# 调整批处理大小
SCANNER_BATCH_SIZE=1000

# 启用性能日志
SCANNER_ENABLE_PERFORMANCE_LOGGING=true
```

### 2. 数据库优化

```bash
# 增加连接池
DATABASE_CONNECTION_LIMIT=50

# 调整超时
DATABASE_QUERY_TIMEOUT=120000
```

### 3. 内存优化

```yaml
# 在 docker-compose.yml 中设置内存限制
services:
  api:
    mem_limit: 2g
    memswap_limit: 2g
```

## 监控和维护

### 健康检查

```bash
# 检查服务状态
curl http://localhost:3002/api/v1/health

# 检查配置健康
docker exec pixishelf-api npm run config:health
```

### 备份

```bash
# 备份数据库
docker exec pixishelf-db pg_dump -U pixishelf pixishelf > backup.sql

# 备份配置
cp .env .env.backup
```

### 更新

```bash
# 拉取新镜像
docker-compose -f build/docker-compose.deploy.yml pull

# 重启服务
docker-compose -f build/docker-compose.deploy.yml up -d
```

## 相关文档

- [配置系统文档](./config-usage-examples.md)
- [配置系统架构](./scanner_performance/CONFIG_SYSTEM.md)
- [部署文档](../DEPLOYMENT.md)
- [API 文档](./doc.md)