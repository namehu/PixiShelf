import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

const maintenance = path.resolve(import.meta.dirname, '../../maintenance/retire-legacy-fields.mjs')

it.each(['0', '-1', '999', '7200001', 'Infinity', 'NaN', '1000.5', '1e6', ''])('rejects invalid transaction timeout %j before connecting to a database', (value) => {
  const result = spawnSync(process.execPath, [maintenance, 'prepare', '--transaction-timeout-ms', value], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/invalid' }
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('--transaction-timeout-ms')
  expect(result.stderr).not.toContain('Can\'t reach database')
})
