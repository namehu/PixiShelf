import { ExecutorRegistry } from './executor-registry.js'

export function createWorkerExecutorRegistry() {
  return new ExecutorRegistry()
}
