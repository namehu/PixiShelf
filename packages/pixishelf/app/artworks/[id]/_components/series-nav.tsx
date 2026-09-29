import Link from 'next/link'
import { BookOpenIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface SeriesArtworkLink {
  id: number
  title: string
}

interface Props {
  series: {
    id: number
    title: string
    order: number
    prev: SeriesArtworkLink | null
    next: SeriesArtworkLink | null
  }
}

function PreviousButton({ artwork }: { artwork: SeriesArtworkLink | null }) {
  if (!artwork) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
        上一篇
      </Button>
    )
  }

  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={`/artworks/${artwork.id}`} aria-label={`上一篇：${artwork.title}`}>
        <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
        上一篇
      </Link>
    </Button>
  )
}

function NextButton({ artwork }: { artwork: SeriesArtworkLink | null }) {
  if (!artwork) {
    return (
      <Button variant="ghost" size="sm" disabled>
        下一篇
        <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
      </Button>
    )
  }

  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={`/artworks/${artwork.id}`} aria-label={`下一篇：${artwork.title}`}>
        下一篇
        <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
      </Link>
    </Button>
  )
}

export default function SeriesNav({ series }: Props) {
  return (
    <nav
      aria-label="系列作品导航"
      className="my-8 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-y border-border py-4"
    >
      <PreviousButton artwork={series.prev} />

      <Link
        href={`/series/${series.id}`}
        className="flex min-w-0 flex-col items-center rounded-md px-2 py-1 text-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <BookOpenIcon className="size-4 shrink-0" aria-hidden="true" />
          <PrivacySensitiveText className="truncate">{series.title}</PrivacySensitiveText>
        </span>
        <span className="font-utility text-xs text-muted-foreground">第 {series.order} 话</span>
      </Link>

      <NextButton artwork={series.next} />
    </nav>
  )
}
