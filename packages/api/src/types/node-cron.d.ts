declare module 'node-cron' {
  interface ScheduleOptions {
    scheduled?: boolean
    timezone?: string
  }
  interface ScheduledTask {
    start: () => void
    stop: () => void
    destroy: () => void
  }
  function schedule(cronExpression: string, func: () => void, options?: ScheduleOptions): ScheduledTask
  const _default: {
    schedule: typeof schedule
  }
  export default _default
}