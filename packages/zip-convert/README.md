
# Zip Convert 工具包

包含处理 Pixiv 资源文件的相关工具脚本。

## 1. APNG 转 WebM 工具 (apngToWebm.js)

批量扫描指定目录下的 `.apng` 文件并将其转换为 `.webm` 格式。支持跳过已转换文件，并记录详细日志。

### 命令行参数

| 参数 | 简写 | 描述 | 默认值 |
| :--- | :--- | :--- | :--- |
| `--input` | `-i` | 扫描 APNG 文件的输入目录 | `/Users/admin/Downloads/pixiv` |
| `--output` | `-o` | 转换日志的输出文件路径 | `/Users/admin/Downloads/result.txt` |

### 使用示例

**1. 使用默认配置**
```bash
node apngToWebm.js
```

**2. 指定输入目录和日志文件**
```bash
node apngToWebm.js --input "D:\Downloads\pixiv" --output "D:\Downloads\conversion_log.txt"
```

**3. 使用简写参数**
```bash
node apngToWebm.js -i "D:\Downloads\pixiv" -o "D:\Downloads\conversion_log.txt"
```

---

### 动图解析帧

这是一个“兜底策略”。因为 Pixiv 的动图（Ugoira）通常不是标准的视频，而是“动态插画”。

省流/省帧：很多画师为了减少制作成本，不会画满 24帧/60帧。他们通常画的是“关键帧动画”（比如眨眼、头发飘动），帧率通常在 8 FPS ~ 12 FPS 左右。

安全值：如果丢失了 animation.json（时间轴数据），用 100ms（10 FPS）播放通常能看清每一张图。如果盲目设置为 60 FPS（16ms），当只有 4-5 张图时，动画会像闪电一样一闪而过，根本看不清。

|目标帧率 (FPS) | delay 数值 (毫秒) | 适用场景
| :--- | :--- | :--- |
| 60 FPS | 16 或 17 | 极其流畅的游戏录屏或高帧率视频 |
| 30 FPS | 33 | 标准网络视频、手机录像 |
| 24 FPS | 41 或 42 | 日本动画标准、电影感 |
| 12 FPS | 83 | 有限动画、日式“三拍一”作画风格 |
| 10 FPS | 100 | (当前默认) 简单的 GIF 动图风格 |
