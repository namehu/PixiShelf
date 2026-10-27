import { createHash } from 'node:crypto'

/** Test-only event aggregation. Never records bind parameters or connection data. */
export class VisualSqlProfile {
  private statements = new Map<string, { phase: string; operation: string; tables: string[]; sql: string; count: number; durationMs: number }>()
  private transaction: { phase?: string; events: Array<{ query: string; duration: number }>; started: number; queryRows: number; candidateRows: number } | undefined
  private bounds = { queryRows: 0, candidateRows: 0, queryAndCandidateRows: 0, guardArtworks: 0 }
  private lastPhase = 'PREPARE/INDEX'
  private transactions = new Map<string, { count: number; totalWallMs: number; maxWallMs: number }>()
  begin() { this.transaction = { events: [], started: performance.now(), queryRows: 0, candidateRows: 0 } }
  features(kind: 'queryRows' | 'candidateRows', count: number) { if (this.transaction) this.transaction[kind] += count }
  guardArtworks(count: number) { this.bounds.guardArtworks = Math.max(this.bounds.guardArtworks, count) }
  readRun(checkpoint: unknown) {
    if (this.transaction && !this.transaction.phase) {
      this.transaction.phase = checkpoint && typeof checkpoint === 'object' && 'phase' in checkpoint ? String(checkpoint.phase) : 'PREPARE/INDEX'
    }
  }
  event(query: string, duration: number) { this.transaction?.events.push({ query, duration }) }
  end() {
    const transaction = this.transaction
    this.transaction = undefined
    if (!transaction) return
    this.bounds.queryRows = Math.max(this.bounds.queryRows, transaction.queryRows)
    this.bounds.candidateRows = Math.max(this.bounds.candidateRows, transaction.candidateRows)
    this.bounds.queryAndCandidateRows = Math.max(this.bounds.queryAndCandidateRows, transaction.queryRows + transaction.candidateRows)
    const phase = transaction.phase ?? this.lastPhase
    this.lastPhase = phase
    const wall = performance.now() - transaction.started
    const timing = this.transactions.get(phase) ?? { count: 0, totalWallMs: 0, maxWallMs: 0 }
    timing.count++; timing.totalWallMs += wall; timing.maxWallMs = Math.max(timing.maxWallMs, wall)
    this.transactions.set(phase, timing)
    for (const event of transaction.events) {
      const sql = event.query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').replace(/\?(?:\s*,\s*\?)+/g, '?…').trim()
      const key = `${phase}:${createHash('sha256').update(sql).digest('hex')}`
      const entry = this.statements.get(key) ?? { phase, operation: sql.match(/^\w+/)?.[0] ?? 'OTHER',
        tables: [...new Set([...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:"public"\.)?"([^"]+)"/g)].map(match => match[1]!))], sql: sql.slice(0, 1200), count: 0, durationMs: 0 }
      entry.count++; entry.durationMs += event.duration
      this.statements.set(key, entry)
    }
  }
  result() {
    return { bounds: this.bounds, transactions: Object.fromEntries(this.transactions), statements: [...this.statements.values()].sort((a, b) => b.count - a.count),
      durationMeaning: 'Prisma query event milliseconds, including driver/database wait; integer resolution. Transaction wall time includes client round trips. Phase uses the first run read per transaction, or the prior phase for run-less reads. PREPARE and the first INDEX transaction share PREPARE/INDEX.' }
  }
}
