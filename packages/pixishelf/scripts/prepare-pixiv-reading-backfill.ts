import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { backfillStatements, decodeReadingSnapshots, snapshotQuery, sqlLiteral } from './pixiv-reading-backfill-sql'

const { values } = parseArgs({
  options: { connection: { type: 'string' }, 'user-id': { type: 'string' }, out: { type: 'string' } }
})
const connection = values.connection
const userId = values['user-id']
if (!connection || !userId || !values.out) throw new Error('Required: --connection NAME --user-id ID --out NEW_DIRECTORY')
const output = resolve(values.out)
mkdirSync(output, { mode: 0o700 })
function read<T>(sql: string): T[] {
  const result = JSON.parse(execFileSync('dbx', ['query', connection!, sql, '--limit', '100', '--timeout', '30s', '--json'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  }))
  if (result.error || !Array.isArray(result.rows)) throw new Error('DBX read failed')
  return result.rows
}
function save(name: string, data: string) {
  writeFileSync(resolve(output, name), data, { mode: 0o600, flag: 'wx' })
  return createHash('sha256').update(data).digest('hex')
}
const accounts = read<{ id: string; name: string | null }>(`SELECT id, name FROM "UserBA" WHERE id = ${sqlLiteral(userId)}`)
if (accounts.length !== 1) throw new Error('Account not found')
const bounds = read<{ maximum: number | null }>(`SELECT max(id) AS maximum FROM "Artwork" WHERE "createdVia" = 'PIXIV_SCAN'`)[0]
const maximum = bounds?.maximum ?? 0
const batches: Array<{ file: string; backup: string; sha256: string; count: number }> = []
let afterId = 0
let count = 0
let mediaCount = 0
while (afterId < maximum) {
  const rows = decodeReadingSnapshots(read(snapshotQuery(userId, afterId, maximum)))
  if (rows.length === 0) break
  const name = `batch-${String(batches.length + 1).padStart(4, '0')}`
  const backup = `${name}.before.json`
  const file = `${name}.sql`
  save(backup, JSON.stringify(rows, null, 2))
  const sha256 = save(file, backfillStatements(userId, rows).join(';\n\n') + ';\n')
  batches.push({ file, backup, sha256, count: rows.length })
  count += rows.length
  mediaCount += rows.reduce((sum, row) => sum + row.images.length, 0)
  afterId = rows.at(-1)!.id
  if (batches.length % 40 === 0) console.log(`Prepared ${count} artworks`)
}
const preference = read(`SELECT * FROM "UserSetting" WHERE "userId" = ${sqlLiteral(userId)} AND key = 'pixiv_import_mark_read'`)
save('preference.before.json', JSON.stringify(preference, null, 2))
save('enable-preference.sql', `INSERT INTO "UserSetting" ("userId", key, value, type, "createdAt", "updatedAt")
SELECT id, 'pixiv_import_mark_read', 'true', 'boolean', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "UserBA" WHERE id = ${sqlLiteral(userId)}
ON CONFLICT ("userId", key) DO UPDATE SET value = 'true', type = 'boolean', "updatedAt" = CURRENT_TIMESTAMP;\n`)
save('manifest.json', JSON.stringify({
  mode: 'PREPARED_ONLY', connection, account: accounts[0], maximum, preparedAt: new Date().toISOString(),
  artworks: count, media: mediaCount, batches,
  execution: 'Each SQL file must run with DBX execute_batch use_transaction=true. Save results and post-state. Changed snapshots are skipped; re-prepare skipped items after review.'
}, null, 2))
console.log(JSON.stringify({ output, artworks: count, media: mediaCount, batches: batches.length, writes: 0 }))
