import { describe, expect, it } from 'vitest'
import { parseArtworkDedupReaderRecoveryCommand as parse } from '../artwork-dedup-reader-recovery-cli.ts'
describe('offline detection reader recovery CLI', () => {
  it('requires explicit stopped-writers confirmation and exact inspection inputs', () => {
    expect(parse(['inspect', '--run', 'run'])).toEqual({ command: 'inspect', runId: 'run' })
    const input = [
      'recover',
      '--run',
      'run',
      '--expect',
      'a'.repeat(64),
      '--expected-reader-token',
      'token',
      '--operator',
      'operator'
    ]
    expect(() => parse(input)).toThrow(/confirmation/)
    expect(parse([...input, '--confirm-all-writers-stopped'])).toMatchObject({
      command: 'recover',
      confirmAllWritersStopped: true,
      expectedReaderToken: 'token'
    })
    expect(() => parse([...input, '--confirm-all-writers-stopped', '--run', 'other'])).toThrow(/duplicate/)
    expect(() => parse(['inspect', '--run', 'run', '--force'])).toThrow(/Unknown/)
  })
})

it('selects an operation explicitly and refuses ambiguous or missing target identities', () => {
  expect(parse(['inspect', '--operation', 'op'])).toEqual({ command: 'inspect', operationId: 'op' })
  expect(() => parse(['inspect', '--operation', 'op', '--run', 'run'])).toThrow(/exactly one/)
  expect(() => parse(['inspect'])).toThrow(/exactly one/)
  expect(
    parse([
      'recover',
      '--operation',
      'op',
      '--expect',
      'a'.repeat(64),
      '--expected-reader-token',
      'original',
      '--operator',
      'fixture',
      '--confirm-all-writers-stopped'
    ])
  ).toMatchObject({
    command: 'recover',
    operationId: 'op',
    expectedReaderToken: 'original',
    confirmAllWritersStopped: true
  })
  expect(() =>
    parse([
      'recover',
      '--operation',
      'op',
      '--expect',
      'a'.repeat(64),
      '--expected-reader-token',
      'original',
      '--operator',
      'fixture'
    ])
  ).toThrow(/confirmation/)
})
