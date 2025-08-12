import React from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../api'
import { Artwork } from '@pixishelf/shared'

function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async (): Promise<Artwork> => {
      return apiJson<Artwork>(`/api/v1/artworks/${id}`)
    }
  })
}

export default function ArtworkDetail() {
  const params = useParams()
  const id = params.id!
  const { data, isLoading, isError } = useArtwork(id)

  return (
    <section>
      {isLoading && (
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200 animate-pulse" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-lg bg-gray-200 animate-pulse" />
          ))}
        </div>
      )}
      {isError && <div className="text-red-600">加载失败，请稍后重试。</div>}
      {data && (
        <>
          <h2 className="mb-4 text-xl font-semibold">{data.title}</h2>
          {data.artist?.name && <div className="mb-2 text-sm text-gray-600">{data.artist.name}</div>}
          {data.tags && data.tags.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {data.tags.map((tag: string, index: number) => (
                <span
                  key={index}
                  className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {/* 竖直瀑布流展示，去掉图片间距 */}
          <div className="mx-auto max-w-3xl">
            {(data.images || []).map((img: any) => (
              <div key={img.id} className="overflow-hidden bg-gray-100">
                <img
                  src={`/api/v1/images/${img.path}`}
                  alt={data.title}
                  loading="lazy"
                  className="w-full h-auto object-contain"
                />
              </div>
            ))}
          </div>
          {data.description && <p className="mt-6 text-gray-700 whitespace-pre-wrap">{data.description}</p>}
        </>
      )}
    </section>
  )
}
