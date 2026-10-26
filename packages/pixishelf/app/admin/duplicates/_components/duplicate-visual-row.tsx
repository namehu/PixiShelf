import type { ArtworkDedupGroupDto } from '@pixishelf/job-contracts'
import { Button } from '@/components/ui/button'
import { DuplicateMemberRow } from './duplicate-member-row'
import { duplicatePairCounts, duplicatePairLabel } from './duplicate-relation'

export function DuplicateVisualRow({
  group,
  disabled,
  onDetails
}: {
  group: ArtworkDedupGroupDto
  disabled: boolean
  onDetails: () => void
}) {
  return (
    <section className="border-b py-3 sm:px-2" aria-label={`${duplicatePairLabel(group)}作品对`}>
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{duplicatePairLabel(group)}</h3>
          {group.visual ? <p className="mt-1 text-xs text-muted-foreground">{duplicatePairCounts(group)}</p> : null}
        </div>
        <Button variant="ghost" className="min-h-11 shrink-0" disabled={disabled} onClick={onDetails}>
          {group.relationKind === 'PARTIAL' ? '图片对照' : '查看差异'}
        </Button>
      </header>
      <div className="grid min-w-0 gap-x-4 sm:grid-cols-2">
        {group.previewMembers.map((member) => (
          <DuplicateMemberRow key={member.artworkId} member={member} keeper={false} />
        ))}
      </div>
    </section>
  )
}
