import {
  Prisma, assertArtworkDedupCacheDirectories, assertArtworkDedupVisualDirectories, lockCreatorCatalog,
  type ArtworkDedupExecution, type MediaContentDirectorySnapshot
} from '@pixishelf/db'

const MAX_ARTWORKS = 128
const MAX_DIRECTORIES = 2000
const MAX_BYTES = 1024 * 1024
type Entry = { identity: string; directories: MediaContentDirectorySnapshot[]; bytes: number }
type DirectoryRow = MediaContentDirectorySnapshot & { artworkId: number }
const serialize = (value: unknown) => JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v)

/** One scan invocation only. VISUAL does not rewrite frozen media membership or
 * directory bindings; retry/restart gets a new instance. These are scope data,
 * never a cached validation: every commit locks and checks current directories
 * and subsequently checks current item/source snapshots under the same fence. */
export class QueryDirectoryScope {
  private readonly entries = new Map<number, Entry>()
  private readonly execution: ArtworkDedupExecution
  private readonly executionIdentity: string
  private directoryCount = 0
  private bytes = 0

  constructor(execution: ArtworkDedupExecution) {
    this.execution = { ...execution }
    this.executionIdentity = serialize(this.execution)
  }

  /** Caller holds the current run/execution fence and follows this with the
   * existing Artwork guard before committing any evidence or checkpoint. */
  async assert(tx: Prisma.TransactionClient, artworkIds: readonly number[]) {
    if (!artworkIds.length || artworkIds.length > 51 || artworkIds.some(id => !Number.isSafeInteger(id) || id <= 0))
      throw new RangeError('Visual directory scope batch')
    const ids = [...new Set(artworkIds)].sort((a, b) => a - b)
    await lockCreatorCatalog(tx)
    // Full item identity includes nullable/zero snapshot versions, members,
    // status and updatedAt. Never coerce a legitimate version zero to null.
    const items = await tx.artworkDedupItem.findMany({ where: { runId: this.execution.runId, artworkId: { in: ids } } })
    if (items.length !== ids.length || items.some(item => item.status !== 'COMPLETE'))
      return assertArtworkDedupCacheDirectories(tx, this.execution.runId, ids)
    const identities = new Map(items.map(item => [item.artworkId, `${this.executionIdentity}:${serialize(item)}`]))
    const selected = new Map<number, Entry>()
    const missing: number[] = []
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && entry.identity === identities.get(id)) selected.set(id, entry)
      else { this.remove(id); missing.push(id) }
    }
    if (missing.length) {
      // Items were read under the run lock. The immutable VISUAL input needs
      // neither a repeated Item join nor separate root and empty-tail scans.
      const rows = await tx.$queryRaw<DirectoryRow[]>(Prisma.sql`
        SELECT DISTINCT m."artworkId",m."logicalRoot",m."rootIdentity",m."relativeDirectory",
          m."directoryId",m."directoryGeneration" generation
        FROM "ArtworkDedupMedia" m WHERE m."runId"=${this.execution.runId}
          AND m."artworkId" IN (${Prisma.join(missing)}) LIMIT ${MAX_DIRECTORIES + 1}`)
      if (rows.length > MAX_DIRECTORIES) return assertArtworkDedupCacheDirectories(tx, this.execution.runId, ids)
      const directories = new Map(missing.map(id => [id, [] as MediaContentDirectorySnapshot[]]))
      for (const { artworkId, ...directory } of rows) directories.get(artworkId)!.push(directory)
      for (const id of missing) {
        const identity = identities.get(id)!, snapshots = directories.get(id)!
        selected.set(id, { identity, directories: snapshots, bytes: Buffer.byteLength(serialize([identity, snapshots]), 'utf8') })
      }
    }
    const count = [...selected.values()].reduce((sum, entry) => sum + entry.directories.length, 0)
    const bytes = [...selected.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    if (count > MAX_DIRECTORIES || bytes > MAX_BYTES) return assertArtworkDedupCacheDirectories(tx, this.execution.runId, ids)
    for (const [id, entry] of selected) {
      this.remove(id)
      while (this.entries.size >= MAX_ARTWORKS || this.directoryCount + entry.directories.length > MAX_DIRECTORIES || this.bytes + entry.bytes > MAX_BYTES)
        this.remove(this.entries.keys().next().value!)
      this.entries.set(id, entry)
      this.directoryCount += entry.directories.length
      this.bytes += entry.bytes
    }
    const unique = new Map<string, MediaContentDirectorySnapshot>()
    for (const entry of selected.values()) for (const directory of entry.directories) unique.set(serialize(directory), directory)
    // The shared guard locks *both* roots before paging any directories, then
    // checks directory identity/generation and overlapping writer declarations.
    return assertArtworkDedupVisualDirectories(tx, [...unique.values()])
  }

  private remove(id: number) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.directoryCount -= entry.directories.length
    this.bytes -= entry.bytes
    this.entries.delete(id)
  }
}
