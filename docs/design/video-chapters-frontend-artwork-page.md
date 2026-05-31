# 视频章节前端作品页设计计划

## 1. 背景

现有作品详情页通过 `LazyMedia` 渲染作品媒体。遇到视频时，会使用 `VideoPlayer` 播放。现有播放器基于原生 `<video>`，已经有基础加载、播放暂停、剩余时间和进度条。

本设计承接后端返回的章节信息，在作品页实现：

- 视频章节加载。
- 章节列表。
- 当前章节高亮。
- 点击章节跳转。
- 进度条章节标记。
- 移动端章节面板。
- 后续扩展收藏点、书签、AI 标记点。

相关现有文件：

```text
packages/pixishelf/app/artworks/[id]/_components/LazyMedia.tsx
packages/pixishelf/components/players/VideoPlayer.tsx
docs/design/video.md
```

## 2. 目标

- `VideoPlayer` 支持 `chaptersUrl`，有章节时增强播放体验，无章节时保持普通播放。
- 前端不猜测 `.chapters.json` 路径，只消费后端 DTO 提供的 `chaptersUrl`。
- 章节加载失败不阻断视频播放。
- 桌面端提供侧边章节列表，移动端提供底部章节面板。
- 进度条展示章节 marker，并支持 hover 或点击提示。
- 当前章节跟随播放时间更新。
- 为未来 ArtPlayer 替换、书签、收藏点、弹幕、字幕保留结构。

## 3. 数据契约

后端应在视频媒体 DTO 中返回：

```ts
interface ArtworkMediaDto {
  id: number
  path: string
  mediaType: 'image' | 'video'
  chaptersUrl?: string | null
  chaptersCount?: number
  chaptersDuration?: number | null
  hasChapters?: boolean
}
```

章节接口返回：

```ts
export interface VideoChapterManifest {
  source?: 'chapters-file' | 'mp4-embedded' | 'database'
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

前端内部标准化：

```ts
export interface NormalizedChapter {
  id: string
  index: number
  title: string
  start: number
  end: number
  duration: number
}
```

`id` 生成规则：

```text
chapter-{index}-{start}
```

## 4. 组件架构

目标结构：

```text
ArtworkDetailPage
└── ArtworkImages
    └── LazyMedia
        └── VideoPlayer
            ├── ArtPlayer 或 NativeVideoCore
            ├── ChapterSidebar
            ├── ChapterDrawer
            ├── TimelineMarkers
            └── ChapterTooltip
```

建议先做章节能力抽象，再决定是否立即切换 ArtPlayer。

第一阶段可以保留原生 `<video>`，减少变量；播放器能力稳定后再替换 ArtPlayer。

## 5. VideoPlayer Props

建议调整：

```ts
export interface VideoPlayerProps {
  src: string
  chaptersUrl?: string | null
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  className?: string
  onPlay?: () => void
  onPause?: () => void
  onError?: (error: string) => void
}
```

`LazyMedia` 需要从当前媒体项传入章节 URL。

当前 `LazyMedia` 只接收 `src`，后续建议改成：

```ts
interface LazyMediaProps {
  media: ArtworkImageResponseDto
  index: number
}
```

过渡期也可以增加可选字段：

```ts
interface LazyMediaProps {
  src: string
  chaptersUrl?: string | null
  index: number
  width?: number | null
  height?: number | null
  size?: number | null
}
```

## 6. 章节加载设计

新增 hook：

```text
packages/pixishelf/components/players/use-video-chapters.ts
```

职责：

```ts
export function useVideoChapters(chaptersUrl?: string | null) {
  return {
    chapters,
    duration,
    loading,
    error,
    reload
  }
}
```

行为：

```text
1. chaptersUrl 为空时不请求。
2. 请求成功后标准化 chapters。
3. 请求 404 时视为无章节，不显示错误。
4. 其他请求失败时记录 error，但不阻断视频播放。
5. 组件卸载时 abort fetch。
```

错误展示：

- 作品页播放器不弹 toast。
- 仅在章节面板区域展示轻量状态。
- 视频主体继续播放。

## 7. 当前章节计算

新增 hook：

```text
packages/pixishelf/components/players/use-current-chapter.ts
```

输入：

```ts
chapters: NormalizedChapter[]
currentTime: number
```

逻辑：

```ts
const currentChapter = chapters.find(
  chapter => currentTime >= chapter.start && currentTime < chapter.end
)
```

边界：

- 如果播放时间等于最后一章 `end`，当前章节取最后一章。
- 如果章节之间有空隙，空隙期间无当前章节。
- 如果视频 duration 与 manifest duration 不一致，以播放器 duration 为 UI 百分比基准，以章节 start/end 为跳转基准。

## 8. 章节跳转

播放器核心需要暴露 seek 行为：

```ts
function seekTo(seconds: number) {
  video.currentTime = seconds
}
```

章节点击：

```ts
function seekToChapter(chapter: NormalizedChapter) {
  seekTo(chapter.start)
}
```

交互要求：

- 点击章节后立即跳转。
- 如果视频暂停，默认保持暂停，只更新时间。
- 如果视频正在播放，跳转后继续播放。
- 当前章节滚动到可视区域。

## 9. Timeline Marker 设计

统一 marker 抽象：

```ts
export interface TimelineMarker {
  id: string
  type: 'chapter' | 'favorite' | 'bookmark' | 'note'
  title: string
  time: number
}
```

章节转换：

```ts
const markers = chapters.map(chapter => ({
  id: chapter.id,
  type: 'chapter',
  title: chapter.title,
  time: chapter.start
}))
```

位置计算：

```ts
const percent = duration > 0 ? marker.time / duration * 100 : 0
```

渲染要求：

- marker 不改变进度条高度。
- marker 最小点击宽度建议 8px，但视觉宽度可为 2px。
- marker tooltip 显示章节标题和时间。
- marker 点击跳转到对应时间。

## 10. ChapterSidebar 设计

桌面端显示在播放器右侧或播放器下方，具体布局按详情页宽度自适应。

建议 Props：

```ts
interface ChapterSidebarProps {
  chapters: NormalizedChapter[]
  currentChapterId?: string
  onChapterClick: (chapter: NormalizedChapter) => void
}
```

显示内容：

```text
章节
12 段

01  Opening       00:00
02  Main Part     00:12
03  Ending        01:32
```

状态：

- 无章节：不渲染整个章节区域。
- 加载中：显示骨架或小号 loading。
- 加载失败：显示“章节加载失败”。
- 当前章节：高亮背景和左侧强调线。

样式原则：

- 不使用大卡片套卡片。
- 控件保持紧凑，适合详情页内容阅读。
- 文案不要解释功能，只展示内容和状态。

## 11. ChapterDrawer 移动端设计

移动端使用已有 `Drawer` 或 `Dialog` 组件。

触发按钮：

```text
章节
```

或图标按钮加 tooltip。

位置：

- 播放器控制层右下角。
- 有章节时显示。
- 无章节时隐藏。

抽屉内容复用 `ChapterSidebar` 的列表渲染。

## 12. ArtPlayer 接入策略

设计文档 `video.md` 已经规划使用 ArtPlayer。建议分两步：

### 12.1 先实现章节能力

先保留当前 `VideoPlayer` 的原生 video 核心：

- 风险小。
- 可以复用已有 loading、error、剩余时间逻辑。
- 能先验证后端章节接口和章节 UI。

### 12.2 再替换 ArtPlayer

ArtPlayer 接入时保留同一套章节 hook 和 UI 组件。

核心变化：

```ts
art.currentTime = chapter.start

art.on('video:timeupdate', () => {
  setCurrentTime(art.currentTime)
})
```

外层 `VideoPlayerProps` 不变。

## 13. 作品页接入点

当前：

```tsx
<VideoPlayer src={src} className="w-full h-auto" preload="metadata" />
```

目标：

```tsx
<VideoPlayer
  src={media.path}
  chaptersUrl={media.chaptersUrl}
  className="w-full h-auto"
  preload="metadata"
/>
```

因此 `ArtworkImages` 到 `LazyMedia` 的传参需要能拿到完整 media 对象，而不是只传 path。

## 14. 开发阶段计划

### Phase F1 - DTO 接入与 LazyMedia 改造

任务：

- 扩展前端类型，识别 `chaptersUrl`、`hasChapters`。
- 改造 `LazyMedia` 接收完整媒体对象或可选 `chaptersUrl`。
- 保持图片、APNG、WebP 和视频现有渲染不回退。

验收：

- 无章节视频播放表现与当前一致。
- 有章节视频能把 `chaptersUrl` 传入 `VideoPlayer`。

### Phase F2 - 章节加载 Hook

任务：

- 新增 `use-video-chapters.ts`。
- 实现请求、AbortController、404 空状态、错误状态。
- 标准化章节数据。
- 补 hook 单元测试。

验收：

- `chaptersUrl = null` 不发请求。
- 404 不影响视频播放。
- 合法 manifest 返回标准化章节数组。

### Phase F3 - 当前章节与跳转

任务：

- 新增 `use-current-chapter.ts`。
- 在 `VideoPlayer` 中维护 `currentTime`。
- 实现 `seekToChapter`。
- 点击章节能跳转。

验收：

- 播放时当前章节随时间更新。
- 点击章节后视频跳到章节起点。
- 暂停和播放状态符合预期。

### Phase F4 - 桌面章节列表

任务：

- 新增 `ChapterSidebar`。
- 实现章节列表、时间格式化、当前章节高亮。
- 当前章节变化时滚动到可视区域。

验收：

- 有章节时显示列表。
- 无章节时不占位。
- 当前章节高亮准确。

### Phase F5 - 进度条 Marker

任务：

- 新增 `TimelineMarkers`。
- 将章节转换为 marker。
- 在进度条上渲染章节开始位置。
- 支持 hover tooltip 和点击跳转。

验收：

- marker 位置与章节 start 匹配。
- hover 显示标题和时间。
- 点击 marker 跳转。
- marker 不导致进度条布局抖动。

### Phase F6 - 移动端章节面板

任务：

- 新增 `ChapterDrawer`。
- 小屏幕隐藏桌面章节列表，显示章节入口。
- 抽屉复用章节列表逻辑。

验收：

- 移动端可以打开章节列表。
- 点击章节后跳转并关闭抽屉。
- 按钮和文本不溢出。

### Phase F7 - ArtPlayer 替换

任务：

- 引入 ArtPlayer。
- 保持 `VideoPlayerProps` 不变。
- 用 ArtPlayer 事件替换原生 video 事件。
- 保留章节 hooks 和 UI。
- 处理组件卸载 destroy。

验收：

- 播放、暂停、跳转、全屏、倍速可用。
- 章节列表和 marker 仍可用。
- 切换作品或卸载时无重复实例和内存泄漏。

### Phase F8 - 扩展 Marker 系统

任务：

- 抽象 `TimelineMarker`。
- 章节 marker 作为第一种 marker。
- 预留收藏点、书签、笔记、AI 标签入口。

验收：

- 章节 marker 逻辑不绑定章节专用组件。
- 后续添加 bookmark 不需要重写 timeline。

## 15. 测试计划

单元测试：

- `useVideoChapters`。
- `useCurrentChapter`。
- 时间格式化。
- marker 百分比计算。

组件测试：

- 无章节视频。
- 有章节视频。
- 章节加载失败。
- 点击章节跳转。

手动测试：

```text
1. 普通 mp4 无章节。
2. mp4 + chapters.json。
3. chaptersUrl 404。
4. chapters.json 格式错误。
5. 移动端宽度。
6. 多个视频的作品详情页。
```

## 16. 风险与注意事项

- 前端不要根据 `src` 拼 `.chapters.json`，避免路径规则泄漏到 UI 层。
- 章节请求失败不能让视频进入错误状态。
- marker 数量很多时需要限制 tooltip 渲染成本。
- 当前详情页可能一次渲染多个视频，播放器实例和章节请求要注意懒加载。
- ArtPlayer 替换应作为独立阶段，避免和后端章节接入混在一起。

## 17. 推荐开发顺序

```text
F1 DTO 接入
F2 章节加载
F3 当前章节与跳转
F4 桌面章节列表
F5 进度条 Marker
F6 移动端面板
F7 ArtPlayer 替换
F8 Marker 扩展
```

前端第一闭环目标：

```text
作品页打开视频
-> 自动加载章节
-> 显示章节列表
-> 点击章节跳转
```

完成这个闭环后，再增强 marker、移动端和 ArtPlayer。
