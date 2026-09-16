import type { Prisma } from '@pixishelf/db'

export const diagnosticSummarySelect = {
  currentDiagnosticExecutionId: true,
  diagnosticReports: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, itemCount: true, outcome: true }
  }
} satisfies Prisma.SystemJobSelect

export function hasPartialFailure(record: {
  status: string
  currentDiagnosticExecutionId?: string | null
  diagnosticReports?: Array<{ id: string; itemCount: number; outcome: string | null }>
}) {
  const latest = record.diagnosticReports?.[0]
  return (
    record.status === 'COMPLETED' &&
    latest?.id === record.currentDiagnosticExecutionId &&
    latest?.outcome === 'COMPLETED' &&
    latest.itemCount > 0
  )
}
