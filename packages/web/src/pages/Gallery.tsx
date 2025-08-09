import React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

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

export default function Gallery() {
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
              )}
            )}
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