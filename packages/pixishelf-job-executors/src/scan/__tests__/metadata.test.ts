import { describe, expect, it } from 'vitest'
import { metadataCandidateFromPath, parseMetadataDocument, selectPreferredMetadataCandidates } from '../metadata.js'

describe('scan metadata adapter', () => {
  it('adapts JSON and legacy text metadata to one stable domain shape', () => {
    expect(
      parseMetadataDocument(
        JSON.stringify({ idNum: '42_p0', user: 'Artist', userId: '7', title: 'Work', tags: ['a', 'a'], aiType: 1 }),
        'json'
      )
    ).toMatchObject({ id: '42', userId: '7', title: 'Work', tags: ['a'], isAiGenerated: true })
    expect(
      parseMetadataDocument('ID\n42\n\nUser\nArtist\n\nUserID\n7\n\nTitle\nWork\n\nTags\n#a\n#b', 'txt')
    ).toMatchObject({ id: '42', tags: ['a', 'b'], metadataFormat: 'txt' })
  })

  it('prefers JSON deterministically and rejects malformed required identity', () => {
    const json = metadataCandidateFromPath({ relativePath: 'a/42-meta.json', absolutePath: '/root/a/42-meta.json' })!
    const txt = metadataCandidateFromPath({ relativePath: 'a/42-meta.txt', absolutePath: '/root/a/42-meta.txt' })!
    expect(selectPreferredMetadataCandidates([txt, json])).toEqual([json])
    expect(() => parseMetadataDocument('{}', 'json')).toThrow('Metadata ID')
  })
})
