import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { deleteMaintenanceFile } from '../maintenance-files.ts'

const require = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
type Input = Omit<Parameters<typeof deleteMaintenanceFile>[0], 'signal'>
type Result = { receipt?: { location: 'ABSENT'; directoriesSynced: true }; code?: string }

/** Compile the production native body with test-only syscall wrappers, never a production runtime switch. */
export async function directDeleteNativeFixture(directory: string, mode: 'sync-failure' | 'parent-barrier') {
  await fs.mkdir(directory)
  const source = new URL('../../../../pixishelf-worker/native/artwork-dedup-rename.c', import.meta.url).pathname
  const wrapper = path.join(directory, 'syscalls.c')
  await fs.writeFile(wrapper, `#define _GNU_SOURCE
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
static int sync_calls = 0;
static int fixture_fsync(int fd) {
  ++sync_calls;
  if (${mode === 'sync-failure' ? '1' : '0'} && sync_calls == 2) {
    (void)write(3, "F", 1); errno = EIO; return -1;
  }
  int result = fsync(fd), saved = errno;
  if (result == 0) (void)write(3, "S", 1);
  errno = saved; return result;
}
static int fixture_unlinkat(int fd, const char *name, int flags) {
  if (${mode === 'parent-barrier' ? '1' : '0'}) {
    char resume;
    if (write(3, "U", 1) != 1 || read(4, &resume, 1) != 1) { errno = EIO; return -1; }
  }
  return unlinkat(fd, name, flags);
}
#define fsync fixture_fsync
#define unlinkat fixture_unlinkat
#include ${JSON.stringify(source)}
`)
  const platform = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']
  const compiled = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DNAPI_VERSION=8',
    '-I', path.resolve(path.dirname(process.execPath), '../include/node'), ...platform,
    wrapper, '-o', path.join(directory, 'artwork-dedup-native.node')], { encoding: 'utf8' })
  if (compiled.error) throw compiled.error
  if (compiled.status !== 0) throw new Error(`DD07 native fixture compilation failed: ${compiled.stderr}`)
  const entrypoint = path.join(directory, 'reader.cjs')
  const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
  await build({
    stdin: { contents: `import { deleteMaintenanceFile } from ${JSON.stringify(new URL('../maintenance-files.ts', import.meta.url).pathname)};
process.on('message', async (input) => {
  try { process.send({ receipt: await deleteMaintenanceFile({ ...input, signal: new AbortController().signal }) }); }
  catch (error) { process.send({ code: error.code ?? error.message }); }
});`, resolveDir: directory },
    outfile: entrypoint, bundle: true, platform: 'node', target: 'node20', format: 'cjs', logLevel: 'silent'
  })
  const child: ChildProcess = fork(entrypoint, [], {
    execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe', 'ipc']
  })
  const events = child.stdio[3] as Readable
  const resume = child.stdio[4] as Writable
  let observed = '', stderr = ''
  events.setEncoding('utf8')
  events.on('data', (chunk: string) => { observed += chunk })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => { stderr += chunk })
  return {
    async deleteFile(input: Input): Promise<Result> {
      const result = once(child, 'message')
      child.send({ root: input.root, relativePath: input.relativePath, expectedState: input.expectedState, allowMissing: input.allowMissing })
      return (await result)[0] as Result
    },
    async waitForEvents(expected: string) {
      const deadline = Date.now() + 5000
      while (observed.length < expected.length) {
        if (child.exitCode !== null || Date.now() >= deadline) throw new Error(`DD07 native events ${observed}; ${stderr}`)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      if (observed !== expected) throw new Error(`DD07 native events: expected ${expected}, got ${observed}`)
    },
    resume() { resume.write('1') },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  }
}
