export const FULL_SCAN_RETIRED_REASON = 'FULL_SCAN_RETIRED' as const
export const FULL_SCAN_RETIRED_MESSAGE =
  'Directory-wide forced scans have been retired; use incremental discovery or an explicit metadata list instead'

// Keep list-force as the only supported bounded refresh path; full/legacy force is retired.
export function isRetiredDirectoryFullScan(input: { type: 'all' | 'full' | 'list'; force: boolean }) {
  return input.type !== 'list' && input.force
}

// Recognize historical payloads without admitting them back into the executable SCAN contract.
export function isRetiredFullReconcilePayload(type: string, payload: unknown): boolean {
  return (
    type === 'SCAN' &&
    typeof payload === 'object' &&
    payload !== null &&
    'mode' in payload &&
    payload.mode === 'FULL_RECONCILE'
  )
}
