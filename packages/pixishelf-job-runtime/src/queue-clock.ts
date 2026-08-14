export interface QueueClock {
  now(): Date
}

export const systemQueueClock: QueueClock = Object.freeze({
  now: () => new Date()
})

export class MutableQueueClock implements QueueClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current)
  }

  set(current: Date): void {
    this.current = new Date(current)
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds)
  }
}
