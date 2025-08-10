LLM 工作记录（持续更新）

一、项目与环境
- 仓库根目录：d:\code\artisan-shelf
- 后端开发服务器：http://0.0.0.0:3002 （代理到前端 /api）
- 前端开发服务器：http://localhost:3001/（Vite 代理 /api -> 3002）

二、变更摘要
- 后端
  - 引入 SettingService 管理可持久化的 scanPath，移除对 process.env.SCAN_PATH 的直接依赖。
  - 新增/对外暴露接口：
    - GET /api/v1/settings/scan-path：获取当前 scanPath
    - PUT /api/v1/settings/scan-path：更新 scanPath
    - POST /api/v1/scan：手动触发扫描（支持 SSE 进度推送）
    - POST /api/v1/scan/cancel：取消扫描
    - GET /api/v1/scan/status：获取扫描状态与最新进度消息
    - GET /api/v1/scan/stream：SSE 扫描实时进度流（命名事件）
    - GET /api/v1/images/*：安全地返回本地图片（支持 URL 解码、缓存、Content-Length）
  - 扫描流程：添加 scanning、cancelRequested 状态与 lastProgressMessage 进度消息缓存；SSE 推送命名事件与错误处理；支持在扫描过程中中断。
  - 图片接口：
    - 对通配符路径执行 decodeURIComponent 以兼容非 ASCII 与已编码字符。
    - 设置 Content-Type、Content-Length，改为 Buffer 一次性下发，避免代理出现 content-length: 0。
    - 增加 ETag、Last-Modified 与 Cache-Control（immutable）以增强缓存与代理兼容性。
    - 在 preHandler 中对 /api/v1/images/* 的请求全部放行，避免被 API Key 校验拦截（HEAD/GET 均可）。
- 前端
  - Settings 页面：
    - 新增 scanPath 表单与保存交互。
    - 支持手动触发扫描，SSE 自动重试与错误提示，新增取消扫描按钮。
    - 适配后端 SSE 命名事件（开始、进度、完成、取消、错误）。
  - Gallery 页面：
    - 新增顶部全局扫描进度条与取消扫描按钮。
    - 通过轮询 /api/v1/scan/status 获取扫描状态与消息，显示实时进度。
- 代理与端口
  - 前端通过 Vite 代理将 /api 路由转发至后端 3002。

三、涉及文件（主要）
- 后端
  - <mcfile name="index.ts" path="d:\code\artisan-shelf\packages\api\src\index.ts"></mcfile>
    - 集成 SettingService、注册新路由、SSE 扫描流、扫描状态管理、images 路由增强与预处理放行。
  - <mcfile name="scanner.ts" path="d:\code\artisan-shelf\packages\api\src\services\scanner.ts"></mcfile>
    - 使用 this.scanRootAbs 作为扫描根路径，移除对 process.env.SCAN_PATH 的直接引用，支持动态配置。
  - <mcfile name="package.json" path="d:\code\artisan-shelf\packages\api\package.json"></mcfile>
    - 验证 prisma:generate 与 postinstall 脚本以确保 Prisma Client 生成。
- 前端
  - <mcfile name="Settings.tsx" path="d:\code\artisan-shelf\packages\web\src\pages\Settings.tsx"></mcfile>
    - 新增 scanPath 表单、保存按钮、手动扫描、SSE 自动重连、取消扫描与命名事件处理。
  - <mcfile name="Gallery.tsx" path="d:\code\artisan-shelf\packages\web\src\pages\Gallery.tsx"></mcfile>
    - 新增顶部全局扫描进度条、轮询 /api/v1/scan/status 与取消扫描按钮，封装 useScanStatus/useCancelScan。
  - <mcfile name="vite.config.ts" path="d:\code\artisan-shelf\packages\web\vite.config.ts"></mcfile>
    - 代理 /api -> http://localhost:3002。

四、后端接口定义与说明
- 设置
  - GET /api/v1/settings/scan-path：返回 { scanPath }
  - PUT /api/v1/settings/scan-path：Body { scanPath }，更新扫描根路径
- 扫描
  - POST /api/v1/scan：触发扫描；扫描期间 SSE 于 /api/v1/scan/stream 输出命名事件（start、progress、done、cancelled、error）
  - POST /api/v1/scan/cancel：设置取消标记，扫描循环检查并中断
  - GET /api/v1/scan/status：返回 { scanning, message }，供前端顶部进度条与状态显示
- 图片
  - GET /api/v1/images/*：在扫描根目录下定位文件并返回
    - 支持 decodeURIComponent，阻止越界访问，设置 Content-Type/Length、ETag/Last-Modified/Cache-Control
    - preHandler 放行 /api/v1/images/*（不需要 API Key）

五、验证要点与结果
- 图片接口
  - 通过前端代理（3001）访问图片：成功返回实际大小数据（示例约 21.9MB），不再出现 content-length: 0。
  - 直接访问后端（3002）图片接口：返回包含 Content-Length、Content-Type 的正确头部。
- 扫描流程
  - Settings 页面可配置 scanPath，手动触发扫描；SSE 自动重连有效；可在扫描期间取消。
  - Gallery 顶部显示扫描状态与消息；取消按钮可中断扫描。

六、使用与排查
- 设置 scanPath：
  - 前端 Settings 页面输入保存，或通过 PUT /api/v1/settings/scan-path。
- 触发扫描：
  - 前端 Settings 页面点击手动扫描，或 POST /api/v1/scan。
- 查看进度：
  - 前端 Settings 页面通过 SSE 实时显示；Gallery 顶部通过 /api/v1/scan/status 轮询显示。
- 取消扫描：
  - 前端任一页面点击“取消扫描”，或 POST /api/v1/scan/cancel。
- 图片无法加载排查：
  - 确认 URL 是否已正确编码（前端通常可用 encodeURI 生成），后端已支持 decodeURIComponent；
  - 确认 3001 代理是否转发到 3002；
  - 查看响应头中 Content-Length 是否非 0，若为 0，请确认后端版本包含本次修复（Buffer 发送 + 显式 Content-Length）。

七、注意事项与后续改进建议
- 图片大文件的内存占用：当前为避免代理问题采用 Buffer 一次性返回，若未来图片更大或并发很高，建议回到流式输出并确保代理链路正确保留 Content-Length/传输编码。
- 缓存：当前返回 immutable 强缓存，若存在文件被覆盖但保持同名的情况，可能导致浏览器缓存命中；可根据需要缩短 max-age 或移除 immutable。
- 进度显示：可考虑在扫描服务中统计总量/已完成以计算百分比；也可在 SSE 中扩展负载格式（如 { current, total }）。
- 表单校验：可对 scanPath 做存在性校验与权限提示，减少运行时错误。
- 观察日志中“stream closed prematurely”：通常为客户端主动断开，不影响当前实现；可保留告警级别或改为 debug 级别视运营需要。

八、里程碑（已完成）
- 可配置 scanPath（持久化），兼容 env 到数据库的迁移
- 扫描流程（手动触发、SSE 实时、可取消）
- Settings 页面：scanPath 配置、SSE 自动重连、取消按钮
- Gallery 页面：顶部全局扫描进度条 + 取消
- 图片接口：非 ASCII/已编码路径兼容、Content-Length 与缓存头补充、preHandler 放行

九、后续工作（候选）
- 扫描进度百分比与更细粒度统计（前后端协议对齐）
- SSE 自动重连策略配置化（最大重连次数、退避等）
- scanPath 校验与引导 UI（例如目录选择器或路径存在检查）
- 图片接口切回流式并在代理层验证兼容性
- 增加端到端测试与回归用例，覆盖图片路径编码与大尺寸文件场景