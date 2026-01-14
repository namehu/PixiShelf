# =========================================================================
# 1. Builder Stage - 构建阶段
#    - 负责安装所有依赖（包括开发依赖），并构建前端项目。
# =========================================================================
FROM node:20-alpine AS builder

# -- Global ARGs
ARG PNPM_VERSION=8.15.1
ARG REGISTRY_URL=https://registry.npmmirror.com

# 设置占位符
ENV NEXT_PUBLIC_IMGPROXY_URL=__NEXT_PUBLIC_IMGPROXY_URL__
ENV NEXT_PUBLIC_THUMBOR_VIDEO_URL=__NEXT_PUBLIC_THUMBOR_VIDEO_URL__

# 应用版本号 (构建时注入)
ARG APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}



ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# 安装 pnpm 和构建时所需的系统依赖
# 使用缓存挂载加速 apk 安装
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache \
    openssl \
    openssl-dev \
    && npm install -g pnpm@${PNPM_VERSION}

# 设置国内npm源 (可以加速构建)
# 配置 pnpm store 目录
RUN pnpm config set registry ${REGISTRY_URL} && \
    pnpm config set store-dir /pnpm/store

# 优化缓存：只复制构建依赖所需的文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/pixishelf/package.json ./packages/pixishelf/package.json

# 安装所有依赖（包括 devDependencies 用于构建）
# 使用 --frozen-lockfile 确保CI/CD环境的一致性
# 使用缓存挂载加速 pnpm install
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# 复制所有源代码 (利用 .dockerignore 避免复制无关文件)
COPY packages/pixishelf/ ./packages/pixishelf/

# 按依赖顺序构建项目
# 1. 生成 Prisma Client
RUN pnpm --filter="@pixishelf/next" db:generate
# 3. 构建主应用
# 使用缓存挂载加速 Next.js 构建
RUN --mount=type=cache,target=/app/packages/pixishelf/.next/cache \
    pnpm --filter="@pixishelf/next" build

# =========================================================================
# 2. Production Stage - 生产阶段
#    - 使用一个全新的、干净的 alpine 镜像。
#    - 只从 builder 阶段复制构建产物和生产依赖。
# =========================================================================
FROM node:20-alpine AS production

# -- Global ARGs
ARG PNPM_VERSION=8.15.1
ARG REGISTRY_URL=https://registry.npmmirror.com

# 设置 PNPM 环境变量
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# 为应用创建一个非 root 用户和组
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 安装 pnpm 和生产运行时所需的系统依赖
# curl 用于 HEALTHCHECK
# 使用缓存挂载加速 apk 安装
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache \
    openssl \
    supervisor \
    curl \
    && npm install -g tsx@^4.19.2 \
    && npm install -g pnpm@${PNPM_VERSION}

# 设置环境变量
ENV NODE_ENV=production

# 设置国内npm源
# 配置 pnpm store 目录
RUN pnpm config set registry ${REGISTRY_URL} && \
    pnpm config set store-dir /pnpm/store

# 优化缓存：先复制 package.json 文件并安装生产依赖
COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/pixishelf/package.json ./packages/pixishelf/package.json

# 只安装生产依赖
# 使用 --frozen-lockfile 保证依赖一致性
# 使用缓存挂载加速 pnpm install
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# 复制 Prisma schema 并 生成 Prisma Client
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/prisma ./packages/pixishelf/prisma
RUN pnpm --filter="@pixishelf/next" db:generate

# 从 builder 阶段复制构建好的产物
# --chown=appuser:appgroup 确保文件所有权正确
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/.next ./packages/pixishelf/.next
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/public ./packages/pixishelf/public
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/lib ./packages/pixishelf/lib
# 复制脚本文件
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/scripts ./packages/pixishelf/scripts

# 创建 supervisor 配置和日志目录
RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor

COPY <<EOF /etc/supervisor/supervisord.conf
[supervisord]
nodaemon=true
logfile=/tmp/supervisord.log
pidfile=/tmp/supervisord.pid

[program:pixishelf]
command=pnpm --filter="@pixishelf/next" start
user=appuser
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
# 将日志重定向到标准输出/错误，这是容器日志管理的最佳实践
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
environment=NODE_ENV="production",HOME="/home/appuser",USER="appuser"
EOF

# 复制 entrypoint 脚本并赋予执行权限
COPY --chown=appuser:appgroup build/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 暴露端口
EXPOSE 5430

# 健康检查 - 检查前端
# HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
# CMD wget --no-verbose --tries=1 --spider http://localhost:5430 || exit 1
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5430/ || exit 1

# 推荐：使用 entrypoint 脚本来处理数据库迁移
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
