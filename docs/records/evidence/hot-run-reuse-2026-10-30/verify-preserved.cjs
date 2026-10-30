const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const preserved = '/private/tmp/pixishelf-dedup-hot-20261030'
const label = process.argv[2]
assert.match(label || '', /^[a-z0-9-]+$/)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'))
  assert.equal(manifest.root, path.join(preserved, 'media'))
  const content = createHash('sha256')
  let files = 0
  for (const artwork of manifest.artworks)
    for (const file of artwork.files) {
      const location = path.join(manifest.root, file.path)
      assert.ok(location.startsWith(preserved + '/media/'))
      const bytes = await fs.readFile(location),
        stat = await fs.stat(location, { bigint: true }),
        sha256 = hash(bytes)
      assert.equal(sha256, file.sha256)
      content.update(
        JSON.stringify([file.path, sha256, String(stat.size), String(stat.mtimeNs), String(stat.ino), String(stat.dev)])
      )
      files++
    }
  const fileStateDigest = content.digest('hex')
  assert.equal(files, 2000)
  assert.equal(fileStateDigest, manifest.fileStateDigest)
  const dumpSha256 = hash(await fs.readFile(path.join(preserved, 'checkpoint.dump')))
  assert.equal(dumpSha256, '27f56230021955550eae72292d8db06e02894177ced3008653e1a2fe46835b0a')
  const evidence = {
    at: new Date().toISOString(),
    label,
    files,
    artworks: manifest.artworks.length,
    fileStateDigest,
    dumpSha256,
    unchanged: true
  }
  await fs.writeFile(path.join(base, 'evidence', label + '-preserved.json'), JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx'
  })
  console.log(JSON.stringify(evidence))
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
