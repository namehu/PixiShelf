实现类似 抖音/TikTok 那样的 沉浸式图片浏览的功能。要实现无限上下滑动查看图片的功能。可以使用三方的组件库。另外这个功能 移动端优先 pc也考虑下怎么适配

### 核心技术栈推荐

为了高效且稳定地实现这个功能，我推荐以下技术组合：

1.  **滚动与滑动核心：`Swiper.js` (`swiper/react`)**

      * **为什么选择它？** Swiper 是一个功能极其强大且成熟的触摸滑动库。它原生支持垂直滚动模式、懒加载、虚拟化（只渲染可见的几个 слайд）、键盘控制（PC 适配）、以及丰富的事件回调（如“滚动到底部”），是实现此功能的完美选择。

2.  **数据请求与缓存：`TanStack Query` (`@tanstack/react-query`)**

      * **为什么选择它？** 您之前的代码中已经在使用它了。其提供的 `useInfiniteQuery` hook 是专门为“无限滚动”场景设计的，可以极大地简化数据分页、加载、缓存和状态管理。

3.  **UI 与布局：`Tailwind CSS`**

      * **为什么选择它？** 它的移动端优先和响应式设计理念，可以让我们非常方便地编写出同时适配手机和PC的样式。

-----

### 设计与架构

我们将功能拆分为三个主要部分：数据获取层、UI展现层、以及响应式适配。

#### 1\. 数据获取层：实现“无限”

我们将使用 `useInfiniteQuery` 来分批次加载图片数据。

首先，假设你有一个API端点 `GET /api/images`，它接受 `page` 和 `pageSize` 参数，并返回如下格式的数据：

```json
{
  "items": [
    { "id": "1", "url": "...", "author": "..." },
    { "id": "2", "url": "...", "author": "..." }
  ],
  "nextPage": 2, // 下一页的页码，如果没有更多则为 null
  "total": 100
}
```

现在，我们可以创建一个自定义 Hook 来获取这些数据：

```typescript
// src/hooks/useInfiniteImages.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api'; // 假设您有这个API请求函数

interface Image {
  id: string;
  url: string;
  author: string;
  // ... 其他图片信息
}

interface ImagesResponse {
  items: Image[];
  nextPage: number | null;
  total: number;
}

export function useInfiniteImages(pageSize: number = 10) {
  return useInfiniteQuery({
    queryKey: ['images', 'infinite'],
    queryFn: async ({ pageParam = 1 }): Promise<ImagesResponse> => {
      return apiJson<ImagesResponse>(`/api/images?page=${pageParam}&pageSize=${pageSize}`);
    },
    // getNextPageParam 告诉 React Query 如何找到下一页的页码
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1, // 初始页码
  });
}
```

#### 2\. UI 展现层：实现“沉浸式滑动”

这是核心的视图组件。它将接收 `useInfiniteImages` 返回的数据并使用 `Swiper` 进行渲染。

```typescript
// src/components/ImmersiveImageViewer.tsx
'use client';

import { Swiper, SwiperSlide } from 'swiper/react';
import { Mousewheel, Keyboard } from 'swiper/modules';
import Image from 'next/image'; // 使用 Next.js 的 Image 组件进行优化
import type { Image as ImageType } from '@/hooks/useInfiniteImages';

// 导入 Swiper 的核心和模块样式
import 'swiper/css';
import 'swiper/css/mousewheel';
import 'swiper/css/keyboard';

interface ImmersiveImageViewerProps {
  initialImages: ImageType[];
  onLoadMore: () => void; // 加载更多的回调函数
  hasMore: boolean;
  isLoading: boolean;
}

export default function ImmersiveImageViewer({
  initialImages,
  onLoadMore,
  hasMore,
  isLoading
}: ImmersiveImageViewerProps) {

  return (
    // PC端适配容器
    <div className="w-full h-full bg-black md:flex md:items-center md:justify-center">
      {/* 沉浸式查看器主容器 */}
      <div className="immersive-container h-full w-full md:max-w-[420px] md:h-[90vh] md:aspect-[9/16] md:rounded-lg relative bg-neutral-900">
        <Swiper
          // 关键配置：垂直方向
          direction="vertical"
          // 在PC上启用鼠标滚轮
          mousewheel={true}
          // 在PC上启用键盘上下键
          keyboard={{ enabled: true }}
          modules={[Mousewheel, Keyboard]}
          className="h-full w-full"
          // 关键事件：当滑动到最后一个 slide 时触发
          onReachEnd={() => {
            if (hasMore && !isLoading) {
              onLoadMore();
            }
          }}
          // 为了更好的性能，只渲染激活slide的前后各一个
          slidesPerView={1}
          preloadImages={false}
          lazyPreloadPrevNext={1}
        >
          {initialImages.map((image) => (
            <SwiperSlide key={image.id} className="flex items-center justify-center">
              {/* 图片容器 */}
              <div className="relative w-full h-full">
                <Image
                  src={image.url}
                  alt={`Image by ${image.author}`}
                  fill // 填充整个父容器
                  style={{ objectFit: 'contain' }} // 保持图片比例，完整显示
                  sizes="(max-width: 768px) 100vw, 420px" // 响应式尺寸优化
                  priority={initialImages.indexOf(image) < 3} // 优先加载前三张图片
                />
              </div>

              {/* UI 覆盖层 (例如：作者信息、操作按钮等) */}
              <div className="absolute bottom-10 left-4 text-white z-10">
                <p className="font-bold text-lg">@{image.author}</p>
                {/* ... 其他信息 */}
              </div>
            </SwiperSlide>
          ))}

          {/* 如果还有更多数据，显示加载提示 */}
          {hasMore && (
            <SwiperSlide className="flex items-center justify-center text-white">
              {isLoading ? '加载中...' : '继续向上滑动...'}
            </SwiperSlide>
          )}
        </Swiper>
      </div>
    </div>
  );
}
```

#### 3\. 页面整合

最后，在你的 Next.js 页面中将数据层和UI层连接起来。

```typescript
// src/app/viewer/page.tsx (或者任何你想要的路由)
'use client';

import { useInfiniteImages } from '@/hooks/useInfiniteImages';
import ImmersiveImageViewer from '@/components/ImmersiveImageViewer';
import { useMemo } from 'react';

export default function ViewerPage() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isError,
  } = useInfiniteImages();

  // 将分页数据扁平化为一个数组
  const allImages = useMemo(() => data?.pages.flatMap(page => page.items) ?? [], [data]);

  if (isError) {
    return <div>加载失败...</div>;
  }

  // 初始加载时显示骨架屏或loading
  if (isLoading && !data) {
    return <div>Loading...</div>;
  }

  if (!allImages.length) {
    return <div>没有图片</div>;
  }

  return (
    // 设置页面高度为全屏，并隐藏滚动条
    <main className="h-screen w-screen overflow-hidden bg-black">
      <ImmersiveImageViewer
        initialImages={allImages}
        onLoadMore={fetchNextPage}
        hasMore={!!hasNextPage}
        isLoading={isLoading}
      />
    </main>
  );
}
```

-----

### 响应式适配 (PC端)

上述代码已经包含了PC端的适配逻辑，核心思路是：

1.  **限制视口宽度**：在PC端，全屏的垂直内容体验不佳。我们用一个 `div` 包裹 `Swiper` 容器，在中断点 `md` (通常是 `768px`) 以上时，给它一个最大宽度 `md:max-w-[420px]` 和一个类似手机的宽高比 `md:aspect-[9/16]`。
2.  **居中显示**：通过 Flexbox (`md:flex md:items-center md:justify-center`) 将这个手机尺寸的容器在PC屏幕上水平和垂直居中。
3.  **背景处理**：整个页面背景设为黑色 `bg-black`，营造沉浸感。你也可以更进一步，用当前图片的模糊版本作为背景，效果会更佳。
4.  **交互方式**：除了触摸滑动，我们为 `Swiper` 启用了 `mousewheel` 和 `keyboard` 模块，这样PC用户可以通过**鼠标滚轮**或**键盘的上下方向键**来切换图片，提供了良好的桌面端体验。

### 总结与优化建议

  * **URL同步**：为了让用户可以分享特定图片，您可以在 `Swiper` 的 `onSlideChange` 事件中，使用 `router.replace` 更新 URL 的查询参数（例如 `/viewer?imageId=xxx`），同时不触发页面重载。
  * **图片优化**：务必使用 Next.js 的 `<Image>` 组件。它会自动处理图片格式（WebP）、尺寸优化、懒加载等，对性能至关重要。
  * **手势交互**：可以引入 `framer-motion` 或 `react-use-gesture` 库，在图片上增加双击点赞、长按显示菜单等更丰富的手势交互。
  * **骨架屏 (Skeleton)**：在初始加载和加载更多时，使用骨架屏可以提供更好的用户体验，而不是简单的“加载中...”文本。

### 资源

采用当前技术栈框架体系  对应api端口开一个新的接口。基于prisma 查询 Artwork 表中所有图片数量只有一张的的数据 并随机取值。 不用关心重复问题。只要无限滚动支持就行
