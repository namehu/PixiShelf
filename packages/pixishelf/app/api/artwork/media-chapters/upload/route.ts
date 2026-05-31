import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { getScanPath } from '@/services/setting.service'
import {
  discoverChaptersForVideoInScanRoot,
  getChapterPathCandidates,
  resolveCanonicalChapterPath,
  validateChapterManifest
} from '@/services/artwork-service/video-chapters'
import { associateChaptersToImage } from '@/services/artwork-service/image-manager'
import {
  buildCanonicalChapterFileName,
  isChapterManifestFileName
} from '@/utils/artwork/video-chapter-files'

export async function POST(_req: NextRequest) {
  try {
    const formData = await _req.formData()
    const artworkId = Number(formData.get('artworkId'))
    const imageIdValue = formData.get('imageId')
    const imageId = imageIdValue ? Number(imageIdValue) : null
    const videoPathValue = formData.get('videoPath')
    const file = formData.get('file')

    if (!artworkId || Number.isNaN(artworkId)) {
      return NextResponse.json({ error: 'Invalid artworkId' }, { status: 400 })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    if (!isChapterManifestFileName(file.name)) {
      return NextResponse.json({ error: 'Unsupported chapter manifest file name' }, { status: 400 })
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Chapter manifest exceeds 5MB limit' }, { status: 400 })
    }

    const scanRoot = await getScanPath()
    if (!scanRoot) {
      return NextResponse.json({ error: 'SCAN_PATH not set' }, { status: 500 })
    }

    let videoPath = typeof videoPathValue === 'string' ? videoPathValue : ''
    if (imageId) {
      const image = await prisma.image.findUnique({
        where: { id: imageId },
        select: { id: true, artworkId: true, path: true }
      })

      if (!image || image.artworkId !== artworkId) {
        return NextResponse.json({ error: 'Image not found for artwork' }, { status: 404 })
      }

      videoPath = image.path
    }

    if (!videoPath) {
      return NextResponse.json({ error: 'Missing videoPath or imageId' }, { status: 400 })
    }

    const manifestText = await file.text()
    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(manifestText)
    } catch {
      return NextResponse.json({ error: 'Invalid chapter manifest JSON' }, { status: 400 })
    }

    let manifest
    try {
      manifest = await validateChapterManifest(manifestJson)
    } catch (error: any) {
      return NextResponse.json({ error: error.message || 'Invalid chapter manifest' }, { status: 400 })
    }

    const canonicalChaptersPath = resolveCanonicalChapterPath(videoPath)
    const canonicalAbsolutePath = resolvePathWithinScanRoot(scanRoot, canonicalChaptersPath)
    await fs.mkdir(path.dirname(canonicalAbsolutePath), { recursive: true })
    await fs.writeFile(canonicalAbsolutePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    for (const candidate of getChapterPathCandidates(videoPath)) {
      if (candidate === canonicalChaptersPath) continue
      const candidateAbsolutePath = resolvePathWithinScanRoot(scanRoot, candidate)
      await fs.rm(candidateAbsolutePath, { force: true }).catch(() => {})
    }

    const chaptersMeta = await discoverChaptersForVideoInScanRoot(scanRoot, videoPath)
    if (!chaptersMeta) {
      return NextResponse.json({ error: 'Failed to discover uploaded chapter manifest' }, { status: 500 })
    }

    if (imageId) {
      await associateChaptersToImage({
        imageId,
        ...chaptersMeta
      })
    }

    return NextResponse.json({
      success: true,
      meta: {
        videoFileName: path.posix.basename(videoPath.replace(/\\/g, '/')),
        chaptersFileName: buildCanonicalChapterFileName(path.posix.basename(videoPath.replace(/\\/g, '/'))),
        ...chaptersMeta
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
