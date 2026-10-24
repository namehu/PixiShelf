import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function DuplicateQueryError({
  onRetry,
  busy = false,
  message = '加载失败，已保留当前内容。'
}: {
  onRetry: () => void
  busy?: boolean
  message?: string
}) {
  return (
    <Alert>
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onRetry}>
          重新加载
        </Button>
      </AlertDescription>
    </Alert>
  )
}
export function DuplicateLoading({ label = '正在加载检查结果' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-6 py-6">
      <p className="text-sm text-muted-foreground">{label}…</p>
      {[0, 1].map((key) => (
        <div key={key} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  )
}
