FROM node:22

# 设置UTF-8编码环境
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV LANGUAGE=C.UTF-8

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    build-essential \
    python3 \
    python3-pip \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 生成UTF-8 locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen

# 安装全局npm包
RUN npm install -g pnpm@8 typescript ts-node nodemon

# 创建应用目录
RUN mkdir -p /app/data
RUN chown -R node:node /app

# 设置工作目录
WORKDIR /workspace

# 切换到node用户
USER node

# 暴露端口
EXPOSE 5430 5431

CMD ["bash"]
