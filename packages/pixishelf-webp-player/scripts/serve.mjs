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
