import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('../../../docs/design/diagrams/webp-streaming-player/', import.meta.url)
await mkdir(new URL('../.cache/', import.meta.url), { recursive: true })
const bundled = await build({
  stdin: { contents: 'import mermaid from "mermaid";window.mermaid=mermaid', resolveDir: root },
  bundle: true,
  format: 'iife',
  write: false
})
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: bundled.outputFiles[0].text })
  for (const name of ['classes', 'sequence', 'states']) {
    const source = await readFile(new URL(`${name}.mmd`, output), 'utf8')
    const svg = await page.evaluate(
      async ({ source, name }) => {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          deterministicIds: true,
          deterministicIDSeed: 'webp'
        })
        return (await window.mermaid.render(name, source)).svg
      },
      { source, name }
    )
    await writeFile(new URL(`${name}.svg`, output), svg + '\n')
  }
} finally {
  await browser.close()
}
