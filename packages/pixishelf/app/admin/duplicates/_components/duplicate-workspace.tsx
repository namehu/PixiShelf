'use client'

import type { ArtworkDedupOperationDto, ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { parseAsString, useQueryState } from 'nuqs'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DuplicateOperations } from './duplicate-operations'
import { DuplicateOperationSheet } from './duplicate-operation-sheet'
import { DuplicateReview } from './duplicate-review'

export function DuplicateWorkspace({
  userId,
  artistId,
  run,
  children
}: {
  userId: string
  artistId: number | null
  run: ArtworkDedupRunDto | null | undefined
  children: ReactNode
}) {
  const [operationId, setOperationId] = useQueryState('operationId', parseAsString)
  const [tab, setTab] = useState(operationId ? 'records' : 'results')
  function openOperation(id: string) {
    setTab('records')
    void setOperationId(id)
  }
  function newOperation(operation: ArtworkDedupOperationDto) {
    openOperation(operation.operationId)
  }
  if (!artistId) return children
  return (
    <>
      <Tabs value={tab} onValueChange={setTab} className="mt-3 gap-0">
        <TabsList className="h-auto p-1">
          <TabsTrigger value="results" className="min-h-11 px-5">
            检查结果
          </TabsTrigger>
          <TabsTrigger value="records" className="min-h-11 px-5">
            删除记录
          </TabsTrigger>
        </TabsList>
        <TabsContent value="results">
          {children}
          {run?.lastCompletedRun ? (
            <Button asChild variant="ghost" className="min-h-11">
              <Link
                href={`/admin/duplicates?artistId=${artistId}&runId=${encodeURIComponent(run.lastCompletedRun.runId)}&entry=direct`}
              >
                查看上次完成的结果（{run.lastCompletedRun.groupCount} 组）
              </Link>
            </Button>
          ) : null}
          {run?.status === 'COMPLETED' && run.counts.groups > 0 ? (
            <DuplicateReview
              key={`${userId}:${run.runId}`}
              userId={userId}
              runId={run.runId}
              onOperation={newOperation}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="records">
          <DuplicateOperations
            key={`${userId}:${artistId}`}
            userId={userId}
            artistId={artistId}
            onOpen={openOperation}
          />
        </TabsContent>
      </Tabs>
      {operationId && operationId.trim().length > 0 && operationId.length <= 128 ? (
        <DuplicateOperationSheet
          key={`${userId}:${operationId}`}
          userId={userId}
          operationId={operationId}
          onClose={() => {
            void setOperationId(null)
          }}
          onNewOperation={newOperation}
        />
      ) : null}
    </>
  )
}
