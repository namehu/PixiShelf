export interface DedupDatabaseMeasurement {
  dbLoadCalls: number
  dbValidationCalls: number
  dbWriteCalls: number
  dbLoadMs: number
  dbValidationMs: number
  dbWriteMs: number
  transactions: number
  transactionWallMs: number
}

export function emptyDedupDatabaseMeasurement(): DedupDatabaseMeasurement {
  return {
    dbLoadCalls: 0, dbValidationCalls: 0, dbWriteCalls: 0,
    dbLoadMs: 0, dbValidationMs: 0, dbWriteMs: 0, transactions: 0, transactionWallMs: 0
  }
}

const readMethods = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', '$queryRaw', '$queryRawUnsafe'])
const writeMethods = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe'])

/** Counts Prisma calls, never SQL statements; fenced reads include input validation and loading. */
export function measureDedupDatabase<T extends object>(
  database: T,
  measurement: DedupDatabaseMeasurement,
  readKind: 'load' | 'validation'
): T {
  const delegates = new WeakMap<object, object>()
  const wrap = (target: object, delegate: boolean): object => new Proxy(target, {
    get(value, key, receiver) {
      const member = Reflect.get(value, key, receiver)
      if (typeof member === 'function') {
        const method = String(key)
        const kind = writeMethods.has(method) ? 'Write' : readMethods.has(method) ? readKind === 'load' ? 'Load' : 'Validation' : null
        if (!kind) return member.bind(value)
        return async (...args: unknown[]) => {
          const started = performance.now()
          measurement[`db${kind}Calls`]++
          try {
            return await member.apply(value, args)
          } finally {
            measurement[`db${kind}Ms`] += performance.now() - started
          }
        }
      }
      if (!delegate && member !== null && typeof member === 'object' && !String(key).startsWith('$')) {
        let proxy = delegates.get(member)
        if (!proxy) { proxy = wrap(member, true); delegates.set(member, proxy) }
        return proxy
      }
      return member
    }
  })
  return wrap(database, false) as T
}

export function addDedupDatabaseMeasurement(target: DedupDatabaseMeasurement, delta: DedupDatabaseMeasurement) {
  for (const key of Object.keys(target) as (keyof DedupDatabaseMeasurement)[]) target[key] += delta[key]
}
