import type { Prisma } from '@pixishelf/db'
export interface DeletionExecutionControl {
  observe?: ((phase: 'FILES' | 'DATABASE' | 'PREPARATION', milliseconds: number) => void) | undefined
  checkExecution(): void
  transaction<T>(body: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
}
