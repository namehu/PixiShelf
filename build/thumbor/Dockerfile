# 1. 从官方基础镜像开始
FROM ghcr.io/minimalcompact/thumbor:latest

# 2. 切换到 root 用户以获得安装权限
USER root

# 3. 更新软件包列表并安装 ffmpeg (核心修正)
#    这个基础镜像是基于 Debian/Ubuntu 的，所以我们使用 apt-get
RUN apt-get update && apt-get install -y ffmpeg

# 4. 使用 pip 安装视频引擎插件 (保留)
RUN pip install thumbor-video-engine
