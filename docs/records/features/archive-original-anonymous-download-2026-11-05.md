---
status: historical
scope: 原图下载缺少 Cookie 时的过早拦截修复；本地验证，尚未部署生产
last-verified: 2026-11-05
sources:
  - packages/pixishelf-job-executors/src/archive/providers/e-hentai.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/safe-http.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/anonymous-original.test.ts
  - packages/pixishelf/services/archive/__tests__/e-hentai.test.ts
---

# 原图匿名请求修复

用户继续来源作品 `4183902` 的首次归档任务后，任务以“原图下载需要有效的共享 EH Cookie”暂停，成功与失败页数均为 0。生产只读查询确认任务仍选择 ORIGINAL，既不是补全也不是原图升级，错误为 `ORIGINAL_UNAVAILABLE`。

原因是提供器在读取图片浏览页后，只要发现原图入口且没有配置 Cookie，就在发送媒体请求之前直接拒绝。该行为将本地配置状态当成了原站实际的登录要求。

## 本地修复范围

- 保留原图请求偏好和原图入口选择；没有 Cookie 时也发送匿名请求。
- HTTP 401 或明确的 EH 登录重定向才提示配置或更新登录态；不把任意 HTML、论坛页面或其他失败都当作登录失败。
- 已配置 Cookie 时仍仅附带到精确 EH 原图端点，每跳重查，其他主机和路径不接收 Cookie。
- 原图实收验证、发布门禁、请求重试和其他错误处理保持既有规则。没有自动降级，也没有新增画质选择流程。

本次不修改数据库、生产任务或媒体，不新增迁移，也不需要重新核验历史画质。部署修复后，用户可以直接继续原来暂停的任务。

本次按用户要求提交并通过 patch 标签 `v0.56.3` 触发 CI 与镜像构建，运行结果和生产验证由用户自行确认；不将触发构建视为生产部署完成。

## 验证

定向回归 179 项通过：执行器的安全 HTTP、提供器、存储、画质与 Cookie 测试 163 项，主应用提供器测试 15 项，以及独立匿名原图提供器到临时文件存储的集成测试 1 项。集成测试使用合成 PNG 原字节和精确原图声明，确认无 Cookie 时确实发出原图请求，保存结果为 ORIGINAL，文件字节不变。

重定向测试使用真实安全 HTTP 请求流程和模拟 DNS／HTTPS 响应，覆盖无 Cookie 请求、逐跳凭据隔离、EH 登录跳转、普通论坛 HTML 不误报登录，以及伪装登录主机仍受来源限制。执行器类型检查通过。文档检查通过 392 个 Markdown 文件，使用本机 Chrome 通过 34 个图源和 23 个内嵌 Mermaid 块检查。

GPT-6.1 Terra 独立回归的执行器六组 195 项与主应用提供器 15 项全部通过（与上述测试有重叠，不相加作为独立用例数量），Worker 依赖链 typecheck 与 build 通过；构建保留既有的 `import.meta`／CJS 警告。登录目标检查沿用安全 HTTP 的每跳顺序，位于来源与 DNS 验证之后；DNS 失败仍按网络错误报告。

以上不证明 EH 当前允许某一具体图片匿名下载。真实源站的登录、权限和额度限制以该次请求为准；本次没有访问原站图片，也没有继续生产暂停任务。
