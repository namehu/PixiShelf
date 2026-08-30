import { JOB_DEFINITION_VERSION, parseJobPayload, type JobType } from '@pixishelf/job-contracts'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

export function jobPayloadsHaveSameSemantics(
  type: JobType,
  definitionVersion: number,
  left: unknown,
  right: unknown
): boolean {
  try {
    const normalizedLeft = definitionVersion === JOB_DEFINITION_VERSION ? parseJobPayload(type, left) : left
    const normalizedRight = definitionVersion === JOB_DEFINITION_VERSION ? parseJobPayload(type, right) : right
    return canonicalJson(normalizedLeft) === canonicalJson(normalizedRight)
  } catch {
    return false
  }
}
