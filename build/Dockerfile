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
COPY packages/pixishelf/package.json ./packages/pixishelf/package.json

# 安装所有依赖（包括 devDependencies 用于构建）
# 使用 --frozen-lockfile 确保CI/CD环境的一致性
RUN pnpm install --frozen-lockfile

# 复制所有源代码 (利用 .dockerignore 避免复制无关文件)
COPY packages/pixishelf/ ./packages/pixishelf/

# 按依赖顺序构建项目
# 1. 生成 Prisma Client
RUN pnpm --filter="@pixishelf/next" db:generate
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
# wget 用于 HEALTHCHECK, dcron 用于定时任务
RUN apk add --no-cache \
    openssl \
    supervisor \
    wget \
    dcron \
    && npm install -g tsx@^4.19.2 \
    && npm install -g pnpm@${PNPM_VERSION} \
    && rm -rf /var/cache/apk/*

# 设置环境变量
ENV NODE_ENV=production

# 设置国内npm源
RUN pnpm config set registry ${REGISTRY_URL}

# 优化缓存：先复制 package.json 文件并安装生产依赖
COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
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
# 复制脚本文件
COPY --from=builder --chown=appuser:appgroup /app/packages/pixishelf/scripts ./packages/pixishelf/scripts


# 创建 supervisor 配置和日志目录
RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor

# 创建定时任务脚本
COPY <<EOF /app/run-tag-stats.sh
#!/bin/sh
set -e
echo "[\$(date)] Starting tag artwork count update..."
cd /app
pnpm --filter="@pixishelf/next" exec tsx scripts/init-tag-artwork-count.ts
echo "[\$(date)] Tag artwork count update completed."
EOF

# 创建crontab文件 - 每天凌晨2点执行
COPY <<EOF /etc/crontabs/appuser
# 每天凌晨2点执行标签统计更新
0 2 * * * /app/run-tag-stats.sh >> /var/log/tag-stats.log 2>&1
EOF

# 设置脚本权限
RUN chmod +x /app/run-tag-stats.sh && \
    chown appuser:appgroup /app/run-tag-stats.sh && \
    chown appuser:appgroup /etc/crontabs/appuser && \
    chmod 600 /etc/crontabs/appuser

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

[program:crond]
command=/usr/sbin/crond -f -l 2
user=root
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
EOF

# 复制 entrypoint 脚本并赋予执行权限
COPY --chown=appuser:appgroup build/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 暴露端口
EXPOSE 5430

# 健康检查 - 检查前端
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5430 || exit 1

# 推荐：使用 entrypoint 脚本来处理数据库迁移
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
