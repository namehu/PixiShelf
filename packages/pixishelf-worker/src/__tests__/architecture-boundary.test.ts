import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = [
  /^@pixishelf\/next(?:\/|$)/,
  /^(?:next|react|better-auth|server-only)(?:\/|$)/,
  /^@\//,
  /(?:^|\/)\.\.\/\.\.\/pixishelf(?:\/|$)/
]

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(path)
    return extname(path) === '.ts' ? [path] : []
  })
}

function imports(source: string) {
  return [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ].flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))
}

describe('worker architecture boundary', () => {
  it('does not import Next.js or application source through any module syntax', () => {
    const violations = files(sourceRoot).flatMap((path) =>
      imports(readFileSync(path, 'utf8'))
        .filter(
          (specifier): specifier is string => Boolean(specifier) && forbidden.some((rule) => rule.test(specifier!))
        )
        .map((specifier) => `${path}: ${specifier}`)
    )
    expect(violations).toEqual([])
  })
})
