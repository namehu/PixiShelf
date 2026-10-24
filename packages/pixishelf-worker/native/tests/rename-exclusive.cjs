const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { renameExclusive, openDirectoryAt, mkdirAt, createFileAt, unlinkAt, rmdirAt } = require(process.argv[2])
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-native-'))
const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
try {
  fs.writeFileSync(path.join(directory, 'source'), 'source')
  fs.writeFileSync(path.join(directory, 'occupied'), 'keep')
  fs.symlinkSync('occupied', path.join(directory, 'link'))
  for (const target of ['occupied', 'link']) {
    assert.throws(() => renameExclusive(fd, 'source', fd, target), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(path.join(directory, 'source'), 'utf8'), 'source')
    assert.equal(fs.readFileSync(path.join(directory, target), 'utf8'), 'keep')
  }
  for (const invalid of ['../source', '/source', '.', '..', 'x\\y', 'x\0y']) {
    assert.throws(() => renameExclusive(fd, invalid, fd, 'new'), { code: 'ERR_INVALID_ARG' })
  }
  const original = fs.statSync(path.join(directory, 'source'), { bigint: true })
  renameExclusive(fd, 'source', fd, 'new')
  assert.equal(fs.existsSync(path.join(directory, 'source')), false)
  assert.equal(fs.statSync(path.join(directory, 'new'), { bigint: true }).ino, original.ino)
  mkdirAt(fd, 'anchored')
  const anchored = openDirectoryAt(fd, 'anchored')
  try {
    fs.renameSync(path.join(directory, 'anchored'), path.join(directory, 'old-anchored'))
    fs.mkdirSync(path.join(directory, 'outside'))
    fs.symlinkSync('outside', path.join(directory, 'anchored'))
    assert.throws(
      () => openDirectoryAt(fd, 'anchored'),
      (error) => ['ENOTDIR', 'ELOOP'].includes(error.code)
    )
    const file = createFileAt(anchored, 'probe')
    fs.writeFileSync(file, 'anchored')
    fs.fsyncSync(file)
    fs.closeSync(file)
    mkdirAt(anchored, 'child')
    assert.deepEqual(fs.readdirSync(path.join(directory, 'outside')), [])
    assert.equal(fs.readFileSync(path.join(directory, 'old-anchored/probe'), 'utf8'), 'anchored')
    unlinkAt(anchored, 'probe')
    rmdirAt(anchored, 'child')
    assert.deepEqual(fs.readdirSync(path.join(directory, 'old-anchored')), [])
  } finally {
    fs.closeSync(anchored)
  }
  fs.fsyncSync(fd)
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      exclusiveRename: true,
      symlinkPreserved: true,
      inodePreserved: true,
      invalidNamesRejected: true,
      directorySync: true,
      anchoredAtCalls: true
    })
  )
} finally {
  fs.closeSync(fd)
  fs.rmSync(directory, { recursive: true, force: true })
}
