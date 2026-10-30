---
status: historical
scope: 2026-10-30 隔离 v9 热复用桌面验收与获即时批准的合成作品 52 实际删除
last-verified: 2026-10-30
sources:
  - docs/design/artwork-deduplication/hot-run-reuse.md
---

# 桌面浏览器验收

## 环境与边界

2026-10-30，分支 `codex/dedup-hot-run-reuse`，独立 worktree `/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf`。真实桌面 Chrome，由 computer use 点击、选择、刷新操作；未用 API 代替验收动作。仅访问 `http://127.0.0.1:5502`，入口带 `entry=direct`。隔离数据库 `dedup_hot_reuse_browser_20261030`，媒体根为本轮独立 `browser-media`，不访问真实图库、不改保留的 2,000 图片测量原件。

等待 A/B 与两项真实 Worker 重启完成的明确 GO 后才访问应用。App PID/PGID 73596、Worker PID/PGID 73597 由测量 agent 启动并持有，首轮结束后由其停止这两个进程组。用户即时批准删除后，同环境由其恢复为 App 78373、Worker 78374；删除与保留校验结束后由其仅停止新进程组，确认 PID/进程组均已退出、5502/55842 无监听；停前 activejobs 为空、操作 DELETED/DONE。见 [收尾证据](browser-process-cleanup-resume-delete.json)。未操作用户服务。账号和环境仅从仓库外私有 manifest 读取，凭证未写入本记录或截图。

## 执行动作与结果

| 检查             | 实际动作与可见结果                                                                                                                                                                                                                                                                                                                       | 结论         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 暂停与刷新       | artist 1 新任务 `7ab7a338-c67c-47c2-88d1-db8b98e67466`，点击暂停，见“正在暂停检查”；到暂停态后刷新，同一 run 显示“检查已暂停”“已处理 760 项原件”                                                                                                                                                                                         | 通过         |
| 继续与完成       | 点击“继续检查”，转“等待开始检查”，后经原件、关系阶段完成，显示 25 组；详情显示本次 50 部作品、快速检查                                                                                                                                                                                                                                   | 通过         |
| 未变化热检查     | 点击重新检查，新任务 `224bd4f6-7b73-41bd-94a9-49fda1a2e4ec` 显示原件阶段进度；刷新后仍为同一 run，完成仍 25 组                                                                                                                                                                                                                           | 通过         |
| 完全一致与包含   | artist 2 首轮 `23bfd2f2-0859-406a-9c46-f0bf31cfd1c5`，重新检查 `f9a6b265-91c0-419d-a00f-f37dad943d92`，显示 2 组；exact 对照可将保留 A 改 B 再改回 A；包含显示 2/3 原媒体、多 1，较小方保留控件禁用                                                                                                                                      | 通过         |
| 部分重复图片证据 | artist 3 首轮 `a9594ac5-c2fe-40ef-833d-97243a883791`，重新检查 `932e0d0e-5693-44d2-92ef-1ef3904d7f4e`；对照显示 4 相同、双方各 1 未配对；默认未配对展示 A 第 5 张与右方无对应图片；切到相同图片显示双侧第 1 张，实际图片正常渲染；选择保留 A 后按钮状态更新                                                                              | 通过         |
| 混合媒体疑似版本 | artist 4 勾选“检查疑似版本”后首轮 `055589b1-981e-4c8d-8f2b-3e72adc03d45`；随后一次重新检查未重新勾选视觉，`c71ccae2-c5b4-4290-a326-eaf08b459499` 为 0 组，不当作视觉验收。重新勾选后 `4f55f85a-3cdc-41c1-bc70-4275fb4d967b` 显示 1 组；已配对 4、左 0 右 1 未配对、左右各 1 未核对，双侧静图正常渲染，未核对过滤明确说明不能据此判定相同 | 通过         |
| 删除确认         | exact 仅勾选 51/52 组，保持保留 51 A；确认页 operation `a705515b-9ea3-487b-bbe0-293565711fa9` 明确保留 A、仅删除 52 B、1 部作品全部文件和整理记录无法恢复且不会合并；两项确认勾选后最终按钮可用                                                                                                                                          | 确认内容通过 |
| 实际删除         | 首次最终点击被自动审批拒绝：不可恢复删除须执行时用户确认，未执行且未绕过。随后用户即时明确批准同一 operation、仅删 52 B 并保留 51 A 及其他作品；恢复同环境、重新核对同一确认单后通过 UI 提交。最终显示“删除完成”“已删除 1 部重复作品，保留 1 部”，刷新清单显示 A 保留、B 已删除                                                          | 通过         |

首轮浏览器根物理身份与暖 dump 不同，缓存/目录 namespace 在 GO 前于隔离库重建。首轮暂停续跑属于冷路径，不能用它证明零读取热路径。登录成功后的 dev RSC refresh 曾出现 fetch fallback，直接进入去重页后正常；Next dev issue 徽标不是本轮业务验收错误结论。

## 有界只读补充审计

测量 agent 对上述 artist 1 两个运行只读核验：两任务都是 definitionVersion 9 且 COMPLETED；首轮 attempt 2（暂停续跑），stat/hash 各 2,000、读取 3,620,370 字节、25 个实际 exact 组、changed/failed 0。首轮未请求视觉，未观测字段保持 null，不声称为零。

热轮 attempt 1，stat/cache 各 2,000，hash 0、读取 0；检查点 v4 的 `hot-run-reuse` 为 done，来源正是首轮。复制 2,125 行、复用 50 作品及 25 关系；decodedImages、indexRebuilds、indexNodeVisits、candidatePairs、compareCalls 均为 0。两轮实际分组摘要一致：`4d50a40c4c642936af78fc79a674c83e1391ebaeed0146761dd1d400385b9e6f`。私有原始审计位于 `/private/tmp/pixishelf-hot-run-reuse-20261030/evidence/browser-first-runs-audit.json`，不是浏览器动作替代物。

补充对三个合成热轮的有界只读审计：exact/contains 的来源为 `23bfd2f2…`，whole-run done，复制 17 行、复用 4 作品/2 关系；partial 来源为 `a9594ac5…`，whole-run done，复制 19 行，4 EXACT 证据与双方各 1 UNMATCHED；mixed 来源为 `055589b1…`，正确跳过选项不同的 `c71ccae2…`，whole-run done，复制 21 行、复用 2 作品/1 关系。三轮 hash/读取均为 0，stat/cache 分别为 9、10、11；mixed decode/indexbuild/nodevisit/candidate/compare 均为 0。mixed 证据为 3 exact + 1 similar、左 0 右 1 未配对、左右各 1 unchecked。私有审计位于 `/private/tmp/pixishelf-hot-run-reuse-20261030/evidence/browser-relations-audit.json`。

## 用户即时批准后的删除与保留验证

首次自动审批拒绝历史保留。用户随后即时明确批准 operation `a705515b-9ea3-487b-bbe0-293565711fa9`，永久删除本轮合成作品 52 B，保留 51 A 和其余作品。等待测量 agent 的重启 GO 后，刷新同一 Chrome 标签页，核对相同 operation、51 保留／52 删除和数量，再勾选确认项，通过 UI 点击最终按钮；本次自动审批允许。未走 API 或间接路径执行删除，也未重建 operation。

UI 最终显示“删除完成”“已删除 1 部重复作品，保留 1 部”；点击刷新清单后，51 A 显示保留链接，52 B 显示已删除，整理记录已随作品删除。随后访问 `/artworks/51?entry=direct`，标题 A、两张媒体节点及其他 53/54 作品链接仍可见。详情页图片 URL 使用现有 `localhost:5431` imgproxy，未映射隔离合成媒体根，`naturalWidth=0`；因此只证明详情可访问和两项媒体注册仍在，不将该详情截图当作图片成功渲染证据。此前去重对照图片已正常渲染，该环境限制未通过修改实现绕过。

测量 agent 对同一操作执行前后有界只读审计：操作 `DELETED/DONE`、deletedFiles 2；作品 52 的 Artwork/Image 记录均为 0、两原件 ENOENT。51 仍保留 2 Image 和两原件；除被删 52 外，其余 57 作品／2,028 原件的 SHA、inode、mtime、ctime、size、device 摘要与 before 完全一致，其他作品和 Image 注册字段数据库摘要一致，activejobs 0。证据见 [删除恢复前后审计](browser-delete-resume-after.json)。访问 51 详情会正常产生阅读状态，不把该 UI 阅读行为混同于删除改动。

至此本轮约定的桌面验收及具体合成删除均已覆盖；未操作真实图库。未将详情 imgproxy 的隔离映射限制描述为通过。

## 截图证据

关键图已保存在本记录旁，可稳定复核：

- [暂停刷新](browser/01-paused-after-refresh.png)
- [具体删除确认](browser/06-delete-confirmation.png)
- [实际删除完成](browser/10-delete-complete.png)
- [保留 A 详情可访问（图片代理未映射隔离根）](browser/11-keeper-a-visible.png)
- [部分重复双侧对照](browser/07-partial-common.png)
- [混合媒体未核对边界](browser/09-mixed-unchecked.png)

全部截图为合成内容，原始图保存在仓库外 `/private/tmp/pixishelf-hot-run-reuse-browser-evidence/`：

- `01-paused-after-refresh.png`：刷新后暂停态与 760 项原件。
- `02-hot-progress.png`：热检查原件阶段。
- `03-hot-complete.png`：热检查 25 组完成态（当时列表仍短暂加载）。
- `04-exact-comparison.png`：exact 保留作品对话框。
- `05-contains-comparison.png`：包含关系数量与固定完整保留方。
- `06-delete-confirmation.png`：待批准的 51 保留／52 删除，确认项已勾选。
- `07-partial-common.png`：部分重复双侧相同图，A 已选保留。
- `08-mixed-paired.png`：混合媒体双侧静图及未核对计数。
- `09-mixed-unchecked.png`：混合媒体未核对原件的明确边界。
- `10-delete-complete.png`：同一 operation 删除完成，A 保留、B 已删除。
- `11-keeper-a-visible.png`：A 详情标题与两媒体注册仍在；图像未映射限制见正文。

未覆盖生产、NAS、移动端、动图播放、任意真实作品删除或所有分页；只核验本轮指定合成及暖样本的桌面动作。未变更实现，未重复全量测试或构建。文档最终检查交由统筹统一执行。
