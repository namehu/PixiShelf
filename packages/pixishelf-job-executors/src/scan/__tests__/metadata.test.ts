import { describe, expect, it } from 'vitest'
import { metadataCandidateFromPath, parseMetadataDocument, selectPreferredMetadataCandidates } from '../metadata.js'

describe('scan metadata adapter', () => {
  it('adapts JSON and legacy text metadata to one stable domain shape', () => {
    expect(
      parseMetadataDocument(
        JSON.stringify({ idNum: '42_p0', user: 'Artist', userId: '7', title: 'Work', tags: ['a', 'a'], aiType: 1 }),
        'json'
      )
    ).toMatchObject({ id: '42', userId: '7', title: 'Work', tags: ['a'], isAiGenerated: false })
    expect(
      parseMetadataDocument(
        JSON.stringify({ idNum: '43', user: 'Artist', userId: '7', title: 'AI Work', tags: ['AI生成'], aiType: 2 }),
        'json'
      )
    ).toMatchObject({ id: '43', isAiGenerated: true, pixivAiType: 2 })
    expect(
      parseMetadataDocument('ID\n42\n\nUser\nArtist\n\nUserID\n7\n\nTitle\nWork\n\nTags\n#a\n#b', 'txt')
    ).toMatchObject({ id: '42', tags: ['a', 'b'], metadataFormat: 'txt' })
  })

  it('keeps legacy TXT AI Yes, No, and missing values compatible without inventing pixivAiType', () => {
    const base = 'ID\n42\n\nUser\nArtist\n\nUserID\n7\n\nTitle\nWork'

    expect(parseMetadataDocument(`${base}\n\nAI\nYes`, 'txt')).toMatchObject({
      pixivAiType: null,
      isAiGenerated: true
    })
    expect(parseMetadataDocument(`${base}\n\nAI\nNo`, 'txt')).toMatchObject({
      pixivAiType: null,
      isAiGenerated: false
    })
    expect(parseMetadataDocument(base, 'txt')).toMatchObject({
      pixivAiType: null,
      isAiGenerated: null
    })
  })

  it('prefers JSON deterministically and rejects malformed required identity', () => {
    const json = metadataCandidateFromPath({ relativePath: 'a/42-meta.json', absolutePath: '/root/a/42-meta.json' })!
    const txt = metadataCandidateFromPath({ relativePath: 'a/42-meta.txt', absolutePath: '/root/a/42-meta.txt' })!
    expect(selectPreferredMetadataCandidates([txt, json])).toEqual([json])
    expect(() => parseMetadataDocument('{}', 'json')).toThrow('Metadata ID')
  })
})
