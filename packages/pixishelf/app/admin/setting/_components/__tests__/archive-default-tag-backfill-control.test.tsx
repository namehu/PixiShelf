import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArchiveDefaultTagBackfillControl } from '../archive-default-tag-backfill-control'

const testState = vi.hoisted(() => ({
  status: {
    capabilityAvailable: true,
    activeJob: null as null | Record<string, unknown>,
    latestJob: null as null | Record<string, unknown>
  },
  mutationCalls: [] as Array<{ kind: string; payload: unknown }>,
  invalidateQueries: vi.fn()
}))

vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    setting: {
      getArchiveDefaultTagBackfillStatus: {
        queryOptions: (_input: unknown, options: unknown) => ({
          queryKey: ['archive-backfill-status'],
          ...(options as object)
        }),
        queryKey: () => ['archive-backfill-status']
      },
      previewArchiveDefaultTagBackfill: {
        queryOptions: (_input: unknown, options: unknown) => ({
          queryKey: ['archive-backfill-preview'],
          ...(options as object)
        })
      },
      startArchiveDefaultTagBackfill: {
        mutationOptions: (options: object) => ({ kind: 'start', ...options })
      },
      cancelArchiveDefaultTagBackfill: {
        mutationOptions: (options: object) => ({ kind: 'cancel', ...options })
      }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: testState.invalidateQueries }),
  useQuery: (options: any) =>
    options.queryKey[0] === 'archive-backfill-status'
      ? { data: testState.status, isLoading: false }
      : {
          data: {
            targetArtworkCount: 3,
            validTagIds: [2, 9],
            unavailableTagIds: [7],
            existingRelations: 2,
            missingRelations: 4,
            snapshotDigest: 'a'.repeat(64)
          },
          isLoading: false,
          refetch: vi.fn()
        },
  useMutation: (options: any) => ({
    isPending: false,
    mutate: (payload: unknown) => {
      testState.mutationCalls.push({ kind: options.kind, payload })
      options.onSuccess?.({ reused: false })
    }
  })
}))

describe('ArchiveDefaultTagBackfillControl', () => {
  beforeEach(() => {
    testState.status = { capabilityAvailable: true, activeJob: null, latestJob: null }
    testState.mutationCalls.length = 0
    testState.invalidateQueries.mockClear()
  })

  afterEach(cleanup)

  it('shows the frozen preview and starts with only its digest', () => {
    render(<ArchiveDefaultTagBackfillControl hasDefaultTags settingSaving={false} />)

    fireEvent.click(screen.getByRole('button', { name: '补全历史归档标签' }))
    const facts = screen.getByLabelText('历史归档标签补全预览')
    expect(within(facts).getByText('3')).toBeTruthy()
    expect(within(facts).getByText('4')).toBeTruthy()
    expect(screen.getByText(/标签 ID 7 会跳过/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认补全' }))
    expect(testState.mutationCalls).toEqual([{ kind: 'start', payload: { snapshotDigest: 'a'.repeat(64) } }])
  })

  it('renders active checkpoint progress and sends a scoped cancel command', () => {
    testState.status = {
      capabilityAvailable: true,
      activeJob: {
        id: 'job-1',
        status: 'RETRY_WAIT',
        progress: 33,
        message: '已完成一批',
        checkpoint: { processedArtworks: 100, addedRelations: 120, existingRelations: 80 }
      },
      latestJob: null
    }

    render(<ArchiveDefaultTagBackfillControl hasDefaultTags settingSaving={false} />)
    expect(screen.getByText('批次间让出 Worker')).toBeTruthy()
    expect(screen.getByText('已检查 100')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消补全' }))
    expect(testState.mutationCalls).toEqual([{ kind: 'cancel', payload: { jobId: 'job-1' } }])
  })
})
