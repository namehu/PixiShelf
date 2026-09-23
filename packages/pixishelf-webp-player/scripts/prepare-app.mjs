import { readFile, mkdir, cp, writeFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('dist/manifest.json', root), 'utf8'))
const output = new URL(`../pixishelf/public/webp-player/${manifest.version}/`, root)
await mkdir(output, { recursive: true })
await cp(new URL('dist/assets/', root), output, { recursive: true })
await writeFile(new URL('../pixishelf/public/webp-player/manifest.json', root), JSON.stringify(manifest))
