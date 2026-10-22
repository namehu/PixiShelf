---
status: historical
scope: CI 270 绘制延迟注入回归及本地验证
last-verified: 2026-10-17
sources:
  - docs/development/testing-strategy.md
---

# WebP 绘制延迟测试修复记录

WebP 的绘制延迟回归须在已显示首帧且进入 `playing` 后注入延迟，不能按全局第几个 RAF 判断播放已经开始。2026-10-17 的 CI #270 中，较慢的 Worker 初始化提前消耗了旧测试的延迟注入，导致 `decodeOmittedFrames > 0` 失败；本地延迟 Worker 模块加载 600ms 可复现。当前用例同时覆盖正常与延迟初始化，保留播放耗时、解码省略及末帧断言，并核对注入帧、独立管线、媒体时长和单次结束。该修复只改变测试，不改变生产播放器。

本次修复在 Windows／Edge 完成类型检查、49 项单测、6 项预编译产物测试及 70 项完整浏览器测试；正常／延迟初始化两种绘制延迟场景各重复 5 次通过。Linux／Chromium 结果以修复提交对应的 CI 为准。

限制：原记录没有保存修复提交 SHA 或 Linux 最终运行链接。本轮整理未重新运行浏览器或核验远端 CI。
