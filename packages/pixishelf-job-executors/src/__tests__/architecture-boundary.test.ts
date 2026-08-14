import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = new URL('..', import.meta.url)
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const forbidden = [
  /^@pixishelf\/(?:next|worker)(?:\/|$)/,
  /^(?:next|react|better-auth|server-only)(?:\/|$)/,
  /^@\//,
  /(?:^|\/)\.\.\/\.\.\/pixishelf(?:\/|$)/,
  /(?:^|\/)\.\.\/\.\.\/pixishelf-worker(?:\/|$)/
]

describe('job executor architecture boundary', () => {
  it('does not import the Next application or Worker implementation', async () => {
    const violations: string[] = []
    for (const file of await sourceFiles(sourceRoot)) {
      const source = await readFile(file, 'utf8')
      violations.push(
        ...imports(source)
          .filter(
            (specifier): specifier is string => Boolean(specifier) && forbidden.some((rule) => rule.test(specifier!))
          )
          .map((specifier) => `${relative(packageRoot, file)}: ${specifier}`)
      )
    }
    expect(violations).toEqual([])
  })
})

async function sourceFiles(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(fileURLToPath(directory), entry.name)
      if (entry.isDirectory())
        return entry.name === '__tests__' ? [] : sourceFiles(new URL(`${entry.name}/`, directory))
      return extname(entry.name) === '.ts' ? [path] : []
    })
  )
  return files.flat()
}

function imports(source: string): Array<string | undefined> {
  return [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ].flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))
}
