'use client'

import { CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function ArchiveSubmissionBadge({ submissionId }: { submissionId: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-6 rounded-full px-2 text-xs"
      translate="no"
      aria-label={`复制本次加入 ID ${submissionId}`}
      title="复制完整的本次加入 ID"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(submissionId)
          toast.success('已复制本次加入 ID')
        } catch {
          window.prompt('请复制完整的本次加入 ID', submissionId)
        }
      }}
    >
      <CopyIcon aria-hidden="true" />
      本次加入 {shortArchiveSubmissionId(submissionId)}
    </Button>
  )
}

export function shortArchiveSubmissionId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value
}
