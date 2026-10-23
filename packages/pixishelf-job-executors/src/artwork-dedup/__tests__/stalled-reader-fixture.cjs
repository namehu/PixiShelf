process.on('message', () => {
  // Fault injection: model an OS operation that never services JS cancellation.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
})
process.send({ type: 'ready', owner: { version: 1, machineId: '1'.repeat(64), bootId: '2'.repeat(64), pidNamespace: 'fixture', parentPid: process.ppid, childPid: process.pid } })
