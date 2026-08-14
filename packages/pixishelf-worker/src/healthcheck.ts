import { request } from 'node:http'
import { z } from 'zod'

export interface HealthcheckOptions {
  mode: 'live' | 'ready'
  host: string
  port: number
  timeoutMs: number
}

const healthcheckEnvironmentSchema = z.object({
  WORKER_HEALTHCHECK_HOST: z.string().trim().min(1).default('127.0.0.1'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3011),
  WORKER_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000)
})

export function parseHealthcheckOptions(argv: string[], environment: NodeJS.ProcessEnv): HealthcheckOptions {
  const modeArgument = argv.find((argument) => argument.startsWith('--mode='))
  const mode = modeArgument?.slice('--mode='.length) ?? 'ready'
  if (mode !== 'live' && mode !== 'ready') throw new Error(`Unsupported healthcheck mode: ${mode}`)
  const parsed = healthcheckEnvironmentSchema.parse(environment)
  return {
    mode,
    host: parsed.WORKER_HEALTHCHECK_HOST,
    port: parsed.WORKER_HEALTH_PORT,
    timeoutMs: parsed.WORKER_HEALTHCHECK_TIMEOUT_MS
  }
}

export function checkWorkerHealth(options: HealthcheckOptions) {
  return new Promise<void>((resolve, reject) => {
    const healthRequest = request(
      {
        host: options.host,
        port: options.port,
        path: options.mode === 'live' ? '/livez' : '/readyz',
        method: 'GET',
        timeout: options.timeoutMs
      },
      (response) => {
        response.resume()
        response.once('end', () => {
          if (response.statusCode === 200) resolve()
          else reject(new Error(`Worker healthcheck returned HTTP ${response.statusCode ?? 'unknown'}`))
        })
      }
    )
    healthRequest.once('timeout', () => healthRequest.destroy(new Error('Worker healthcheck timed out')))
    healthRequest.once('error', reject)
    healthRequest.end()
  })
}

export async function runHealthcheck(argv = process.argv.slice(2), environment = process.env) {
  try {
    await checkWorkerHealth(parseHealthcheckOptions(argv, environment))
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (require.main === module) {
  void runHealthcheck().then((exitCode) => {
    process.exitCode = exitCode
  })
}
