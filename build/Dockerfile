# Production unified stage - 单一容器包含 API + Web (Nginx)
FROM node:22-alpine AS production
WORKDIR /app

# 安装必要的系统依赖：Node.js运行时、Nginx、OpenSSL、进程管理工具
RUN apk add --no-cache \
    openssl \
    openssl-dev \
    nginx \
    supervisor \
    && npm install -g pnpm@8

# 复制所有源代码和配置文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/

# 设置国内npm 源
RUN npm config set registry https://registry.npmmirror.com

# 安装所有依赖（shared包会在postinstall中自动构建）
RUN pnpm install

# 构建API和Web包
RUN pnpm --filter="@pixishelf/api" build

# 设置构建时的API URL - 在单一容器中API通过localhost访问
ARG VITE_API_URL=http://localhost:5431
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter="@pixishelf/web" build

# 生成 Prisma 客户端
# WORKDIR /app/packages/api
# RUN npx prisma generate
# WORKDIR /app

# 复制Web构建产物到Nginx目录
RUN mkdir -p /usr/share/nginx/html && cp -r ./packages/web/dist/* /usr/share/nginx/html/

# 清理开发依赖，只保留生产依赖
RUN pnpm install --prod --ignore-scripts

# 复制并修改Nginx配置以适应单一容器
COPY build/nginx.conf /etc/nginx/nginx.conf

# 创建supervisor配置目录
RUN mkdir -p /etc/supervisor/conf.d

# 创建supervisor配置文件来管理API、Nginx和Prisma Studio进程
RUN echo '[supervisord]' > /etc/supervisor/conf.d/supervisord.conf && \
    echo 'nodaemon=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'user=root' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:api]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=sh -c "cd /app/packages/api && pnpm db:deploy && node dist/index.js"' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'directory=/app/packages/api' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stderr_logfile=/var/log/api.err.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stdout_logfile=/var/log/api.out.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:prisma-studio]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=sh -c "cd /app/packages/api && sleep 10 && npx prisma studio --hostname 0.0.0.0 --port 5555"' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'directory=/app/packages/api' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stderr_logfile=/var/log/prisma-studio.err.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stdout_logfile=/var/log/prisma-studio.out.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:nginx]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=nginx -g "daemon off;"' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stderr_logfile=/var/log/nginx.err.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stdout_logfile=/var/log/nginx.out.log' >> /etc/supervisor/conf.d/supervisord.conf

# 创建必要的目录和设置权限
RUN mkdir -p /var/log/nginx /var/lib/nginx /var/tmp/nginx && \
    mkdir -p /app/data && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx /var/tmp/nginx && \
    chown -R node:node /app

# 暴露端口：80 (Nginx), 5431 (API - 内部使用), 5555 (Prisma Studio)
EXPOSE 80 5555

# 健康检查 - 检查Nginx和API服务
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health && \
    wget --no-verbose --tries=1 --spider http://localhost/api/v1/health || exit 1

# 使用supervisor启动所有服务
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
