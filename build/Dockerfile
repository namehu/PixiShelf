# Base image for Node.js
FROM node:18-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@8

# Dependencies stage - 利用Docker缓存优化
FROM base AS deps
# 先复制package管理文件以利用Docker缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
# 仅复制各子包的 package.json 以最大化缓存命中
RUN mkdir -p packages/api packages/web packages/shared
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# 安装所有依赖
RUN pnpm install --frozen-lockfile

# Source stage - 复制源代码
FROM deps AS source
COPY packages/ ./packages/

# Build stage for shared package - 独立构建共享包
FROM source AS shared-build
RUN pnpm --filter="@pixishelf/shared" build

# Build stage for API
FROM shared-build AS api-build
# 构建API，依赖shared包
RUN pnpm --filter="@pixishelf/api" build

# Build stage for Web
FROM shared-build AS web-build
# 设置构建时的API URL
ARG VITE_API_URL=http://localhost:3002
ENV VITE_API_URL=$VITE_API_URL
# 构建Web应用，依赖shared包
RUN pnpm --filter="@pixishelf/web" build

# Production API stage - 最小化生产镜像
FROM node:18-alpine AS api
WORKDIR /app
RUN npm install -g pnpm@8

# 复制必要的配置文件
COPY package.json pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

# 仅安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 复制构建产物
COPY --from=api-build /app/packages/api/dist ./packages/api/dist
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=api-build /app/packages/api/prisma ./packages/api/prisma

# 设置工作目录到API包
WORKDIR /app/packages/api

# 生成Prisma客户端
RUN npx prisma generate

EXPOSE 3002
# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD node -e "require('http').get('http://localhost:3002/api/v1/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

# Production Web stage - 使用Nginx服务静态文件
FROM nginx:alpine AS web
# 复制构建产物到Nginx目录
COPY --from=web-build /app/packages/web/dist /usr/share/nginx/html
# 复制Nginx配置
COPY build/nginx.conf /etc/nginx/nginx.conf

# 添加非root用户以提高安全性
RUN addgroup -g 1001 -S nodejs && \
	adduser -S nginx -u 1001 -G nodejs

EXPOSE 80
# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]