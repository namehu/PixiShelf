# Base image for Node.js
FROM node:18-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@8

# Dependencies stage
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/*/package.json ./packages/*/
RUN pnpm install --frozen-lockfile

# Build stage for API
FROM base AS api-build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm build --filter=api

# Build stage for Web
FROM base AS web-build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
# 设置构建时的API URL
ARG VITE_API_URL=http://localhost:3002
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build --filter=web

# Production API stage
FROM node:18-alpine AS api
WORKDIR /app
RUN npm install -g pnpm@8

# 复制构建产物和必要文件
COPY --from=api-build /app/packages/api/dist ./
COPY --from=api-build /app/packages/api/package.json ./package.json
COPY --from=api-build /app/packages/api/prisma ./prisma

# 安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 生成Prisma客户端
RUN npx prisma generate

EXPOSE 3002
CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]

# Production Web stage
FROM nginx:alpine AS web
COPY --from=web-build /app/packages/web/dist /usr/share/nginx/html
COPY build/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]