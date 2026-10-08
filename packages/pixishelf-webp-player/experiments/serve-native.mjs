import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { randomBytes, createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { parseFullFrames } from './full-frame-webp.mjs'

// Explicit source only, no directory serving. Default stays on loopback.
const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '5449' }
  }
})
if (!values.source)
  throw Error('Usage: node experiments/serve-native.mjs --source /absolute/image.webp [--host LAN-IP] [--port 5449]')
const size = (await stat(values.source)).size
if (size > 128 * 1024 * 1024) throw Error('Input exceeds experiment budget')
const sample = await readFile(values.source)
const parsed = parseFullFrames(sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength))
const root = new URL('../', import.meta.url),
  files = new Map()
for (const path of ['production.html', 'production.js']) files.set(path, await readFile(new URL('experiments/lan/' + path, root)))
files.set('index.js', await readFile(new URL('dist/index.js', root)))
for (const path of ['worker.mjs', 'independent-worker.mjs', 'decoder.mjs', 'decoder.wasm', 'decoder-simd.mjs', 'decoder-simd.wasm'])
  files.set('assets/' + path, await readFile(new URL('dist/assets/' + path, root)))
for (const key of ['sample.webp', 'download.webp']) files.set(key, sample)
const experimentHash = createHash('sha256')
for (const [name, bytes] of files)
  if (name.startsWith('assets/') || ['index.js', 'production.html', 'production.js'].includes(name)) experimentHash.update(name).update(bytes)
const experimentVersion = experimentHash.digest('hex').slice(0, 16)
const build = JSON.parse(await readFile(new URL('dist/manifest.json', root), 'utf8'))
files.set(
  'manifest.json',
  Buffer.from(
    JSON.stringify({
      ...build,
      experimentVersion,
      size,
      width: parsed.width,
      height: parsed.height,
      frames: parsed.frames.length,
      durationMs: parsed.frames.reduce((total, frame) => total + frame.durationMs, 0)
    })
  )
)
const prefix = '/' + randomBytes(12).toString('hex') + '/'
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const key = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || 'production.html' : ''
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405).end()
    return
  }
  const data = files.get(key)
  if (!data) {
    res.writeHead(404).end()
    return
  }
  const mime = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript',
    mjs: 'text/javascript',
    wasm: 'application/wasm',
    bin: 'application/octet-stream',
    webp: 'image/webp',
    json: 'application/json'
  }
  const headers = {
    'Content-Type': mime[key.split('.').pop()],
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }
  if (key === 'download.webp') headers['Content-Disposition'] = 'attachment; filename="webp-original.webp"'
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  let offset = 0,
    timer
  const send = () => {
    if (res.destroyed) return
    if (offset >= data.length) {
      res.end()
      return
    }
    const chunk = data.subarray(offset, offset + 32768)
    offset += chunk.length
    res.write(chunk, (error) => {
      if (!error && !res.destroyed) timer = setTimeout(send, 4)
    })
  }
  res.once('close', () => clearTimeout(timer))
  send()
}).listen(Number(values.port), values.host, () => console.log(`READY http://${values.host}:${values.port}${prefix}`))
