import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function ArchiveDiscoverySourceError({
  notFound,
  onRetry,
  onReturn
}: {
  notFound: boolean
  onRetry: () => void
  onReturn: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{notFound ? '这个发现来源已不存在' : '发现来源加载失败'}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {notFound ? '它可能已在其他页面被删除。返回列表选择仍然存在的来源。' : '来源没有被判定为删除；请重试加载。'}
        </span>
        <div className="flex flex-wrap gap-2">
          {!notFound ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onReturn}>
            返回来源列表
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
