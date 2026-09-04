import { FingerprintIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function ArchiveUploaderUidConflictAlert({ message }: { message: string }) {
  return (
    <Alert variant="warning">
      <FingerprintIcon aria-hidden="true" />
      <AlertTitle>UID 自动匹配冲突</AlertTitle>
      <AlertDescription>{message}；请在“绑定 UID”中重新匹配并查看已有来源。</AlertDescription>
    </Alert>
  )
}
