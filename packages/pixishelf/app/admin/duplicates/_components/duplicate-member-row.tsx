import type { ArtworkDedupMemberDto } from '@pixishelf/job-contracts'
import { ImageIcon } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { duplicateSourceLabel } from './duplicate-operation-state'

export function DuplicateMemberRow({
  member,
  keeper,
  recommended,
  disabled,
  name,
  onKeep,
  children
}: {
  member: ArtworkDedupMemberDto
  keeper: boolean
  recommended?: boolean
  disabled?: boolean
  name?: string
  onKeep?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 py-2">
      <label className={cn('flex min-h-11 min-w-0 items-center gap-3', onKeep && !disabled && 'cursor-pointer')}>
        {onKeep ? (
          <span className="flex size-11 shrink-0 items-center justify-center">
            <input
              type="radio"
              name={name}
              checked={keeper}
              disabled={disabled}
              onChange={onKeep}
              aria-label={`保留 ${member.title}`}
              className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            />
          </span>
        ) : null}
        <div
          className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
          data-privacy-sensitive=""
        >
          {member.thumbnailUrl ? (
            <img src={member.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <PrivacySensitiveText className="line-clamp-2 break-words text-sm font-medium">
            {member.title}
          </PrivacySensitiveText>
          <span className="text-xs text-muted-foreground">{duplicateSourceLabel(member.sourceLabel)}</span>
          {member.otherAccountHasOrganization ? (
            <span className="text-xs text-muted-foreground">还有其他账户整理记录</span>
          ) : null}
        </span>
        {keeper ? (
          <Badge variant="info" className="shrink-0">
            {recommended ? '推荐保留' : '保留'}
          </Badge>
        ) : null}
      </label>
      {children ? <div className="pl-4 text-sm leading-6 sm:pl-14">{children}</div> : null}
    </div>
  )
}
