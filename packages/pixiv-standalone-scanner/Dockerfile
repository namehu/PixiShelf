# 阶段 1: 使用一个轻量的 Node.js 官方镜像作为基础
FROM node:20-alpine

# 在容器内创建一个目录来存放应用代码
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果存在)
# 将这一步与复制其他代码分开，可以更好地利用 Docker 的层缓存机制。
# 只有当 package*.json 文件改变时，npm install 才会重新运行。
COPY package*.json ./

# 安装项目依赖。--omit=dev 表示不安装开发依赖，使镜像更小。
RUN npm install --omit=dev

# 将你的应用源代码复制到工作目录中
COPY app.js .

# 告诉 Docker 容器在运行时会监听哪个网络端口
EXPOSE 3000

# 直接使用 node 启动应用，而不是通过 npm start
CMD [ "node", "app.js" ]
