import { FingerprintIcon } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function ArchiveUploaderUidConflictAlert({ message }: { message: string }) {
  return (
    <Alert variant="warning">
      <FingerprintIcon aria-hidden="true" />
      <AlertTitle>UID 自动匹配冲突</AlertTitle>
      <AlertDescription>
        <PrivacySensitiveText>{message}</PrivacySensitiveText>；请在“绑定 UID”中重新匹配并查看已有来源。
      </AlertDescription>
    </Alert>
  )
}
