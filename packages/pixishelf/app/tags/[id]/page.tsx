import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSerializer, parseAsInteger, parseAsString } from 'nuqs/server'
import { BookOpenTextIcon, ImageUpIcon, TagIcon, WallpaperIcon } from 'lucide-react'
import { getById } from '@/services/tag-service'
import { getTranslateName } from '@/utils/tags'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ArtworkList } from './_components/artwork-list'
import { NavBack } from './_components/nav-back'
import { Button } from '@/components/ui/button'
import PageToolbar from '@/components/layout/page-toolbar'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'

const serializeViewerQuery = createSerializer({
  source: parseAsString,
  sourceId: parseAsInteger,
  mode: parseAsString,
  sortBy: parseAsString,
  tags: parseAsString,
  tagLabels: parseAsString,
  mediaType: parseAsString
})

/**
 * 标签详情页面 (Server Component)
 */
export default async function TagDetailPage({ params }: PageProps<'/tags/[id]'>) {
  const { id } = await params
  const tagId = Number(id)

  if (isNaN(tagId)) {
    notFound()
  }

  const tag = await getById(tagId)

  if (!tag) {
    notFound()
  }

  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar
        containerSize="gallery"
        leading={<NavBack />}
        title={<span className="line-clamp-1 text-sm font-semibold text-foreground">{tag.name}</span>}
      />

      <PageContainer as="main" size="gallery" className="flex flex-col gap-9 py-6 sm:py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar className="size-20 rounded-lg bg-muted sm:size-24">
            <AvatarImage src={tag.image ?? ''} alt="" className="object-cover" />
            <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
              <TagIcon className="size-9" aria-hidden="true" />
            </AvatarFallback>
          </Avatar>

          <PageHeader
            className="min-w-0 flex-1"
            eyebrow="标签档案"
            title={tag.name}
            description={tag.description || undefined}
            metadata={
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {getTranslateName(tag) && <span>{getTranslateName(tag)}</span>}
                <span className="inline-flex items-center gap-1.5">
                  <WallpaperIcon className="size-3.5" aria-hidden="true" />
                  {tag.artworkCount} 件作品
                </span>
              </div>
            }
            actions={
              <Button asChild>
                <Link
                  href={serializeViewerQuery('/viewer', {
                    source: 'tag',
                    sourceId: tagId,
                    mode: 'ordered',
                    sortBy: 'source_date_desc',
                    tags: String(tagId),
                    tagLabels: encodeURIComponent(getTranslateName(tag) || tag.name),
                    mediaType: 'all'
                  })}
                >
                  <ImageUpIcon data-icon="inline-start" aria-hidden="true" />
                  沉浸浏览
                </Link>
              </Button>
            }
          />
        </div>

        {tag.abstract && (
          <section className="grid gap-2 rounded-xl border bg-card p-5" aria-labelledby="pixpedia-summary-title">
            <h2 id="pixpedia-summary-title" className="flex items-center gap-2 text-sm font-semibold">
              <BookOpenTextIcon className="size-4 text-primary" aria-hidden="true" />
              Pixpedia 简介
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{tag.abstract}</p>
          </section>
        )}

        <ArtworkList tagId={tagId} />
      </PageContainer>
    </div>
  )
}
