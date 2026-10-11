// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// A production Next server, using real boundary source files. Only authentication
// and business I/O are substituted. Never inherit application environment secrets.
const appRoot = process.cwd()
const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')
const secrets = ['synthetic-db-password', 'synthetic-cookie-one', 'synthetic-cookie-two', 'synthetic-auth-token']
const failure = `postgresql://fixture:${secrets[0]}@localhost/fixture\nCookie: a=${secrets[1]}; b=${secrets[2]}\nAuthorization: Bearer ${secrets[3]}`

function stop(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

describe('production Next authorization and error transport', () => {
  it('fails closed at proxy and Route recheck and redacts authorized failures in responses and real logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pixishelf-security-next-'))
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: directory,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1'
    }
    let build: ChildProcess | undefined
    let server: ChildProcess | undefined
    let output = ''
    const put = async (path: string, source: string) => {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(join(directory, path), source)
    }
    try {
      await symlink(join(appRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
      for (const path of [
        'proxy.ts',
        'lib/logger.ts',
        'lib/api-handler.ts',
        'lib/constants.ts',
        'lib/rate-limit.ts',
        'types/http-response.ts',
        'services/background-task/request-auth.ts',
        'app/api/artwork/media-chapters/[image-id]/route.ts',
        'server/trpc.ts',
        'server/context.ts',
        'app/api/trpc/[trpc]/route.ts'
      ]) {
        await mkdir(dirname(join(directory, path)), { recursive: true })
        await copyFile(join(appRoot, path), join(directory, path))
      }
      await put('package.json', JSON.stringify({ private: true }))
      await put(
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            lib: ['dom', 'esnext'],
            allowJs: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            paths: { '@/*': ['./*'] },
            skipLibCheck: true
          }
        })
      )
      await put('next.config.mjs', 'export default { experimental: { cpus: 1 } }')
      await put(
        'app/layout.tsx',
        'export default function Layout({children}) { return <html><body>{children}</body></html> }'
      )
      await put('app/page.tsx', 'export default function Page() { return <main>Security fixture</main> }')
      await put(
        'lib/auth.js',
        `export const auth = { api: { getSession: async ({ headers }) => {
        const mode = headers.get('cookie') || '';
        if (mode.includes('provider-failure') || (mode.includes('route-failure') && headers.get('x-pathname'))) throw new Error(${JSON.stringify(failure)});
        if (!mode.includes('fixture-valid') && !mode.includes('route-failure')) return null;
        return { session: { id: 'fixture-session' }, user: { id: 'fixture-owner', name: 'Fixture', email: 'fixture@example.invalid', image: null } };
      } } }`
      )
      await put(
        'services/artwork-service/image-manager.js',
        `export async function clearChaptersForImage(_input) { console.log('FIXTURE_BUSINESS_CALLED'); throw new Error(${JSON.stringify(failure)}); }`
      )
      await put(
        'server/index.ts',
        `import { router, authProcedure } from './trpc'; export const appRouter = router({ fail: authProcedure.query(() => { console.log('FIXTURE_TRPC_CALLED'); throw new Error(${JSON.stringify(failure)}); }) });`
      )
      build = spawn(process.execPath, [nextBin, 'build', '--webpack'], { cwd: directory, env: environment })
      build.stdout!.on('data', (chunk) => {
        output += chunk.toString()
      })
      build.stderr!.on('data', (chunk) => {
        output += chunk.toString()
      })
      const status = await new Promise((resolve, reject) => {
        build!.once('error', reject)
        build!.once('exit', resolve)
      })
      expect(status, output).toBe(0)
      // Port zero asks the OS to allocate an isolated port; Next reports it at startup.
      server = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', '0'], {
        cwd: directory,
        env: environment
      })
      server.stdout!.on('data', (chunk) => {
        output += chunk.toString()
      })
      server.stderr!.on('data', (chunk) => {
        output += chunk.toString()
      })
      let base = ''
      for (let i = 0; i < 200; i++) {
        base = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0] ?? ''
        if (base && output.includes('Ready in')) break
        if (server.exitCode !== null) throw new Error(output)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(base).not.toBe('')
      const request = (cookie: string, path = '/api/artwork/media-chapters/1', method = 'DELETE') =>
        fetch(`${base}${path}?entry=direct`, {
          method,
          headers: { cookie, 'x-user-session': '{"userId":"forged"}' }
        })
      for (const cookie of [
        '',
        'better-auth.session_token=forged',
        'better-auth.session_token=expired',
        'provider-failure'
      ]) {
        expect((await request(cookie)).status).toBe(401)
      }
      const recheck = await request('route-failure')
      expect(recheck.status).toBe(500)
      expect(await recheck.json()).toEqual({ error: 'Internal Server Error' })
      expect(output).not.toContain('FIXTURE_BUSINESS_CALLED')
      const authorized = await request('fixture-valid')
      expect(authorized.status).toBe(500)
      expect(await authorized.json()).toEqual({ error: 'Internal Server Error' })
      const trpc = await request('fixture-valid', '/api/trpc/fail', 'GET')
      expect(trpc.status).toBe(500)
      const trpcBody = await trpc.text()
      expect(trpcBody).toContain('Internal Server Error')
      await stop(server)
      expect(output).toContain('FIXTURE_BUSINESS_CALLED')
      expect(output).toContain('FIXTURE_TRPC_CALLED')
      expect(output).toContain('[REDACTED]')
      for (const secret of secrets) {
        expect(trpcBody).not.toContain(secret)
        expect(output).not.toContain(secret)
      }
    } finally {
      if (server) await stop(server)
      if (build) await stop(build)
      await rm(directory, { recursive: true, force: true })
    }
  }, 180_000)
})
