'use client'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useArtworkSummary } from './artwork-summary-context'

export function ArtworkSummaryControls({ compact = false }: { compact?: boolean }) {
  const summary = useArtworkSummary()
  if (!summary?.ready || !summary.groups.some((group) => group.mediaIds.length > 1)) return null
  return <ToggleGroup type="single" disabled={summary.navigating} value={summary.mode} onValueChange={(value) => {
    if (value === 'complete' || value === 'stack') summary.changeMode(value)
  }} aria-label="浏览方式" className="bg-muted/70 p-0.5">
    <ToggleGroupItem value="complete" className="min-h-11 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">完整</ToggleGroupItem>
    <ToggleGroupItem value="stack" className="min-h-11 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
      堆叠{!compact && <span className="ml-1 tabular-nums text-muted-foreground">{summary.groups.length}</span>}
    </ToggleGroupItem>
  </ToggleGroup>
}
