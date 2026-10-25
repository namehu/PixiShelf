import type { ArtworkDedupGroupDto } from '@pixishelf/job-contracts'
import { Button } from '@/components/ui/button'
import { DuplicateMemberRow } from './duplicate-member-row'
import { duplicateVisualCounts } from './duplicate-relation'

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
    <section className="border-b py-3 sm:px-2" aria-label="疑似版本作品对">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">疑似版本</h3>
          {group.visual ? (
            <p className="mt-1 text-xs text-muted-foreground">{duplicateVisualCounts(group.visual)}</p>
          ) : null}
        </div>
        <Button variant="ghost" className="min-h-11 shrink-0" disabled={disabled} onClick={onDetails}>
          查看差异
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
