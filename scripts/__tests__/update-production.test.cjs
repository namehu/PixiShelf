const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

// Execute only the embedded list processors, never rsync, cleanup or Webhook calls.
const script = fs.readFileSync(path.join(__dirname, '../update-production.sh'), 'utf8').replace(/\r\n/g, '\n')
const extract = script.match(/\| node -e '\n([\s\S]*?)\n' "\$SOURCE_DIR"/)[1]
const count = script.match(/if ! META_COUNTS=\$\(node - "\$META_FILE" <<'NODE'\n([\s\S]*?)\nNODE/)[1]
const payload = script.match(/node - "\$META_FILE" > "\$WEBHOOK_PAYLOAD_FILE" <<'NODE'\n([\s\S]*?)\nNODE/)[1]

function run(code, args, input) {
  return spawnSync(process.execPath, ['-e', code, ...args], { input, encoding: 'utf8' })
}

function withList(content, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixishelf-meta-test-'))
  const file = path.join(directory, 'meta.txt')
  try {
    fs.writeFileSync(file, content)
    callback(file)
  } finally {
    fs.unlinkSync(file)
    fs.rmdirSync(directory)
  }
}

const relativePaths = [
  '9028016/150647665/150647665-meta.json',
  '9028016/150647665/150647665-meta.txt',
  '114508563/150717936/150717936_p0-meta.json'
]

for (const separator of ['/', '//', '///']) {
  test(`find output with ${separator.length} separator(s) produces relative Webhook paths`, () => {
    const source = '/Users/admin/Downloads/pixiv [backup]+.v1'
    const input = relativePaths.map(entry => source + separator + entry).join('\n') + '\n'
    for (const trailing of ['', '/', '///']) {
      const result = run(extract, [source + trailing], input)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, relativePaths.join('\n') + '\n')
      withList(result.stdout, file => {
        const counts = run(count, ['-', file])
        assert.equal(counts.status, 0, counts.stderr)
        assert.equal(counts.stdout, '3\t2')
        const body = run(payload, ['-', file])
        assert.equal(body.status, 0, body.stderr)
        assert.deepEqual(JSON.parse(body.stdout), { type: 'list', metadataList: relativePaths })
      })
    }
  })
}

test('rejects a sibling directory instead of stripping its leading slash', () => {
  const result = run(extract, ['/downloads/pixiv'], '/downloads/pixiv-other/100-meta.json\n')
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
})

for (const entry of ['/9028016/100-meta.json', '\\9028016\\100-meta.json', 'C:/100-meta.json', '../100-meta.json', 'artist/../100-meta.json']) {
  test(`rejects invalid list path before sync and cleanup: ${entry}`, () => {
    withList(entry + '\n', file => {
      const result = run(count, ['-', file])
      assert.equal(result.status, 1)
      assert.match(result.stderr, /相对路径/)
    })
    assert.ok(script.indexOf('if ! META_COUNTS=') < script.indexOf('rsync -avh'))
    assert.ok(script.indexOf('if ! META_COUNTS=') < script.indexOf('rm -rf -- "$SOURCE_DIR"'))
  })
}

test('empty find output stops before sync and cleanup', () => {
  const result = run(extract, ['/downloads/pixiv'], '')
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  withList(result.stdout, file => assert.equal(run(count, ['-', file]).status, 1))
})
