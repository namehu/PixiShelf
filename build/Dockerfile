# =========================================================================
# 1. Builder Stage - 构建阶段
#    - 负责安装所有依赖（包括开发依赖），并构建前端项目。
# =========================================================================
FROM node:20-alpine AS builder

# -- Global ARGs
ARG PNPM_VERSION=8.15.1
ARG REGISTRY_URL=https://registry.npmmirror.com


WORKDIR /app

# 安装 pnpm 和构建时所需的系统依赖
# 清理 apk 缓存以减小镜像层体积
RUN apk add --no-cache \
    openssl \
    openssl-dev \
    && npm install -g pnpm@${PNPM_VERSION} \
    && rm -rf /var/cache/apk/*

# 设置国内npm源 (可以加速构建)
RUN pnpm config set registry ${REGISTRY_URL}

# 优化缓存：只复制构建依赖所需的文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/pixishelf/package.json ./packages/pixishelf/package.json

# 安装所有依赖（包括 devDependencies 用于构建）
# 使用 --frozen-lockfile 确保CI/CD环境的一致性
RUN pnpm install --frozen-lockfile

# 复制所有源代码 (利用 .dockerignore 避免复制无关文件)
# 分两步复制，以更好地利用缓存
COPY packages/shared/ ./packages/shared/
COPY packages/pixishelf/ ./packages/pixishelf/

# 按依赖顺序构建项目
# 1. 生成 Prisma Client
RUN pnpm --filter="@pixishelf/next" db:generate
# 2. 构建 shared 包
RUN pnpm --filter="@pixishelf/shared" build
# 3. 构建主应用
RUN pnpm --filter="@pixishelf/next" build

# =========================================================================
# 2. Production Stage - 生产阶段
#    - 使用一个全新的、干净的 alpine 镜像。
#    - 只从 builder 阶段复制构建产物和生产依赖。
# =========================================================================
FROM node:20-alpine AS production

# -- Global ARGs
ARG PNPM_VERSION=8.15.1
ARG REGISTRY_URL=https://registry.npmmirror.com

WORKDIR /app

# 为应用创建一个非 root 用户和组
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 安装 pnpm 和生产运行时所需的系统依赖
# wget 用于 HEALTHCHECK
RUN apk add --no-cache \
    openssl \
    supervisor \
    wget \
    && npm install -g pnpm@${PNPM_VERSION} \
    && rm -rf /var/cache/apk/*

# 设置环境变量
ENV NODE_ENV=production

# 设置国内npm源
RUN pnpm config set registry ${REGISTRY_URL}

# 优化缓存：先复制 package.json 文件并安装生产依赖
COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/pixishelf/package.json ./packages/pixishelf/package.json

# 只安装生产依赖
# 使用 --frozen-lockfile 保证依赖一致性
RUN pnpm install --prod --frozen-lockfile


# 从 builder 阶段复制构建好的产物
# --chown=appuser:appgroup 确保文件所有权正确
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/.next ./packages/pixishelf/.next
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/public ./packages/pixishelf/public
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/package.json ./packages/pixishelf/package.json
# 复制 Prisma Client 和 schema
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/prisma ./packages/pixishelf/prisma

# 复制 shared 包的运行时文件（假设在 dist 目录）和 package.json
COPY --from=builder --chown=appuser:appgroup /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=appuser:appgroup /app/packages/shared/dist ./packages/shared/dist


# 创建 supervisor 配置和日志目录
RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor

COPY <<EOF /etc/supervisor/supervisord.conf
[supervisord]
nodaemon=true
user=appuser
logfile=/tmp/supervisord.log
pidfile=/tmp/supervisord.pid

[program:pixishelf]
command=pnpm --filter="@pixishelf/next" start
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
# 将日志重定向到标准输出/错误，这是容器日志管理的最佳实践
stderr_logfile=/dev/stderr
stdout_logfile=/dev/stdout
environment=NODE_ENV="production"

[program:prisma-studio]
# 使用 --host 0.0.0.0 使其在容器内监听所有网络接口
command=pnpm --filter="@pixishelf/next" db:studio --port 5555 --host 0.0.0.0 --browser none
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
stderr_logfile=/dev/stderr
stdout_logfile=/dev/stdout
EOF

# 复制 entrypoint 脚本并赋予执行权限
COPY --chown=appuser:appgroup build/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3000 5555

# 健康检查 - 检查前端和Prisma Studio
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000 && \
    wget --no-verbose --tries=1 --spider http://localhost:5555 || exit 1

# 推荐：使用 entrypoint 脚本来处理数据库迁移
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
