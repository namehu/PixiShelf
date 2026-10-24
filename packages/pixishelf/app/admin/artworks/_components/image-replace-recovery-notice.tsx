'use client'
import { RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
export function ImageReplaceRecoveryNotice({
  pendingCommit,
  busy,
  onRecover,
  onError
}: {
  pendingCommit: boolean
  busy: boolean
  onRecover: () => Promise<unknown>
  onError: () => void
}) {
  return (
    <Alert>
      <RotateCcw aria-hidden="true" />
      <AlertTitle>有未结束的替换会话</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{pendingCommit ? '继续确认上次提交的结果。' : '可重新选择原文件继续上传，或恢复原文件。'}</p>
        <Button
          variant="outline"
          className="min-h-11 self-start"
          disabled={busy}
          onClick={() => {
            void onRecover().catch((error) => {
              onError()
              toast.error(error instanceof Error ? error.message : '恢复失败')
            })
          }}
        >
          {pendingCommit ? '重试原提交' : '恢复原文件'}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
