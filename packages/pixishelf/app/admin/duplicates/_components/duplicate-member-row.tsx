import type { ArtworkDedupMemberDto } from '@pixishelf/job-contracts'
import { ExternalLink, ImageIcon } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { duplicateSourceLabel } from './duplicate-operation-state'

export function DuplicateMemberRow({
  member,
  keeper,
  recommended,
  unavailable = false,
  statusLabel,
  metadata,
  disabled,
  name,
  onKeep,
  actions,
  children
}: {
  member: ArtworkDedupMemberDto
  keeper: boolean
  recommended?: boolean
  unavailable?: boolean
  statusLabel?: string
  metadata?: string
  disabled?: boolean
  name?: string
  onKeep?: () => void
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const Title = unavailable ? 'div' : 'a'
  return (
    <div className="flex min-w-0 flex-col gap-2 py-2">
      <div className="flex min-h-11 min-w-0 items-center gap-3">
        {onKeep ? (
          <label className={cn('flex size-11 shrink-0 items-center justify-center', !disabled && 'cursor-pointer')}>
            <input
              type="radio"
              name={name}
              checked={keeper}
              disabled={disabled}
              onChange={onKeep}
              aria-label={`保留 ${member.title}`}
              className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            />
          </label>
        ) : null}
        <Title
          href={unavailable ? undefined : `/artworks/${member.artworkId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={unavailable ? undefined : `查看作品：${member.title}（新标签页）`}
          title={unavailable ? undefined : '在新标签页查看作品'}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
            !unavailable && 'group'
          )}
        >
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
            <span className="flex min-w-0 items-start gap-1.5">
              <PrivacySensitiveText className="line-clamp-2 min-w-0 break-words text-sm font-medium group-hover:underline group-hover:underline-offset-4">
                {member.title}
              </PrivacySensitiveText>
              {!unavailable ? (
                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {duplicateSourceLabel(member.sourceLabel)}
              {metadata ? ` · ${metadata}` : ''}
            </span>
            {member.otherAccountHasOrganization ? (
              <span className="text-xs text-muted-foreground">还有其他账户整理记录</span>
            ) : null}
          </span>
        </Title>
        {keeper || statusLabel ? (
          <Badge variant={keeper ? 'info' : 'secondary'} className="shrink-0">
            {statusLabel ?? (recommended ? '推荐保留' : '保留')}
          </Badge>
        ) : null}
        {actions}
      </div>
      {children ? <div className="pl-4 text-sm leading-6 sm:pl-14">{children}</div> : null}
    </div>
  )
}
