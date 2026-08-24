# @pixishelf/extension

PixiShelf 下载助手是一个使用 WXT、React 和 TypeScript 开发的浏览器扩展。扩展运行在 Pixiv 页面内，批量采集标签、用户和作品元数据，在浏览器本地保存任务进度，并将结果导出为 SQL 或相关图片。

扩展不会连接 PixiShelf Web/API，也不会自动修改 PixiShelf 数据库。生成的 SQL 是需要人工检查和执行的辅助产物。

## 实际功能

扩展在 `https://www.pixiv.net/*` 页面右上角注入一个 `P` 按钮。点击后打开可拖动、折叠的浮动面板，面板包含“标签”“用户”“作品”和“设置”四个页签。面板位置、显示状态、当前页签和下载设置会保存在浏览器本地。

| 模块 | 输入                        | 采集内容                                                 | 导出内容                                   |
| ---- | --------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| 标签 | 每行一个 Pixiv 标签         | 中文/英文翻译、Pixpedia 摘要和封面图地址                 | Tag 更新 SQL；封面图单独下载或 ZIP 打包    |
| 用户 | 每行一个 Pixiv 用户 ID      | 用户名、头像地址和背景图地址                             | Artist 图片路径更新 SQL；头像和背景图      |
| 作品 | 逗号或换行分隔的数字作品 ID | 标题、描述、作者、日期、尺寸、统计、标签、系列和图片地址 | 系列作品 SQL、非系列作品 SQL和作品标签 SQL |

### 标签采集

- 调用 Pixiv 的 `/ajax/search/tags/<tag>?lang=zh` 接口。
- 读取 Pixiv 标签的中文翻译、英文翻译、Pixpedia 摘要和封面图。
- 自动忽略已经存在的重复标签。
- 支持开始和暂停队列，显示成功、失败、待处理数量及任务日志。
- 生成 `pixiv_tags_update.sql`，更新 PixiShelf `Tag` 的翻译、摘要和图片路径。
- 下载 Pixpedia 封面图时可以选择：
  - 单独下载到浏览器 Downloads 目录或其相对子目录；
  - 打包为 `pixiv_tag_images.zip`。

### 用户采集

- 调用 Pixiv 的 `/ajax/user/<userId>?full=1&lang=zh` 接口。
- 采集用户 ID、用户名、头像和个人主页背景图。
- 自动忽略已经存在的重复用户 ID。
- 显示任务进度和日志，并可从本地任务列表中删除抓取失败的用户。
- 生成按日期命名的 `pixiv_users_YYYY-MM-DD.sql`，更新 PixiShelf `Artist` 的头像和背景图相对路径。
- 将图片分别下载到 `Downloads/artists/<userId>/`，文件名为 `avatar.<ext>` 和 `background.<ext>`。

当前输入处理会把每一行原样作为用户 ID 使用，不会从 Pixiv 用户链接中自动提取 ID。

### 作品采集

- 调用 Pixiv 的 `/ajax/illust/<id>?lang=zh` 接口。
- 输入仅接受数字作品 ID，支持使用逗号或换行分隔。
- 采集标题、描述、创建/上传日期、作者、页数、宽高、标签、系列、收藏数、点赞数、浏览数、限制级别及原图/缩略图地址。
- 支持开始和暂停队列，显示任务统计及日志。
- 根据成功任务生成三个 SQL 文件：
  - `pixiv_artworks_series_<timestamp>.sql`：更新作品并维护 Pixiv 系列关系；
  - `pixiv_artworks_noseries_<timestamp>.sql`：更新没有系列的作品；
  - `pixiv_artworks_tags_<timestamp>.sql`：写入标签并建立作品标签关系。

作品模块只采集元数据并生成 SQL，目前不下载作品原图。

### 任务与本地数据

- 标签、用户、作品任务及日志存放在浏览器 IndexedDB 数据库 `PixiShelfDB` 中，刷新 Pixiv 页面后仍然保留。
- 面板状态和下载设置使用 LocalForage 持久化。
- 新增输入时会按主键去重；任务只处理 `pending` 状态的数据。
- 请求按队列逐项执行，并在请求之间增加短暂延迟。
- 普通失败最多重试三次；HTTP 404 直接标记失败，HTTP 429 会等待后重试。
- 标签和作品任务可以暂停，正在处理的项目会恢复为 `pending`；用户页面当前没有暂停按钮。
- 每个模块都提供清空数据操作。该操作只清理扩展本地 IndexedDB 中对应的数据，不会删除 Pixiv 或 PixiShelf 数据。

### 下载方式

普通文本、SQL 和 ZIP 文件通过浏览器下载链接保存。需要写入自定义相对子目录时，Content Script 会把文件发送给 Background Script，再由浏览器 `downloads` API 保存，并以 `uniquify` 方式处理重名文件。

设置页的“下载模式”和“自定义目录”当前只作用于标签封面图。用户图片始终按用户目录单独下载。

## 使用方式

1. 构建并加载扩展。
2. 打开能够正常访问的 Pixiv 页面。
3. 点击页面右上角的 `P` 按钮打开浮动面板。
4. 在标签、用户或作品页签中添加任务，然后开始抓取。
5. 在任务完成后下载 SQL 或图片。
6. 在隔离环境核对生成 SQL，并在执行数据库变更前创建备份。

浏览器工具栏 Popup 只负责检测当前标签页是否为 Pixiv 页面；采集和导出操作都在 Pixiv 页面内的浮动面板中完成。

## 开发与构建

从仓库根目录安装依赖：

```bash
pnpm install
```

启动 Chromium 开发环境：

```bash
pnpm --filter @pixishelf/extension dev
```

常用检查与构建命令：

```bash
pnpm --filter @pixishelf/extension compile
pnpm --filter @pixishelf/extension build
pnpm --filter @pixishelf/extension build:firefox
pnpm --filter @pixishelf/extension zip
pnpm --filter @pixishelf/extension zip:firefox
```

WXT 会将构建和打包结果写入包目录下的 `.output/`。开发构建或生产构建完成后，按照终端输出选择对应浏览器目录加载未打包扩展。

## 浏览器权限

| 权限                      | 当前用途                                        |
| ------------------------- | ----------------------------------------------- |
| `https://www.pixiv.net/*` | 注入浮动面板并请求 Pixiv Ajax API               |
| `https://i.pximg.net/*`   | 获取 Pixiv 图片资源                             |
| `downloads`               | 将图片或生成文件保存到 Downloads 及其相对子目录 |
| `tabs`、`activeTab`       | Popup 检测并切换当前标签页                      |
| `storage`                 | 扩展状态存储权限                                |
| `contentSettings`         | Manifest 当前已声明，但业务代码尚未使用         |

## 边界与注意事项

- 扩展依赖 Pixiv 当前页面会话、Ajax 响应结构及图片访问策略；Pixiv 接口变化、访问限制或网络问题都可能导致任务失败。
- 被标记为 `rejected` 的任务不会自动重新进入队列；需要清理或重新建立任务后再抓取。
- 生成 SQL 不属于 Prisma migration 或 PixiShelf 的正式导入通道，也不会经过应用层校验。执行前必须根据当前 Prisma Schema 进行核对，并先备份数据库。
- 扩展当前没有自动化测试脚本。`compile` 和 `build` 只能验证类型与构建，发布前仍需在真实 Pixiv 页面人工验证面板、采集、限流和下载行为。
