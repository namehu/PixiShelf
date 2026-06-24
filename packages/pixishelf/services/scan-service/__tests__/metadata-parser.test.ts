import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractArtworkIdFromFilename, isMetadataFile, parseMetadataFile } from '../metadata-parser'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-metadata-parser-'))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('extractArtworkIdFromFilename', () => {
  it('should parse id from standard metadata filename', () => {
    expect(extractArtworkIdFromFilename('142456503-meta.txt')).toBe('142456503')
  })

  it('should parse id from paged metadata filename', () => {
    expect(extractArtworkIdFromFilename('142456503_p0-meta.txt')).toBe('142456503')
  })

  it('should parse id from json metadata filename', () => {
    expect(extractArtworkIdFromFilename('142456503-meta.json')).toBe('142456503')
    expect(extractArtworkIdFromFilename('142456503_p0-meta.json')).toBe('142456503')
  })

  it('should return null for invalid metadata filename', () => {
    expect(extractArtworkIdFromFilename('foo-meta.txt')).toBeNull()
  })
})

describe('isMetadataFile', () => {
  it('should identify paged metadata filename as metadata file', () => {
    expect(isMetadataFile('142456503_p2-meta.txt')).toBe(true)
  })

  it('should identify json metadata filename as metadata file', () => {
    expect(isMetadataFile('142456503-meta.json')).toBe(true)
  })
})

describe('parseMetadataFile', () => {
  it('should parse pixiv json metadata into normalized metadata', async () => {
    const filePath = path.join(tempDir, '145867935-meta.json')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        aiType: 1,
        idNum: 145867935,
        id: '145867935_p0',
        original: 'https://i.pximg.net/img-original/img/2026/06/11/12/00/25/145867935_p0.jpg',
        thumb: 'https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/06/11/12/00/25/145867935_p0_square1200.jpg',
        title: 'ガンガンpixiv6月コミックス発売情報',
        description: 'pixiv事務局です。<br />本文',
        pageCount: 5,
        index: 0,
        tags: ['漫画', 'pixivコミック'],
        user: 'pixiv事務局',
        userId: '11',
        fullWidth: 750,
        fullHeight: 750,
        ext: 'jpg',
        bmk: 722,
        date: '2026-06-11T03:00:00+00:00',
        uploadDate: '2026-06-11T03:00:00+00:00',
        type: 1,
        seriesTitle: 'シリーズ',
        seriesOrder: 4,
        seriesId: 12345,
        likeCount: 606,
        viewCount: 61657,
        commentCount: 1,
        xRestrict: 0,
        sl: 2
      }),
      'utf-8'
    )

    const result = await parseMetadataFile(filePath)

    expect(result.success).toBe(true)
    expect(result.metadata).toMatchObject({
      id: '145867935',
      user: 'pixiv事務局',
      userId: '11',
      title: 'ガンガンpixiv6月コミックス発売情報',
      description: 'pixiv事務局です。<br />本文',
      tags: ['漫画', 'pixivコミック'],
      original: 'https://i.pximg.net/img-original/img/2026/06/11/12/00/25/145867935_p0.jpg',
      thumbnail: 'https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/06/11/12/00/25/145867935_p0_square1200.jpg',
      bookmark: 722,
      metadataFormat: 'json',
      pixivAiType: 1,
      pixivType: 1,
      sanityLevel: 2
    })
    expect(result.metadata?.date?.toISOString()).toBe('2026-06-11T03:00:00.000Z')
    expect(result.metadata?.rawMetadataJson).toMatchObject({ likeCount: 606 })
    expect(result.metadata).not.toHaveProperty('likeCount')
    expect(result.metadata).not.toHaveProperty('pageCount')
    expect(result.metadata).not.toHaveProperty('pageIndex')
    expect(result.metadata).not.toHaveProperty('width')
    expect(result.metadata).not.toHaveProperty('height')
    expect(result.metadata).not.toHaveProperty('viewCount')
    expect(result.metadata).not.toHaveProperty('commentCount')
    expect(result.metadata).not.toHaveProperty('seriesTitle')
    expect(result.metadata).not.toHaveProperty('sourceSeriesId')
    expect(result.metadata).not.toHaveProperty('seriesOrder')
  })

  it('should fail clearly for invalid json metadata', async () => {
    const filePath = path.join(tempDir, '145867935-meta.json')
    await fs.writeFile(filePath, '{bad json', 'utf-8')

    const result = await parseMetadataFile(filePath)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid JSON metadata')
  })
})
