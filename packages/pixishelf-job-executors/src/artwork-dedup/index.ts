export { createArtworkDedupExecutor, executeArtworkDedup, type ArtworkDedupDependencies } from './executor.ts'
export { ARTWORK_DEDUP_LIMITS } from './limits.ts'
export { ControlledDedupReader, DedupReaderSupervisor, DedupReaderError, type ReaderMetrics } from './reader.ts'

export {
  createArtworkDedupMaintenanceExecutor,
  executeArtworkDedupMaintenance,
  type ArtworkDedupMaintenanceDependencies
} from './maintenance-executor.ts'
