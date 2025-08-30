import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { useInView } from 'react-intersection-observer'
import { apiJson } from '../api'
import { Artwork } from '@pixishelf/shared'
import { PageContainer } from '../components/PageContainer'

function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async (): Promise<Artwork> => {
      return apiJson<Artwork>(`/api/v1/artworks/${id}`)
    }
  })
}

// 懒加载图片组件
function LazyImage({
  src,
  alt,
  index,
  onInView
}: {
  src: string
  alt: string
  index: number
  onInView: (index: number, inView: boolean) => void
}) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: '200px 0px', // 预加载：提前200px开始加载
    triggerOnce: true
  })

  const { ref: viewRef, inView: isInViewport } = useInView({
    threshold: 0.5, // 当图片50%可见时认为是当前图片
    rootMargin: '0px'
  })

  useEffect(() => {
    onInView(index, isInViewport)
  }, [isInViewport, index, onInView])

  return (
    <div
      ref={(node) => {
        ref(node)
        viewRef(node)
      }}
      className="overflow-hidden bg-neutral-100 flex items-center justify-center"
    >
      {inView ? (
        <img src={src} alt={alt} loading="lazy" className="w-full h-auto object-contain" />
      ) : (
        <div className="w-full h-96 bg-neutral-200 animate-pulse flex items-center justify-center">
          <svg className="w-12 h-12 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  )
}

export default function ArtworkDetail() {
  const params = useParams()
  const id = params.id!
  const { data, isLoading, isError } = useArtwork(id)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [visibleImages, setVisibleImages] = useState<Set<number>>(new Set())

  // 确保页面加载时滚动到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id]) // 当id变化时也滚动到顶部

  // 处理图片进入/离开视口
  const handleImageInView = (index: number, inView: boolean) => {
    setVisibleImages((prev) => {
      const newSet = new Set(prev)
      if (inView) {
        newSet.add(index)
      } else {
        newSet.delete(index)
      }
      return newSet
    })

    // 更新当前图片索引为最小的可见图片索引
    if (inView) {
      setCurrentImageIndex(index)
    }
  }

  // 图片序号指示器组件 - 用于导航中间区域
  const ImageCounter = () => {
    if (!data || !data.images || data.images.length === 0) return null

    return (
      <div className="flex items-center gap-2 text-neutral-500">
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="font-mono text-sm">
            <span className="text-neutral-900 font-medium">{currentImageIndex + 1}</span>
            <span className="mx-1 text-neutral-400">/</span>
            <span className="text-neutral-600">{data.images.length}</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <PageContainer centerContent={<ImageCounter />}>
      <section className="space-y-8 px-6 py-8">
        {/* Loading State */}
        {isLoading && (
          <div className="space-y-8">
            {/* Header skeleton */}
            <div className="space-y-4">
              <div className="skeleton h-8 w-64" />
              <div className="skeleton h-5 w-32" />
              <div className="flex gap-2">
                <div className="skeleton h-6 w-16 rounded-full" />
                <div className="skeleton h-6 w-20 rounded-full" />
                <div className="skeleton h-6 w-18 rounded-full" />
              </div>
            </div>

            {/* Images skeleton */}
            <div className="max-w-4xl mx-auto space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton aspect-[4/3] rounded-2xl" />
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="card p-8 text-center max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 bg-error-50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">加载失败</h3>
            <p className="text-neutral-600 mb-4">无法加载作品详情，请稍后重试。</p>
            <button onClick={() => window.location.reload()} className="btn-primary">
              重新加载
            </button>
          </div>
        )}

        {/* Content */}
        {data && (
          <div className="animate-fade-in">
            {/* Header */}
            <div className="space-y-8">
              {/* Breadcrumb */}
              <nav className="flex items-center space-x-2 text-sm text-neutral-600">
                <a href="/" className="hover:text-primary-600 transition-colors">
                  画廊
                </a>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-neutral-900 font-medium">作品详情</span>
              </nav>

              {/* Title and Artist */}
              <div className="space-y-3">
                <h1 className="text-4xl font-bold text-neutral-900 leading-tight">{data.title}</h1>
                {data.artist?.name && (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <span className="text-lg text-neutral-700 font-medium">{data.artist.name}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {data.tags && data.tags.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                    <h3 className="text-lg font-semibold text-neutral-900">标签</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.tags.map((tag: string, index: number) => (
                      <span key={index} className="tag tag-accent">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            {data.description && (
              <div className=" mt-8">
                <h3 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  描述
                </h3>
                <p className="card p-8 text-neutral-700 leading-relaxed whitespace-pre-wrap">{data.description}</p>
              </div>
            )}

            {/* Images */}
            <div className="space-y-8 mt-8">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <h3 className="text-lg font-semibold text-neutral-900">图片 ({data.images?.length || 0})</h3>
              </div>

              {/* Image Gallery */}
              <div className="max-w-4xl mx-auto ">
                {(data.images || []).map((img: any, index: number) => (
                  <LazyImage
                    key={img.id}
                    src={`/api/v1/images/${img.path}`}
                    alt={`${data.title} - 图片 ${index + 1}`}
                    index={index}
                    onInView={handleImageInView}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  )
}
