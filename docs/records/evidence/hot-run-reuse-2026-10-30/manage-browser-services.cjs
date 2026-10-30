const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const file = path.join(base, 'browser-owned-processes.json')
const action = process.argv[2]
assert.ok(['start', 'stop', 'status'].includes(action))
const label = process.argv[3] ?? 'initial'
assert.match(label, /^[a-z0-9-]{1,60}$/)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
async function main() {
  if (action === 'start') {
    if (
      await fs.stat(file).then(
        () => true,
        () => false
      )
    ) {
      const previous = JSON.parse(await fs.readFile(file, 'utf8'))
      for (const row of previous) {
        assert.equal(alive(row.pid), false, 'Previous owned process still exists')
        try {
          process.kill(-row.processGroup, 0)
          throw Error('Previous owned process group still exists')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      await fs.writeFile(
        path.join(base, 'browser-owned-processes-before-' + label + '.json'),
        JSON.stringify(previous, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' }
      )
      await fs.unlink(file)
    }
    const rows = []
    for (const kind of ['app', 'worker']) {
      const script = path.join(base, 'start-' + kind + '.sh')
      const logPath = path.join(base, 'evidence/browser-' + kind + '-' + label + '.log')
      const log = await fs.open(logPath, 'wx', 0o600)
      const child = spawn('/bin/zsh', [script], { detached: true, stdio: ['ignore', log.fd, log.fd] })
      rows.push({
        kind,
        label,
        pid: child.pid,
        processGroup: child.pid,
        script,
        startedAt: new Date().toISOString(),
        log: logPath
      })
      child.unref()
      await log.close()
    }
    await fs.writeFile(file, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await sleep(1200)
    for (const row of rows) assert.ok(alive(row.pid), 'Owned ' + row.kind + ' exited during startup')
    console.log(JSON.stringify(rows))
  } else {
    const rows = JSON.parse(await fs.readFile(file, 'utf8'))
    if (action === 'stop') {
      for (const row of rows) {
        assert.equal(row.processGroup, row.pid)
        assert.equal(row.script, path.join(base, 'start-' + row.kind + '.sh'))
        try {
          process.kill(-row.processGroup, 'SIGTERM')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      await sleep(2000)
      for (const row of rows) {
        let groupAlive = false
        try {
          process.kill(-row.processGroup, 0)
          groupAlive = true
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
        if (groupAlive) {
          try {
            process.kill(-row.processGroup, 'SIGKILL')
          } catch (error) {
            if (error.code !== 'ESRCH') throw error
          }
        }
        row.stoppedAt = new Date().toISOString()
        row.alive = alive(row.pid)
        try {
          process.kill(-row.processGroup, 0)
          row.processGroupAlive = true
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
          row.processGroupAlive = false
        }
      }
      await fs.writeFile(
        path.join(base, 'evidence/browser-process-cleanup-' + (rows[0]?.label ?? 'initial') + '.json'),
        JSON.stringify(rows, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' }
      )
    }
    console.log(JSON.stringify(rows.map((row) => ({ ...row, alive: alive(row.pid) }))))
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
