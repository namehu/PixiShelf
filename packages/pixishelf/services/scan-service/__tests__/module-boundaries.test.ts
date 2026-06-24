import { describe, expect, expectTypeOf, it } from 'vitest'
import { scan } from '../scan'
import { rescanArtwork, rescanLocalArtwork } from '../rescan'
import { prepareMetadataFilesFromList } from '../metadata-files'
import type { ArtistCacheEntry, ScanContext, ScanOptions } from '../types'
import * as publicApi from '../index'

describe('scan-service module boundaries', () => {
  it('exposes each operation from its owning module', () => {
    expect(typeof scan).toBe('function')
    expect(typeof rescanArtwork).toBe('function')
    expect(typeof rescanLocalArtwork).toBe('function')
    expect(typeof prepareMetadataFilesFromList).toBe('function')
  })

  it('keeps the existing public facade', () => {
    const typeCheck: ScanOptions = { scanPath: '/scan' }
    expect(typeCheck.scanPath).toBe('/scan')
    expect(publicApi.scan).toBe(scan)
    expect(publicApi.rescanArtwork).toBe(rescanArtwork)
    expect(publicApi.rescanLocalArtwork).toBe(rescanLocalArtwork)
    expect(publicApi.prepareMetadataFilesFromList).toBe(prepareMetadataFilesFromList)
  })

  it('keeps scan context caches typed without broad any artist values', () => {
    expectTypeOf<ScanContext['artistCache']>().toEqualTypeOf<Map<string, ArtistCacheEntry>>()
  })
})
