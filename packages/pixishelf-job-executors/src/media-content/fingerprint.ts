import { createHash, type Hash } from 'node:crypto'

export const MEDIA_CONTENT_ALGORITHM_VERSION = 1

export interface ContentTuple {
  size: bigint
  sha256: string
}

/** The caller streams the indexed canonical multiset; this accumulator never stores all members. */
export class ArtworkContentDigest {
  private readonly hash = createHash('sha256')
  private seen = 0n
  private previous: ContentTuple | undefined
  private finished = false

  constructor(private readonly expectedCount: bigint) {
    if (expectedCount <= 0n) throw new Error('Artwork must contain at least one original media file')
    field(this.hash, 'pixishelf-artwork-content-v1')
    field(this.hash, expectedCount.toString())
  }

  add(tuple: ContentTuple) {
    if (this.finished || this.seen >= this.expectedCount) throw new Error('Unexpected artwork content member')
    validate(tuple)
    if (this.previous && compareContentTuples(this.previous, tuple) > 0)
      throw new Error('Content members are not canonically sorted')
    field(this.hash, tuple.size.toString())
    this.hash.update(Buffer.from(tuple.sha256, 'hex'))
    this.previous = { ...tuple }
    this.seen += 1n
  }

  digest() {
    if (this.finished || this.seen !== this.expectedCount) throw new Error('Incomplete artwork content')
    this.finished = true
    return this.hash.digest('hex')
  }
}

export class ArtworkMemberDigest {
  private readonly hash = createHash('sha256')
  private seen = 0n
  private previousId = 0
  private finished = false

  constructor(
    private readonly artworkId: number,
    private readonly expectedCount: bigint
  ) {
    if (!Number.isSafeInteger(artworkId) || artworkId < 1 || expectedCount <= 0n)
      throw new Error('Invalid artwork member snapshot')
    field(this.hash, 'pixishelf-artwork-members-v1')
    field(this.hash, artworkId.toString())
    field(this.hash, expectedCount.toString())
  }

  add(input: { imageId: number; artworkId: number; canonicalPath: string; sourceRevision: bigint }) {
    if (
      this.finished ||
      this.seen >= this.expectedCount ||
      !Number.isSafeInteger(input.imageId) ||
      input.imageId <= this.previousId ||
      input.artworkId !== this.artworkId ||
      input.sourceRevision < 0n
    ) {
      throw new Error('Invalid artwork member sequence')
    }
    field(this.hash, input.imageId.toString())
    field(this.hash, input.canonicalPath)
    field(this.hash, input.sourceRevision.toString())
    this.previousId = input.imageId
    this.seen += 1n
  }

  digest() {
    if (this.finished || this.seen !== this.expectedCount) throw new Error('Incomplete artwork members')
    this.finished = true
    return this.hash.digest('hex')
  }
}

export function compareContentTuples(a: ContentTuple, b: ContentTuple) {
  return a.size < b.size
    ? -1
    : a.size > b.size
      ? 1
      : Buffer.compare(Buffer.from(a.sha256, 'hex'), Buffer.from(b.sha256, 'hex'))
}
function validate(value: ContentTuple) {
  if (value.size <= 0n || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid media content tuple')
}
function field(hash: Hash, text: string) {
  const bytes = Buffer.from(text, 'utf8')
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(bytes.length)
  hash.update(size).update(bytes)
}
