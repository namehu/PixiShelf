'use client'

import type { ArtworkDedupOperationDto, ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { parseAsString, useQueryState } from 'nuqs'
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { DuplicateBatchProgress, DuplicateBatchConfirmation, type DeleteBatch } from './duplicate-batch-delete'
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
  const [recordConfirmation, setRecordConfirmation] = useState<DeleteBatch | null>(null)
  const queryClient = useQueryClient()
  const trpc = useTRPC()
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
          <h2 className="mt-4 text-sm font-medium">最近删除</h2>
          <DuplicateBatchProgress userId={userId} artistId={artistId} onConfirm={setRecordConfirmation} />
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">历史记录（旧版）</summary>
            <DuplicateOperations
              key={`${userId}:${artistId}`}
              userId={userId}
              artistId={artistId}
              onOpen={openOperation}
            />
          </details>
        </TabsContent>
      </Tabs>
      {recordConfirmation ? (
        <DuplicateBatchConfirmation
          userId={userId}
          batch={recordConfirmation}
          onClose={() => setRecordConfirmation(null)}
          onSubmitted={() => {
            setRecordConfirmation(null)
            void queryClient.invalidateQueries({ queryKey: trpc.artwork.batchDeleteList.queryKey() })
          }}
        />
      ) : null}
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
