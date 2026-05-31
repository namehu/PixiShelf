# 视频章节后端与后台管理设计计划

## 1. 背景

当前项目中，`Image` 表虽然命名为图片表，但实际已经承担媒体条目的职责，视频文件也作为 `Image` 记录保存。作品详情页通过 `Image.path` 判断媒体类型，并在遇到视频时交给 `VideoPlayer` 渲染。

新增 `{name}.chapters.json` 后，不建议把章节文件作为一条媒体记录写入 `Image` 表，因为它不是可播放媒体，也不应该影响媒体数量、排序、作品列表展示和派生媒体标签。

本设计将 `.chapters.json` 定义为视频媒体条目的附属元数据：

```text
Artwork
└── Image 作为媒体条目
    ├── path: /artistId/artworkId/video.mp4
    └── chaptersPath: /artistId/artworkId/video.chapters.json
```

## 2. 目标

- 支持上传、扫描、重扫和替换视频时自动关联 `.chapters.json`。
- `.chapters.json` 跟随视频文件保存在源库目录，不把章节正文直接存入数据库。
- 数据库只保存章节文件路径和摘要字段，用于前端展示、接口判断和后台管理。
- 保持现有 `/api/v1/images/[...path]` 媒体服务继续可用。
- 为未来 `ffprobe` 读取 MP4 内嵌章节、在线编辑章节、章节搜索留下扩展点。

## 3. 核心取舍

### 3.1 文件存储

章节文件与视频文件同目录保存，推荐规范：

```text
{videoBaseName}.mp4
{videoBaseName}.chapters.json
```

兼容历史或外部工具输出：

```text
{videoBaseName}..chapters.json
```

后端保存时应统一输出为单点命名：

```text
externalId_p1.mp4
externalId_p1.chapters.json
```

### 3.2 数据库存储

章节正文不入库。数据库只记录视频是否有关联章节文件和摘要信息。

建议扩展当前 `Image` 模型：

```prisma
model Image {
  id        Int      @id @default(autoincrement())
  path      String
  width     Int?
  height    Int?
  size      Int?
  sortOrder Int      @default(0)
  artworkId Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  chaptersPath      String?
  chaptersCount     Int      @default(0)
  chaptersDuration  Float?
  chaptersUpdatedAt DateTime?
  chaptersHash      String?

  artwork Artwork? @relation(fields: [artworkId], references: [id])

  @@unique([artworkId, path], name: "unique_artwork_path")
  @@index([chaptersPath])
}
```

`hasChapters` 不落库，由服务层或 DTO 派生：

```ts
const hasChapters = Boolean(image.chaptersPath && image.chaptersCount > 0)
```

### 3.3 关联粒度

章节文件必须挂到具体视频媒体条目，不挂到 `Artwork`。

原因：

- 一个作品可能包含多个视频。
- 每个视频可以拥有不同章节。
- `Artwork` 级字段无法准确表达多视频章节关系。

## 4. Chapter Manifest 数据契约

后端接收并返回统一格式：

```ts
export interface VideoChapterManifest {
  version: 1
  duration: number
  chapters: VideoChapter[]
}

export interface VideoChapter {
  index: number
  title: string
  start: number
  end: number
  duration: number
  file?: string
}
```

示例：

```json
{
  "version": 1,
  "duration": 104.966,
  "chapters": [
    {
      "index": 1,
      "title": "Opening",
      "start": 0,
      "end": 12.5,
      "duration": 12.5
    }
  ]
}
```

校验规则：

- 文件名必须以 `.chapters.json` 或 `..chapters.json` 结尾。
- JSON 最大大小建议限制为 2MB 到 5MB。
- `version` 当前只接受 `1`。
- `duration` 必须大于 0。
- `chapters` 必须为非空数组。
- `start >= 0`。
- `end > start`。
- `duration` 与 `end - start` 的误差允许小于 0.05 秒。
- 章节按 `start` 升序排列。
- 章节不能倒退，默认不允许重叠。
- `title` 需要 trim，空标题可自动回退为 `Chapter {index}`。

## 5. 服务层设计

新增：

```text
packages/pixishelf/services/artwork-service/video-chapters.ts
```

建议导出：

```ts
export async function validateChapterManifest(input: unknown): Promise<VideoChapterManifest>

export function getChapterPathCandidates(videoPath: string): string[]

export function resolveCanonicalChapterPath(videoPath: string): string

export async function discoverChaptersForVideo(videoPath: string): Promise<ChapterMeta | null>

export async function associateChaptersToImage(input: {
  imageId: number
  chaptersPath: string
}): Promise<void>

export async function clearChaptersForImage(input: {
  imageId: number
  deleteFile?: boolean
}): Promise<void>
```

`ChapterMeta`：

```ts
interface ChapterMeta {
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}
```

路径安全要求：

- 所有章节路径都必须 resolve 到 `SCAN_PATH` 内。
- 数据库存储路径统一用 `/`。
- 不允许客户端直接提交绝对路径作为最终数据库值。
- 后端根据 `targetRelDir` 和规范文件名生成最终路径。

## 6. 上传业务设计

### 6.1 单个新增媒体

当前相关入口：

```text
packages/pixishelf/app/admin/artworks/_components/image-manager-content.tsx
packages/pixishelf/app/admin/artworks/_hooks/use-chunk-upload.ts
packages/pixishelf/app/api/artwork/upload-chunk/route.ts
packages/pixishelf/services/artwork-service/image-manager.ts
```

新增流程：

```text
1. 前端选择视频文件。
2. 可选选择匹配的 chapters.json。
3. 视频继续走分片上传。
4. chapters.json 走小文件上传接口。
5. 后端校验 JSON。
6. 后端保存为同 basename 的 .chapters.json。
7. 创建 Image 记录。
8. 更新 Image.chaptersPath / chaptersCount / chaptersDuration / chaptersHash。
```

建议新增接口：

```http
POST /api/artwork/media-chapters/upload
```

请求头或表单字段：

```text
artworkId
imageId 可选
videoPath 可选
targetRelDir
file
```

若 `imageId` 已存在，直接关联该视频。若是新增视频流程，可先临时上传章节文件，在 `addImage` mutation 后按 `videoPath` 关联。

### 6.2 全量替换媒体

当前相关入口：

```text
packages/pixishelf/app/api/artwork/[id]/replace/route.ts
packages/pixishelf/app/admin/artworks/_components/image-replace-dialog.tsx
```

替换流程扩展：

```text
1. init 阶段备份旧媒体文件和旧 .chapters.json。
2. 前端把拖入文件按 basename 分组。
3. 视频文件进入上传队列。
4. chapters.json 进入章节上传队列。
5. commit 阶段接收 filesMeta 和 chaptersMeta。
6. 创建媒体记录时，把章节摘要写到对应视频记录。
7. commit 成功后清理备份。
8. rollback 时恢复媒体文件和章节文件。
```

`init` 备份规则需要新增章节文件：

```text
MEDIA_EXTENSIONS
.chapters.json
..chapters.json
```

`commit` 请求结构建议：

```ts
interface ReplaceCommitBody {
  filesMeta: ImageMeta[]
  chaptersMeta?: Array<{
    videoFileName: string
    chaptersFileName: string
    chaptersPath: string
    chaptersCount: number
    chaptersDuration: number
    chaptersHash: string
  }>
}
```

匹配规则：

```text
original: name.mp4 + name.chapters.json
renamed: externalId_p1.mp4 + externalId_p1.chapters.json
```

如果存在未匹配的章节文件：

- 默认阻止提交，并提示哪个章节文件找不到对应视频。
- 后续可提供“忽略未匹配章节文件”选项。

### 6.3 扫描与重扫

当前相关入口：

```text
packages/pixishelf/services/scan-service/media-collector.ts
packages/pixishelf/services/scan-service/index.ts
```

扫描规则：

```text
1. collectMediaFiles 继续只收集可展示媒体。
2. 插入 Image 记录后，对其中视频记录执行 discoverChaptersForVideo。
3. 找到章节文件后校验并写入章节摘要字段。
4. 未找到时保持 chaptersPath = null。
```

重扫规则：

```text
1. 当前视频仍存在且章节文件存在：更新摘要字段。
2. 当前视频仍存在但章节文件消失：清空章节字段。
3. 当前视频路径变更：按新 path 重新发现章节。
```

### 6.4 删除

当前删除媒体入口：

```text
packages/pixishelf/services/artwork-service/image-manager.ts
```

删除视频时：

- 数据库记录删除后，章节字段自然删除。
- 如果 `deleteFile = true`，建议同时删除 `chaptersPath` 指向的章节文件。
- 如果 `deleteFile = false`，只删除数据库记录，不动章节文件。

删除作品时：

- 删除所有媒体文件时，也删除每个视频关联的章节文件。
- 忽略文件不存在错误。

## 7. 读取接口设计

### 7.1 静态文件读取

当前接口：

```http
GET /api/v1/images/[...path]
```

需要扩展 MIME：

```ts
'.json': 'application/json; charset=utf-8'
```

注意：对 `.chapters.json` 可以继续复用该接口，但它只是文件读取接口，不表达章节业务语义。

### 7.2 业务章节接口

推荐新增：

```http
GET /api/v1/media/:imageId/chapters
```

行为：

```text
1. 查询 Image。
2. 判断 Image 是否为视频。
3. 优先读取 chaptersPath。
4. 若无 chaptersPath，未来可 fallback 到 ffprobe 读取 MP4 内嵌章节。
5. 返回统一 VideoChapterManifest。
```

响应：

```json
{
  "source": "chapters-file",
  "version": 1,
  "duration": 104.966,
  "chapters": []
}
```

无章节时：

```http
404
```

或返回：

```json
{
  "source": "none",
  "version": 1,
  "duration": 0,
  "chapters": []
}
```

推荐前期使用 404，让前端清晰区分“无章节”和“章节为空”。

## 8. DTO 设计

扩展：

```text
packages/pixishelf/schemas/artwork.dto.ts
```

新增字段：

```ts
chaptersPath: z.string().nullable().optional()
chaptersUrl: z.string().nullable().optional()
chaptersCount: z.number().int().default(0)
chaptersDuration: z.number().nullable().optional()
hasChapters: z.boolean().default(false)
```

服务层转换：

```ts
const hasChapters = Boolean(image.chaptersPath && image.chaptersCount > 0)
const chaptersUrl = hasChapters ? combinationApiResource(image.chaptersPath) : null
```

如果采用业务接口，则 `chaptersUrl` 可为：

```text
/api/v1/media/{image.id}/chapters
```

## 9. 后台管理 UI 设计

当前页面：

```text
packages/pixishelf/app/admin/artworks/_components/image-manager-content.tsx
```

建议逐步把“图片管理”文案升级为“媒体管理”。

列表列设计：

```text
Order
文件名 / 路径
类型
章节
尺寸
大小
操作
```

章节列：

```text
无章节
12 段 / 01:44
校验失败
```

视频行操作：

```text
上传章节
替换章节
下载章节
删除章节
```

非视频行隐藏章节操作。

## 10. 开发阶段计划

### Phase B1 - 数据模型与迁移

任务：

- 扩展 Prisma `Image` 模型章节字段。
- 新增 migration。
- 生成 Prisma Client。
- 扩展 `ArtworkImageResponseDto`。
- 扩展 `transformImages` 输出章节 DTO。

验收：

- 旧数据 migration 后不报错。
- 无章节视频返回 `hasChapters = false`。
- 有手工写入 `chaptersPath` 的视频返回 `hasChapters = true`。

### Phase B2 - 章节校验与路径服务

任务：

- 新增 `video-chapters.ts`。
- 实现 manifest 校验。
- 实现同名章节文件候选查找。
- 实现 hash、count、duration 摘要计算。
- 补单元测试。

验收：

- 合法 JSON 通过。
- 非法时间轴、空章节、错误 version 被拒绝。
- `name.chapters.json` 和 `name..chapters.json` 都能被识别。

### Phase B3 - 扫描与重扫接入

任务：

- 扫描新作品时自动发现视频章节文件。
- 重扫作品时同步章节字段。
- 章节文件消失时清空字段。

验收：

- 本地目录存在 `a.mp4` 和 `a.chapters.json`，扫描后视频记录有关联章节。
- 删除章节文件后重扫，章节字段被清空。

### Phase B4 - 新增媒体上传接入

任务：

- 新增章节上传接口。
- 前端新增媒体流程支持附带章节文件。
- `addImage` 后关联章节元信息。

验收：

- 后台新增视频时可同时上传章节。
- 章节文件保存到视频同目录。
- 数据库记录含正确章节摘要。

### Phase B5 - 全量替换接入

任务：

- replace init 备份章节文件。
- replace commit 支持 `chaptersMeta`。
- replace rollback 恢复章节文件。
- 前端替换弹窗支持章节文件配对和错误提示。

验收：

- 替换一组视频和章节后，视频记录正确关联章节。
- commit 失败会恢复旧媒体和旧章节。
- 未匹配章节文件不能静默提交。

### Phase B6 - 章节读取接口

任务：

- 扩展静态文件 JSON MIME。
- 新增 `/api/v1/media/:imageId/chapters`。
- 接入鉴权策略，保持与现有媒体访问一致。

验收：

- 前端可通过 `chaptersUrl` 拉取章节。
- 无章节视频返回明确的 404 或空状态。
- 路径穿越请求被拒绝。

### Phase B7 - 后台媒体管理体验

任务：

- 媒体列表增加章节状态列。
- 视频行增加上传、替换、下载、删除章节操作。
- 增加章节 JSON 校验错误展示。

验收：

- 管理员能看出哪些视频有章节。
- 能单独替换章节文件，不重新上传视频。
- 删除章节后作品页普通播放不报错。

## 11. 风险与注意事项

- 当前 `Image` 表名与媒体语义不一致，本设计不改表名，避免一次性重构过大。
- `.chapters.json` 不应进入 `MEDIA_EXTENSIONS`，否则会被当作媒体展示。
- 备份和删除逻辑需要显式处理章节文件。
- `imageCount` 当前由 Image 记录触发统计，章节文件不能建 Image 记录。
- 如果未来支持在线编辑章节，再考虑新增 `VideoChapter` 表。

## 12. 推荐开发顺序

```text
B1 数据模型
B2 校验服务
B3 扫描重扫
B6 读取接口
B4 新增上传
B5 全量替换
B7 后台管理 UI
```

理由：

- 先让历史源库章节文件可被识别。
- 再让作品页能读取章节。
- 最后补齐后台上传和替换体验。
