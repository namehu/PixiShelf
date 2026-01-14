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
#    - 使用 Standalone 模式，大幅减小镜像体积
# =========================================================================
FROM node:20-alpine AS production

WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
# 对应 next.config.js 中的 output: 'standalone'
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 安装 curl 用于健康检查，安装 prisma 用于数据库迁移
# 注意：Standalone 模式下，node_modules 可能不包含 prisma CLI，因此我们全局安装它
# 移除 build-base 等不必要的构建工具
RUN apk add --no-cache curl \
    && npm install -g prisma@5.22.0

# 复制 Prisma Schema (用于迁移)
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/prisma ./packages/pixishelf/prisma

# 复制 public 文件夹 (注意 monorepo 路径)
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/public ./packages/pixishelf/public

# 关键：复制 Standalone 构建产物
# Standalone 文件夹结构会自动包含 monorepo 的结构 (packages/pixishelf/...)
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/.next/static ./packages/pixishelf/.next/static

# 复制 lib 和 scripts 文件夹 (用户自定义需求)
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/lib ./packages/pixishelf/lib
COPY --from=builder --chown=nextjs:nodejs /app/packages/pixishelf/scripts ./packages/pixishelf/scripts

# 复制 entrypoint 脚本并赋予执行权限
COPY --chown=nextjs:nodejs build/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 切换用户
USER nextjs

EXPOSE 5430

ENV PORT=5430
# 必须设置 HOSTname，否则 standalone 模式在某些容器网络下无法访问
ENV HOSTNAME="0.0.0.0"

# 健康检查
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5430/ || exit 1

# 使用 entrypoint 处理迁移和环境变量替换
ENTRYPOINT ["/app/entrypoint.sh"]

# 启动命令 (Standalone 模式下直接运行 server.js)
CMD ["node", "packages/pixishelf/server.js"]
