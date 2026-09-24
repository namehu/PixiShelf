import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'tests/fixtures/manifest.json'), 'utf8'))
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp'
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    let relative = url.pathname === '/' ? 'demo/index.html' : url.pathname.slice(1)
    if (relative.startsWith('assets/')) relative = `dist/${relative}`
    const file = resolve(root, relative)
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end()
      return
    }
    const data = await readFile(file)
    const padMiB = Number(url.searchParams.get('padMiB'))
    if (relative === 'tests/fixtures/composite.webp' && [33, 65, 129, 257].includes(padMiB)) {
      const padding = padMiB * 1024 * 1024
      const total = data.length + 8 + padding
      const header = Buffer.from(data)
      header.writeUInt32LE(total - 8, 4)
      const chunk = Buffer.alloc(8)
      chunk.write('JUNK', 0)
      chunk.writeUInt32LE(padding, 4)
      res.writeHead(200, {
        'content-type': 'image/webp',
        'content-length': total,
        'cache-control': 'no-store'
      })
      res.write(header)
      res.write(chunk)
      const zeros = Buffer.alloc(64 * 1024)
      for (let written = 0; written < padding && !res.destroyed; written += zeros.length) {
        if (!res.write(zeros)) {
          await new Promise((done) => {
            const settled = () => {
              res.off('drain', settled)
              res.off('close', settled)
              done()
            }
            res.once('drain', settled)
            res.once('close', settled)
          })
        }
      }
      if (!res.destroyed) res.end()
      return
    }
    res.writeHead(200, {
      'content-type': mime[extname(file)] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-store'
    })
    if (url.searchParams.has('gate')) {
      res.write(data.subarray(0, manifest.gateOffset))
      const timer = setTimeout(() => {
        if (url.searchParams.has('disconnect')) res.destroy()
        else res.end(data.subarray(manifest.gateOffset))
      }, 2500)
      res.on('close', () => clearTimeout(timer))
    } else res.end(data)
  } catch {
    if (!res.headersSent) res.writeHead(404)
    res.end()
  }
}).listen(Number(process.env.WEBP_DEMO_PORT ?? 5439), '127.0.0.1', () =>
  process.stdout.write('WebP demo: http://127.0.0.1:5439\n')
)
