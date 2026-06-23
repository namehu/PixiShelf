#!/usr/bin/env node

const { mkdtemp, mkdir, rm, writeFile } = require('fs/promises')
const os = require('os')
const path = require('path')

const DEFAULT_COUNT = 100
const DEFAULT_PAGES = 1
const DEFAULT_DEPTH = 2
const MIN_COUNT = 1
const MAX_COUNT = 100_000
const MIN_PAGES = 1
const MAX_PAGES = 100
const MIN_DEPTH = 1
const MAX_DEPTH = 4
const ARTWORK_ID_BASE = 900_000_000
const USER_ID_BASE = 700_000

function parseBenchmarkArgs(argv) {
  const options = {
    count: DEFAULT_COUNT,
    pages: DEFAULT_PAGES,
    depth: DEFAULT_DEPTH,
    keep: false
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    switch (arg) {
      case '--':
        break
      case '--count':
        options.count = parseIntegerOption(arg, argv[++i])
        break
      case '--pages':
        options.pages = parseIntegerOption(arg, argv[++i])
        break
      case '--depth':
        options.depth = parseIntegerOption(arg, argv[++i])
        break
      case '--base-dir':
        options.baseDir = parseStringOption(arg, argv[++i])
        break
      case '--keep':
        options.keep = true
        break
      case '--help':
      case '-h':
        printUsage()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  assertRange('count', options.count, MIN_COUNT, MAX_COUNT)
  assertRange('pages', options.pages, MIN_PAGES, MAX_PAGES)
  assertRange('depth', options.depth, MIN_DEPTH, MAX_DEPTH)

  return options
}

async function generateBenchmarkFixture(options) {
  const startTime = Date.now()
  const baseDir = options.baseDir || os.tmpdir()
  const scanPath = await mkdtemp(path.join(baseDir, 'pixishelf-scan-benchmark-'))
  let metadataFiles = 0
  let mediaFiles = 0

  for (let index = 0; index < options.count; index++) {
    const artworkId = ARTWORK_ID_BASE + index
    const directory = path.join(scanPath, ...buildDirectorySegments(index, options.depth))
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, `${artworkId}-meta.json`),
      JSON.stringify(buildMetadata(index, artworkId, options.pages))
    )
    metadataFiles++

    for (let page = 0; page < options.pages; page++) {
      await writeFile(path.join(directory, `${artworkId}_p${page}.jpg`), buildMediaPayload(index, page))
      mediaFiles++
    }
  }

  return {
    scanPath,
    artworks: options.count,
    metadataFiles,
    mediaFiles,
    durationMs: Date.now() - startTime
  }
}

async function cleanupBenchmarkFixture(scanPath, options) {
  if (options.keep) return
  await rm(scanPath, { recursive: true, force: true })
}

function buildDirectorySegments(index, depth) {
  const bucket = `bucket-${String(index % 100).padStart(3, '0')}`
  const artist = `artist-${String(index % 50).padStart(3, '0')}`
  const year = `year-${2020 + (index % 7)}`
  const shard = `shard-${String(index % 10).padStart(2, '0')}`
  return [bucket, artist, year, shard].slice(0, depth)
}

function buildMetadata(index, artworkId, pages) {
  const bucketName = `bucket-${String(index % 100).padStart(3, '0')}`
  const pageCountTag = `page-count-${pages}`
  const userIndex = index % 50

  return {
    id: artworkId,
    user: `Benchmark Artist ${String(userIndex).padStart(3, '0')}`,
    userId: String(USER_ID_BASE + userIndex),
    title: `Benchmark Artwork ${String(index).padStart(6, '0')}`,
    description: `Generated benchmark artwork ${index}.`,
    tags: ['benchmark', bucketName, pageCountTag],
    original: `https://example.invalid/original/${artworkId}.jpg`,
    thumb: `https://example.invalid/thumb/${artworkId}.jpg`,
    aiType: index % 11 === 0 ? 2 : 1,
    type: 0,
    sl: index % 7,
    fullWidth: 1200,
    fullHeight: 900,
    bmk: index % 1000,
    uploadDate: new Date(Date.UTC(2024, index % 12, (index % 28) + 1)).toISOString()
  }
}

function buildMediaPayload(index, page) {
  return `pixishelf benchmark media ${index}:${page}\n`
}

function parseIntegerOption(name, value) {
  if (!value) throw new Error(`${name} requires a value`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`)
  return parsed
}

function parseStringOption(name, value) {
  if (!value) throw new Error(`${name} requires a value`)
  return value
}

function assertRange(name, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
}

function printUsage() {
  console.log(`
用法:
  pnpm bench:scan-fixture -- --count 1000 --pages 2 --depth 3 --keep

参数:
  --count <n>     生成多少个作品。默认: ${DEFAULT_COUNT}
  --pages <n>     每个作品生成多少个媒体文件。默认: ${DEFAULT_PAGES}
  --depth <n>     目录嵌套深度，范围 1-4。默认: ${DEFAULT_DEPTH}
  --base-dir <p>  临时扫描目录的父目录。默认: 系统临时目录
  --keep          生成后保留目录，方便拿去页面里手工扫描
  --help          显示帮助
`)
}

async function main() {
  const options = parseBenchmarkArgs(process.argv.slice(2))
  const result = await generateBenchmarkFixture(options)

  console.log('PixiShelf 扫描压测目录已生成:')
  console.log(JSON.stringify(result, null, 2))
  console.log('')
  console.log('怎么使用这个目录压测真实扫描:')
  console.log('1. 启动 PixiShelf 开发服务。')
  console.log(`2. 打开后台扫描页面，把扫描路径填成: ${result.scanPath}`)
  console.log('3. 点击扫描后，在终端日志里搜索 "Scan performance checkpoint:" 查看分段耗时。')

  if (options.keep) {
    console.log('')
    console.log('已按 --keep 保留压测目录。用完后请手动删除。')
    return
  }

  await cleanupBenchmarkFixture(result.scanPath, { keep: false })
  console.log('')
  console.log('压测目录已自动清理。若要拿它去页面里手工扫描，请重新运行并加上 --keep。')
}

if (require.main === module) {
  main().catch((error) => {
    console.error('生成扫描压测目录失败:', error)
    process.exit(1)
  })
}

module.exports = {
  cleanupBenchmarkFixture,
  generateBenchmarkFixture,
  parseBenchmarkArgs
}
