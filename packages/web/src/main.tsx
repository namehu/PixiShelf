import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link, useParams, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'
import './styles.css'

const queryClient = new QueryClient()

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold text-brand-700">Artisan Shelf</Link>
          <nav className="text-sm text-gray-600 flex items-center gap-4">
            <Link to="/" className="hover:text-gray-900">画廊</Link>
            <Link to="/settings" className="hover:text-gray-900">设置</Link>
            <span className="text-gray-400">V1.0</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-500">© {new Date().getFullYear()} Artisan Shelf</div>
      </footer>
    </div>
  )
}

function useArtworks(page: number, pageSize: number) {
  return useQuery({
    queryKey: ['artworks', page, pageSize],
    queryFn: async () => {
      const res = await fetch(`/api/v1/artworks?page=${page}&pageSize=${pageSize}`, {
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
      })
      if (!res.ok) throw new Error('Failed to fetch artworks')
      return res.json() as Promise<{ items: any[]; total: number; page: number; pageSize: number }>
    },
  })
}

function GalleryPage() {
  const [search] = useSearchParams()
  const page = Number(search.get('page') || '1')
  const pageSize = 24
  const { data, isLoading, isError } = useArtworks(page, pageSize)

  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">作品</h2>
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-lg bg-gray-200 animate-pulse" />
          ))}
        </div>
      )}
      {isError && (
        <div className="text-red-600">加载失败，请确认后端已启动并配置 API_KEY。</div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.items.map((aw) => {
              const cover = aw.images?.[0]
              const imgSrc = cover ? `/api/v1/images/${cover.path}` : undefined
              return (
                <Link key={aw.id} to={`/artworks/${aw.id}`} className="group block">
                  <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={aw.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-400">No Image</div>
                    )}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium text-gray-900">{aw.title}</div>
                  {aw.artist?.name && (
                    <div className="truncate text-xs text-gray-500">{aw.artist.name}</div>
                  )}
                </Link>
              )
            })}
          </div>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link to={`/?page=${Math.max(1, page - 1)}`} className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50" aria-disabled={page <= 1}>
              上一页
            </Link>
            <span className="text-sm text-gray-600">{page} / {Math.max(1, Math.ceil((data.total || 0) / pageSize))}</span>
            <Link to={`/?page=${page + 1}`} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
              下一页
            </Link>
          </div>
        </>
      )}
    </section>
  )
}

function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async () => {
      const res = await fetch(`/api/v1/artworks/${id}`, {
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
      })
      if (!res.ok) throw new Error('Failed to fetch artwork')
      return res.json() as Promise<any>
    },
  })
}

function ArtworkDetailPage() {
  const params = useParams()
  const id = params.id!
  const { data, isLoading, isError } = useArtwork(id)

  return (
    <section>
      {isLoading && (
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] rounded-lg bg-gray-200 animate-pulse" />
            ))}
          </div>
        </div>
      )}
      {isError && <div className="text-red-600">加载失败，请稍后重试。</div>}
      {data && (
        <>
          <h2 className="mb-2 text-xl font-semibold">{data.title}</h2>
          {data.artist?.name && <div className="mb-4 text-sm text-gray-600">{data.artist.name}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {(data.images || []).map((img: any) => (
              <div key={img.id} className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
                <img src={`/api/v1/images/${img.path}`} alt={data.title} loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
          {data.description && <p className="mt-4 text-gray-700 whitespace-pre-wrap">{data.description}</p>}
        </>
      )}
    </section>
  )
}

// ---- Settings Page ----

type ScanResult = {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  errors: string[]
}

function useManualScan() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
      })
      const text = await res.text()
      if (!res.ok) {
        try {
          const j = JSON.parse(text)
          throw new Error(j.message || '扫描失败')
        } catch {
          throw new Error(text || '扫描失败')
        }
      }
      return JSON.parse(text) as { success: boolean; result: ScanResult }
    },
  })
}

function SettingsPage() {
  const scan = useManualScan()
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    let timer: any
    if (scan.isPending) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [scan.isPending])

  const secondsToText = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const result = scan.data?.result

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-base font-medium">手动扫描</div>
            <div className="text-sm text-gray-500">扫描 SCAN_PATH 目录下的图片并同步到库中。扫描期间请保持页面打开。</div>
          </div>
          <button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
          >{scan.isPending ? '扫描中…' : '开始扫描'}</button>
        </div>

        {/* 状态区 */}
        {scan.isIdle && !scan.data && !scan.isError && (
          <div className="text-sm text-gray-600">状态：未开始</div>
        )}

        {scan.isPending && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-brand-500" style={{ animationName: 'progress' }} />
            </div>
            <div className="text-sm text-gray-600">扫描进行中… 已用时 {secondsToText(elapsed)}</div>
          </div>
        )}

        {scan.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            扫描失败：{(scan.error as Error)?.message || '未知错误'}
          </div>
        )}

        {result && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="text-green-700">扫描完成</div>
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded border bg-gray-50 p-2">扫描目录：<span className="font-medium">{result.scannedDirectories}</span></li>
              <li className="rounded border bg-gray-50 p-2">发现图片：<span className="font-medium">{result.foundImages}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增作品：<span className="font-medium">{result.newArtworks}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增图片：<span className="font-medium">{result.newImages}</span></li>
            </ul>
            {result.errors?.length > 0 && (
              <details className="rounded border bg-yellow-50 p-3">
                <summary className="cursor-pointer text-yellow-800">错误 {result.errors.length} 条（展开查看）</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-yellow-900">
                  {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 20 && <li>… 仅展示前 20 条</li>}
                </ul>
              </details>
            )}
            <div className="pt-2">
              <button
                onClick={() => scan.mutate()}
                className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
              >再次扫描</button>
            </div>
          </div>
        )}
      </div>

      {/* 自定义进度动画 keyframes */}
      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </section>
  )
}

const router = createBrowserRouter([
  { path: '/', element: <Layout><GalleryPage /></Layout> },
  { path: '/settings', element: <Layout><SettingsPage /></Layout> },
  { path: '/artworks/:id', element: <Layout><ArtworkDetailPage /></Layout> },
])

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)