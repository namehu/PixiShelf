export const CENTRAL_DISPATCHER_CUTOVER_ENV = 'CENTRAL_DISPATCHER_CUTOVER_ENABLED'

interface CentralDispatcherEnvironment {
  CENTRAL_DISPATCHER_CUTOVER_ENABLED?: string
}

export class LegacyBackgroundExecutionDisabledError extends Error {
  constructor(readonly operation: string) {
    super(`Legacy background execution is disabled after central dispatcher cutover: ${operation}`)
    this.name = 'LegacyBackgroundExecutionDisabledError'
  }
}

export function isCentralDispatcherCutoverEnabled(
  environment: CentralDispatcherEnvironment = {
    CENTRAL_DISPATCHER_CUTOVER_ENABLED: process.env.CENTRAL_DISPATCHER_CUTOVER_ENABLED
  }
) {
  return environment.CENTRAL_DISPATCHER_CUTOVER_ENABLED?.trim().toLowerCase() === 'true'
}

/**
 * A true cutover flag is a hard execution boundary: detached legacy work must be rejected so the
 * central worker and the Next.js process can never consume the same logical job simultaneously.
 */
export function assertLegacyBackgroundExecutionAllowed(
  operation: string,
  environment: CentralDispatcherEnvironment = {
    CENTRAL_DISPATCHER_CUTOVER_ENABLED: process.env.CENTRAL_DISPATCHER_CUTOVER_ENABLED
  }
) {
  if (isCentralDispatcherCutoverEnabled(environment)) {
    throw new LegacyBackgroundExecutionDisabledError(operation)
  }
}
