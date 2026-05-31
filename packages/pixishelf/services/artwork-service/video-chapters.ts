import 'server-only'

import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { z } from 'zod'
import { getScanPath } from '@/services/setting.service'
import { isVideoFile } from '@/lib/media'
import { prisma } from '@/lib/prisma'

const MAX_CHAPTER_MANIFEST_SIZE = 5 * 1024 * 1024

export interface VideoChapter {
  index: number
  title: string
  start: number
  end: number
  duration: number
  file?: string
}

export interface VideoChapterManifest {
  version: 1
  duration: number
  chapters: VideoChapter[]
}

export interface ChapterMeta {
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}

export interface VideoChapterManifestResponse extends VideoChapterManifest {
  source: 'chapters-file'
}

const chapterItemSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().optional().default(''),
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  file: z.string().optional()
})

const chapterManifestSchema = z.object({
  version: z.literal(1),
  duration: z.number(),
  chapters: z.array(chapterItemSchema).min(1)
})

/**
 * 校验并规范化章节清单
 * @param input 任意输入
 * @returns 规范化后的章节清单
 */
export async function validateChapterManifest(input: unknown): Promise<VideoChapterManifest> {
  const parsed = chapterManifestSchema.parse(input)

  if (parsed.duration <= 0) {
    throw new Error('Chapter manifest duration must be greater than 0')
  }

  const normalizedChapters = parsed.chapters.map((chapter) => {
    if (chapter.start < 0) {
      throw new Error(`Chapter ${chapter.index} start must be greater than or equal to 0`)
    }

    if (chapter.end <= chapter.start) {
      throw new Error(`Chapter ${chapter.index} end must be greater than start`)
    }

    const actualDuration = chapter.end - chapter.start
    if (Math.abs(chapter.duration - actualDuration) >= 0.05) {
      throw new Error(`Chapter ${chapter.index} duration does not match end - start`)
    }

    const title = chapter.title.trim() || `Chapter ${chapter.index}`
    return {
      ...chapter,
      title
    }
  })

  for (let index = 1; index < normalizedChapters.length; index++) {
    const previous = normalizedChapters[index - 1]!
    const current = normalizedChapters[index]!

    if (current.start < previous.start) {
      throw new Error(`Chapter ${current.index} must be sorted by start time`)
    }

    if (current.start < previous.end) {
      throw new Error(`Chapter ${current.index} overlaps with chapter ${previous.index}`)
    }
  }

  return {
    version: 1,
    duration: parsed.duration,
    chapters: normalizedChapters
  }
}

/**
 * 获取章节文件候选路径
 * @param videoPath 视频相对路径
 * @returns 同 basename 的章节文件候选
 */
export function getChapterPathCandidates(videoPath: string): string[] {
  const normalizedVideoPath = toStoredPath(videoPath)
  const parsedPath = path.posix.parse(normalizedVideoPath)

  if (!parsedPath.ext || !isVideoFile(parsedPath.base)) {
    return []
  }

  const basePath = joinPosixPath(parsedPath.dir, parsedPath.name)

  return [`${basePath}.chapters.json`, `${basePath}..chapters.json`]
}

/**
 * 生成规范章节路径
 * @param videoPath 视频相对路径
 * @returns 规范的单点命名章节路径
 */
export function resolveCanonicalChapterPath(videoPath: string): string {
  const candidates = getChapterPathCandidates(videoPath)
  if (candidates.length === 0) {
    throw new Error(`Unsupported video path: ${videoPath}`)
  }

  return candidates[0]!
}

/**
 * 发现视频关联的章节文件并生成摘要
 * @param videoPath 视频相对路径
 * @returns 章节摘要或 null
 */
export async function discoverChaptersForVideo(videoPath: string): Promise<ChapterMeta | null> {
  const scanPath = await getScanPath()
  if (!scanPath) {
    return null
  }

  return discoverChaptersForVideoInScanRoot(scanPath, videoPath)
}

/**
 * 在指定扫描目录内发现视频关联的章节文件并生成摘要
 * @param scanPath 扫描根目录
 * @param videoPath 视频相对路径
 * @returns 章节摘要或 null
 */
export async function discoverChaptersForVideoInScanRoot(
  scanPath: string,
  videoPath: string
): Promise<ChapterMeta | null> {
  for (const chaptersPath of getChapterPathCandidates(videoPath)) {
    const absolutePath = resolvePathWithinScanRoot(scanPath, chaptersPath)
    const fileInfo = await readChapterManifestFile(absolutePath)
    if (!fileInfo) {
      continue
    }

    const manifest = await validateChapterManifest(fileInfo.json)

    return {
      chaptersPath,
      chaptersCount: manifest.chapters.length,
      chaptersDuration: manifest.duration,
      chaptersHash: createChapterManifestHash(manifest)
    }
  }

  return null
}

/**
 * 按图片 ID 读取章节清单
 * @param imageId 图片 ID
 * @returns 标准章节响应；无章节时返回 null
 */
export async function getVideoChapterManifestByImageId(imageId: number): Promise<VideoChapterManifestResponse | null> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      path: true,
      chaptersPath: true
    }
  })

  if (!image) {
    throw new Error('Image not found')
  }

  if (!isVideoFile(image.path)) {
    throw new Error('Image is not a video')
  }

  if (!image.chaptersPath) {
    return null
  }

  const manifest = await readChapterManifestByStoredPath(image.chaptersPath)
  if (!manifest) {
    return null
  }

  return {
    source: 'chapters-file',
    ...manifest
  }
}

/**
 * 按数据库存储路径读取章节清单
 * @param chaptersPath 数据库存储的章节相对路径
 * @returns 标准章节清单；文件不存在时返回 null
 */
export async function readChapterManifestByStoredPath(chaptersPath: string): Promise<VideoChapterManifest | null> {
  const scanPath = await getScanPath()
  if (!scanPath) {
    return null
  }

  const absolutePath = resolvePathWithinScanRoot(scanPath, chaptersPath)
  const fileInfo = await readChapterManifestFile(absolutePath)
  if (!fileInfo) {
    return null
  }

  return validateChapterManifest(fileInfo.json)
}

/**
 * 读取并解析章节文件
 * @param absolutePath 章节文件绝对路径
 * @returns JSON 对象或 null
 */
async function readChapterManifestFile(absolutePath: string): Promise<{ json: unknown } | null> {
  try {
    const stats = await fs.stat(absolutePath)
    if (!stats.isFile()) {
      return null
    }

    if (stats.size > MAX_CHAPTER_MANIFEST_SIZE) {
      throw new Error(`Chapter manifest exceeds ${MAX_CHAPTER_MANIFEST_SIZE} bytes`)
    }

    const raw = await fs.readFile(absolutePath, 'utf8')
    return {
      json: JSON.parse(raw)
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid chapter manifest JSON: ${absolutePath}`)
    }

    throw error
  }
}

/**
 * 计算章节清单摘要哈希
 * @param manifest 章节清单
 * @returns 稳定哈希值
 */
function createChapterManifestHash(manifest: VideoChapterManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

/**
 * 统一数据库存储路径格式
 * @param input 原始路径
 * @returns 使用 / 的相对路径
 */
function toStoredPath(input: string): string {
  const normalizedPath = input.replace(/\\/g, '/')
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
}

/**
 * 拼接 posix 风格路径
 * @param dir 目录
 * @param base 文件名
 * @returns 合并后的路径
 */
function joinPosixPath(dir: string, base: string): string {
  const joined = dir ? path.posix.join(dir, base) : base
  return joined.startsWith('/') ? joined : `/${joined}`
}

/**
 * 将相对路径解析到扫描目录内
 * @param scanRoot 扫描根目录
 * @param relativePath 数据库存储的相对路径
 * @returns 安全的绝对路径
 */
function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
