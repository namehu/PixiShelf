import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = [
  /^node:/,
  /^(?:fs|path|http|https|os|crypto|child_process|worker_threads)(?:\/|$)/,
  /^@prisma\/client$/,
  /^@pixishelf\/db$/,
  /^@pixishelf\/next(?:\/|$)/,
  /^(?:next|react|better-auth|server-only)(?:\/|$)/,
  /^@\//,
  /(?:^|\/)\.\.\/\.\.\/pixishelf(?:\/|$)/
]

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionFiles(path)
    return extname(path) === '.ts' ? [path] : []
  })
}

function moduleSpecifiers(source: string) {
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))
}

describe('job-contracts architecture boundary', () => {
  it('contains only platform-neutral wire contracts', () => {
    const violations = productionFiles(sourceRoot).flatMap((path) =>
      moduleSpecifiers(readFileSync(path, 'utf8'))
        .filter(
          (specifier): specifier is string => Boolean(specifier) && forbidden.some((rule) => rule.test(specifier!))
        )
        .map((specifier) => `${path}: ${specifier}`)
    )
    expect(violations).toEqual([])
  })
})
