export const FULL_SCAN_RETIRED_MESSAGE =
  'Directory-wide forced scans have been retired; use incremental discovery or an explicit metadata list instead'

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
