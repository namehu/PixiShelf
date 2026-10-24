import type { ArtworkDedupGroupDto } from '@pixishelf/job-contracts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { cn } from '@/lib/utils'
import { DuplicateMemberRow } from './duplicate-member-row'

export function DuplicateGroupRow({
  group,
  keeperId,
  selected,
  selectable,
  saving,
  failed,
  disabled,
  onSelect,
  onKeep,
  onDetails,
  onRetry
}: {
  group: ArtworkDedupGroupDto
  keeperId: number | null
  selected: boolean
  selectable: boolean
  saving: boolean
  failed: boolean
  disabled: boolean
  onSelect: (selected: boolean) => void
  onKeep: (artworkId: number) => void
  onDetails: () => void
  onRetry: () => void
}) {
  const title = group.previewMembers[0]?.title ?? '内容相同的作品'
  return (
    <section className={cn('border-b border-border px-2 py-5 sm:px-4', selected && 'bg-accent/50')} aria-label={title}>
      <header className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-h-11 min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Checkbox
              checked={selected}
              disabled={disabled || (!selected && (!selectable || saving || failed))}
              onCheckedChange={(value) => onSelect(value === true)}
              aria-label={`选择 ${title} 的副本`}
            />
          </span>
          <span className="min-w-0">
            <PrivacySensitiveText className="line-clamp-2 break-words text-sm font-semibold">
              {title}
            </PrivacySensitiveText>
            <span className="text-xs text-muted-foreground">
              {group.memberCount} 部 · {BigInt(group.fileCount).toLocaleString('zh-CN')} 个文件
            </span>
          </span>
        </label>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 self-end sm:self-auto"
          onClick={onDetails}
          data-group-details={group.groupId}
        >
          查看差异
        </Button>
      </header>
      {group.needsExplicitChoice && !group.savedReview ? (
        <p className="px-3 py-2 text-sm text-warning">有多份整理记录，请先选择保留作品。</p>
      ) : null}
      {group.reasons[0] ? <p className="px-3 py-2 text-sm text-warning">{group.reasons[0]}</p> : null}
      <fieldset className="min-w-0" disabled={disabled || saving} aria-label={`${title}保留作品`}>
        {group.previewMembers.slice(0, 3).map((member) => (
          <DuplicateMemberRow
            key={member.artworkId}
            member={member}
            name={`group-${group.groupId}`}
            keeper={keeperId === member.artworkId}
            recommended={!group.savedReview && group.recommendedKeeperArtworkId === member.artworkId}
            disabled={disabled || saving}
            onKeep={() => onKeep(member.artworkId)}
          />
        ))}
      </fieldset>
      {group.keeper &&
      group.keeper.artworkId === keeperId &&
      !group.previewMembers.some((member) => member.artworkId === keeperId) ? (
        <div className="px-3">
          <p className="text-xs text-muted-foreground">已保存的保留作品（当前摘要之外）</p>
          <DuplicateMemberRow member={group.keeper} keeper />
        </div>
      ) : null}
      <div
        className="flex min-h-8 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {saving ? (
          <span>正在保存保留选择…</span>
        ) : failed ? (
          <>
            <span className="text-destructive">未保存，暂不能预览本组</span>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onRetry}>
              重试保存
            </Button>
          </>
        ) : null}
        {group.memberCount > 3 ? (
          <Button type="button" variant="link" className="min-h-11" onClick={onDetails}>
            查看全部 {group.memberCount} 部
          </Button>
        ) : null}
      </div>
    </section>
  )
}
