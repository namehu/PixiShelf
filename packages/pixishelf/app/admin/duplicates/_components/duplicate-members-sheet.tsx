'use client'

import type { ArtworkDedupGroupDto } from '@pixishelf/job-contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useTRPC } from '@/lib/trpc'
import { DuplicateMemberRow } from './duplicate-member-row'
import { DuplicateOrganization } from './duplicate-organization'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'

export function DuplicateMembersSheet({
  userId,
  runId,
  groupId,
  reviewRevision = 0,
  keeperId,
  saving,
  failed,
  onClose,
  onKeep,
  onRetry
}: {
  userId: string
  runId: string
  groupId: string
  reviewRevision?: number
  keeperId: number | null
  saving: boolean
  failed: boolean
  onClose: () => void
  onKeep: (group: ArtworkDedupGroupDto, artworkId: number) => void
  onRetry: () => void
}) {
  const trpc = useTRPC()
  const returnFocus = useRef(typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [cursorRevision, setCursorRevision] = useState(reviewRevision)
  const revisionChanged = cursorRevision !== reviewRevision
  useEffect(() => {
    if (!revisionChanged) return
    setCursors([undefined])
    setCursorRevision(reviewRevision)
  }, [revisionChanged, reviewRevision])
  const query = useQuery({
    ...trpc.artworkDedup.listGroups.queryOptions({
      runId,
      groupId,
      expectedUserId: userId,
      limit: 20,
      memberCursor: revisionChanged ? undefined : cursors.at(-1)
    }),
    retry: false,
    gcTime: 0
  })
  const page = query.data?.kind === 'MEMBERS' ? query.data : null
  const canSave = Boolean(page?.allowedActions.includes('SAVE_REVIEW')) && !query.isError && !saving
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        className="w-full sm:max-w-[480px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <SheetHeader className="pr-14">
          <SheetTitle>作品差异</SheetTitle>
          <SheetDescription>选择保留作品，整理记录不会自动合并。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {query.isError ? (
            <DuplicateQueryError
              onRetry={() => {
                if (cursors.length > 1) setCursors([undefined])
                else void query.refetch()
              }}
              busy={query.isFetching}
            />
          ) : null}
          {query.isPending ? (
            <DuplicateLoading label="正在加载组成员" />
          ) : page ? (
            <>
              {page.group.reasons.length > 0 ? (
                <p className="py-3 text-sm text-warning">{page.group.reasons.join('；')}</p>
              ) : null}
              {page.keeper && !page.items.some((item) => item.artworkId === page.keeper!.artworkId) ? (
                <section className="border-b pb-4">
                  <h3 className="text-sm font-medium">已保存的保留作品</h3>
                  <DuplicateMemberRow member={page.keeper} keeper>
                    <DuplicateOrganization member={page.keeper} />
                  </DuplicateMemberRow>
                </section>
              ) : null}
              <fieldset disabled={!canSave} aria-label="选择本组保留作品" className="divide-y divide-border">
                {page.items.map((member) => (
                  <DuplicateMemberRow
                    key={member.artworkId}
                    member={member}
                    name={`detail-${groupId}`}
                    keeper={(keeperId ?? page.keeper?.artworkId) === member.artworkId}
                    disabled={!canSave}
                    onKeep={() => onKeep(page.group, member.artworkId)}
                  >
                    <DuplicateOrganization member={member} />
                  </DuplicateMemberRow>
                ))}
              </fieldset>
              <div aria-live="polite" className="text-sm text-muted-foreground">
                {saving ? (
                  '正在保存…'
                ) : failed ? (
                  <>
                    <span className="text-destructive">未保存</span>
                    <Button className="min-h-11" variant="ghost" onClick={onRetry}>
                      重试保存
                    </Button>
                  </>
                ) : null}
              </div>
              <DuplicatePagination
                page={cursors.length - 1}
                hasNext={Boolean(page.nextMemberCursor)}
                busy={query.isFetching || saving}
                onPrevious={() => setCursors((value) => value.slice(0, -1))}
                onNext={() => {
                  if (page.nextMemberCursor) setCursors((value) => [...value, page.nextMemberCursor!])
                }}
                label="成员分页"
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
