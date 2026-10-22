import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const docs = fileURLToPath(new URL('../../../docs/', import.meta.url))
const check = process.argv.includes('--check')

async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collect(name)))
    else if (/\.(mmd|md)$/.test(entry.name)) files.push(name)
  }
  return files.sort()
}

const bundled = await build({
  stdin: { contents: 'import mermaid from "mermaid";window.mermaid=mermaid', resolveDir: root },
  bundle: true,
  format: 'iife',
  write: false
})
const browser = await chromium.launch({
  channel: process.env.WEBP_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
})
let rendered = 0
let embedded = 0
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: bundled.outputFiles[0].text })
  for (const file of await collect(docs)) {
    const relative = path.relative(docs, file).replaceAll('\\', '/')
    const source = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
    if (file.endsWith('.md')) {
      for (const match of source.matchAll(/^```mermaid\s*\n([\s\S]*?)^```\s*$/gm)) {
        try {
          await page.evaluate(async (text) => window.mermaid.parse(text), match[1])
          embedded++
        } catch (error) {
          throw new Error(`${relative}: invalid embedded Mermaid: ${error.message}`)
        }
      }
      continue
    }
    const name = `diagram-${createHash('sha256').update(relative).digest('hex').slice(0, 12)}`
    const stamp = `<!-- source-sha256: ${createHash('sha256').update(source).digest('hex')} -->`
    const output = file.replace(/\.mmd$/, '.svg')
    try {
      const svg = await page.evaluate(
        async ({ source, name, check }) => {
          window.mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            deterministicIds: true,
            deterministicIDSeed: name,
            fontFamily: 'Arial, Microsoft YaHei, sans-serif'
          })
          if (check) {
            await window.mermaid.parse(source)
            return null
          }
          return (await window.mermaid.render(name, source)).svg
        },
        { source, name, check }
      )
      const previous = await readFile(output, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
      if (check) {
        if (!previous.startsWith(stamp + '\n')) throw new Error('SVG is absent or stale; run pnpm docs:diagrams')
      } else {
        const next = `${stamp}\n${svg}\n`
        if (previous !== next) await writeFile(output, next)
      }
      rendered++
    } catch (error) {
      throw new Error(`${relative}: ${error.message}`)
    }
  }
  console.log(
    `${check ? 'Checked' : 'Rendered'} ${rendered} diagram sources; parsed ${embedded} embedded Mermaid blocks.`
  )
} finally {
  await browser.close()
}
