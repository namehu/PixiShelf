
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react'

interface Props {
  series: {
    id: number
    title: string
    order: number
    prev: { id: number; title: string } | null
    next: { id: number; title: string } | null
  }
}

export default function SeriesNav({ series }: Props) {
  if (!series) return null

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border my-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild disabled={!series.prev}>
          {series.prev ? (
            <Link href={`/artworks/${series.prev.id}`} title={series.prev.title}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              上一篇
            </Link>
          ) : (
            <span>
              <ChevronLeft className="w-4 h-4 mr-1" />
              上一篇
            </span>
          )}
        </Button>
      </div>

      <div className="flex flex-col items-center">
        <Link href={`/series/${series.id}`} className="flex items-center gap-2 font-medium hover:underline text-center">
           <BookOpen className="w-4 h-4" />
           {series.title}
        </Link>
        <span className="text-xs text-muted-foreground">第 {series.order} 话</span>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild disabled={!series.next}>
          {series.next ? (
             <Link href={`/artworks/${series.next.id}`} title={series.next.title}>
              下一篇
              <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          ) : (
             <span>
              下一篇
              <ChevronRight className="w-4 h-4 ml-1" />
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}
