# =========================================================================
# 1. Builder Stage - 构建阶段
#    - 负责安装所有依赖（包括开发依赖），并构建前端项目。
# =========================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# 安装必要的系统依赖和 pnpm
RUN apk add --no-cache \
    openssl \
    openssl-dev \
    supervisor \
    && npm install -g pnpm@8.15.1

# 设置国内npm源 (可以加速构建)
RUN npm config set registry https://registry.npmmirror.com

# 优化缓存：只复制构建依赖所需的文件
# 只有当这些文件变化时，才会重新执行 `pnpm install`
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/ ./packages/shared/
# 复制所有源代码
COPY packages/pixishelf/ ./packages/pixishelf/

# 安装所有依赖（包括 devDependencies 用于构建）
# 使用 --frozen-lockfile 确保CI/CD环境的一致性
RUN pnpm install --frozen-lockfile

# 显式生成 Prisma Client (比依赖 postinstall 更可靠)
RUN pnpm --filter="@pixishelf/next" db:generate

# 构建 PixiShelf 前端项目
RUN pnpm --filter="@pixishelf/next" build

# =========================================================================
# 2. Production Stage - 生产阶段
#    - 使用一个全新的、干净的 alpine 镜像。
#    - 只从 builder 阶段复制构建产物和生产依赖。
# =========================================================================
FROM node:20-alpine AS production

WORKDIR /app

# 安装必要的系统依赖和 pnpm
RUN apk add --no-cache \
    openssl \
    openssl-dev \
    supervisor \
    && npm install -g pnpm@8.15.1

# 设置环境变量，`DATABASE_URL` 的值将由 `ARG` 或 `docker run -e` 提供
ENV NODE_ENV=production

# 优化缓存：先复制 package.json 文件并安装生产依赖
COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/pixishelf/package.json ./packages/pixishelf/

# 只安装生产依赖
RUN npm config set registry https://registry.npmmirror.com && \
    pnpm install --prod --ignore-scripts

# 从 builder 阶段复制构建好的 Next.js 应用
COPY --from=builder /app/packages/pixishelf/.next ./packages/pixishelf/.next
COPY --from=builder /app/packages/pixishelf/public ./packages/pixishelf/public
COPY --from=builder /app/packages/pixishelf/package.json ./packages/pixishelf/package.json
COPY --from=builder /app/packages/pixishelf/prisma/generated ./packages/pixishelf/prisma/generated


# 复制 shared 包（如果它有运行时需要的文件）和 prisma schema
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/pixishelf/prisma ./packages/pixishelf/prisma

# 创建 supervisor 配置和日志目录
RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor
COPY <<EOF /etc/supervisor/conf.d/supervisord.conf
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:pixishelf]
command=pnpm --filter="@pixishelf/next" start
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
stderr_logfile=/var/log/supervisor/pixishelf.err.log
stdout_logfile=/var/log/supervisor/pixishelf.out.log
environment=NODE_ENV="production"

[program:prisma-studio]
command=sh -c "pnpm --filter='@pixishelf/next' db:deploy && pnpm --filter='@pixishelf/next' db:studio --port 5555 --browser none"
directory=/app
autostart=true
autorestart=true
stopwaitsecs=3
stderr_logfile=/var/log/supervisor/prisma-studio.err.log
stdout_logfile=/var/log/supervisor/prisma-studio.out.log
EOF

# 暴露端口
EXPOSE 3000 5555

# 健康检查 - 检查前端和Prisma Studio
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000 && \
    wget --no-verbose --tries=1 --spider http://localhost:5555 || exit 1

# 启动 supervisor 管理多个服务
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

