import React from 'react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import TagArea from './_components/TagArea'
import LazyMedia from './_components/LazyMedia'
import ArtworkDes from './_components/ArtworkDes'
import RelatedArtworks from './_components/RelatedArtworks'
import { getArtworkById } from '@/services/artwork-service'
import z from 'zod'
import NavHead from './_components/NavHead'
import SeriesNav from './_components/SeriesNav'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'
import { notFound } from 'next/navigation'

export default async function ArtworkDetailPage({ params }: PageProps<'/artworks/[id]'>) {
  const { id } = await params
  const data = await getArtworkById(z.coerce.number().parse(id))

  if (!data) {
    notFound()
  }

  const { id: artistId, name: artistName, avatar: artistAvatar } = data.artist ?? {}

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto pt-16 lg:px-8">
        <div className="bg-white max-w-2xl mx-auto">
          {/* 导航栏 */}
          <NavHead data={data} id={id} />
          {/* 主内容 */}
          <div className="max-w-full overflow-hidden">
            {/* Header */}
            <div className="mt-6 px-6 space-y-4">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight break-words">
                {data.title}
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                {data.artist && (
                  <Link
                    href={`/artists/${artistId}`}
                    className="flex items-center gap-2 min-w-0 cursor-pointer group hover:bg-gray-50 p-1 -ml-1 pr-3 rounded-full transition-colors"
                  >
                    <ArtistAvatar src={artistAvatar} name={artistName} size={10} />
                    <div className="text-base sm:text-lg text-blue-600 group-hover:text-blue-800 font-medium truncate transition-colors duration-200 underline-offset-2 group-hover:underline">
                      {artistName}
                    </div>
                  </Link>
                )}

                {data.externalId && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-8 gap-1.5 rounded-full text-muted-foreground hover:text-[#0096fa] hover:border-[#0096fa]/30 hover:bg-[#0096fa]/5 transition-all"
                  >
                    <a
                      href={`https://www.pixiv.net/artworks/${data.externalId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 Pixiv 查看该作品"
                    >
                      <span className="font-semibold text-xs uppercase tracking-wide">Pixiv</span>
                      <span className="w-px h-3 bg-border mx-0.5" />
                      <span className="font-mono text-xs">{data.externalId}</span>
                      <ExternalLink className="ml-0.5 w-3 h-3 opacity-50" />
                    </a>
                  </Button>
                )}
              </div>

              {/* Tags */}
              <TagArea tags={data.tags} />
            </div>

            {/* Description */}
            <ArtworkDes description={data.description} className="mt-6 px-6" />

            {/* Images */}
            <div className="w-full px-4">
              {data.images.map((img, index) => (
                <LazyMedia key={img.id} src={img.path} index={index} />
              ))}
            </div>

            {/* Series Navigation */}
            {data.series && (
              <div className="px-4">
                <SeriesNav series={data.series} />
              </div>
            )}

            {/* Related Artworks */}
            {artistId && <RelatedArtworks artistId={artistId} currentArtworkId={data.id} />}
          </div>
        </div>
      </main>
    </div>
  )
}
