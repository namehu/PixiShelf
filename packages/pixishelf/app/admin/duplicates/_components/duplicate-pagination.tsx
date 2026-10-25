import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DuplicatePagination({
  page,
  hasNext,
  busy,
  onPrevious,
  onNext,
  label = '结果分页'
}: {
  page: number
  hasNext: boolean
  busy: boolean
  onPrevious: () => void
  onNext: () => void
  label?: string
}) {
  if (page === 0 && !hasNext) return null
  return (
    <nav aria-label={label} className="flex items-center justify-end gap-2 py-4">
      <Button type="button" className="min-h-11" variant="ghost" disabled={page === 0 || busy} onClick={onPrevious}>
        <ChevronLeft data-icon="inline-start" aria-hidden="true" />
        上一页
      </Button>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-current="page">
        {page + 1}
      </span>
      <Button type="button" className="min-h-11" variant="ghost" disabled={!hasNext || busy} onClick={onNext}>
        下一页
        <ChevronRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </nav>
  )
}
