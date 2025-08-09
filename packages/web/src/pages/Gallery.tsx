import React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

function useArtworks(page: number, pageSize: number) {
  return useQuery({
    queryKey: ['artworks', page, pageSize],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY ?? ''
      const url = new URL('/api/v1/artworks', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', String(pageSize))
      if (apiKey) url.searchParams.set('apiKey', apiKey as string)
      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error('Failed to fetch artworks')
      return res.json() as Promise<{ items: any[]; total: number; page: number; pageSize: number }>
    },
  })
}

export default function Gallery() {
  const [search] = useSearchParams()
  const page = Number(search.get('page') || '1')
  const pageSize = 24
  const { data, isLoading, isError } = useArtworks(page, pageSize)

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages

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
              const count = aw._count?.images as number | undefined
              const artistName = aw.artist?.name as string | undefined
              return (
                <Link key={aw.id} to={`/artworks/${aw.id}`} className="group block">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
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
                    {typeof count === 'number' && count > 1 && (
                      <div className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{count}</div>
                    )}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium text-gray-900" title={aw.title}>{aw.title}</div>
                  {artistName && (
                    <div className="truncate text-xs text-gray-500" title={artistName}>{artistName}</div>
                  )}
                </Link>
              )}
            )}
          </div>
          <div className="mt-6 flex items-center justify-center gap-3">
            {canPrev ? (
              <Link to={`/?page=${page - 1}`} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
                上一页
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-sm text-gray-400 opacity-60 cursor-not-allowed select-none" aria-disabled="true">
                上一页
              </span>
            )}
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            {canNext ? (
              <Link to={`/?page=${page + 1}`} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
                下一页
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-sm text-gray-400 opacity-60 cursor-not-allowed select-none" aria-disabled="true">
                下一页
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}