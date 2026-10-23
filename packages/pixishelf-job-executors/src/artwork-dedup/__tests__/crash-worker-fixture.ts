import { DedupReaderSupervisor } from '../reader.ts'
const reader = new DedupReaderSupervisor({
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: process.execArgv
}).create()
const owner = await reader.start()
process.send?.({ type: 'reader-started', owner })
setInterval(() => undefined, 1000)
