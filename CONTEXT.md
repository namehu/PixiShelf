---
status: current
scope: 统一领域语言、概念关系与代码术语映射
last-verified: 2026-10-22
sources:
  - docs/product/product-baseline.md
  - packages/pixishelf-db/prisma/schema.prisma
  - docs/adr/
---

# PixiShelf Archive Catalog

PixiShelf maintains a local, source-independent catalog of archived works and their ordered media. External sites describe where a work came from; they do not define the work's local identity.

本文是代码、需求和文档共用的领域词汇表。英文术语对应代码概念，中文讨论可以使用“作品、媒体、来源引用”等译名，但不应为同一概念重新创造互相冲突的名称。

## Catalog

**Artwork**:
A locally cataloged work containing ordered media, descriptive metadata, and user-curated state. An Artwork exists independently of any external site.
_Avoid_: Gallery, remote work, source item

**Media**:
An ordered image, animation, or video belonging to an Artwork.
_Avoid_: Page, file, image when referring to all supported media

**Source Provider**:
An external site that identifies and supplies archiveable works, such as Pixiv or E-Hentai.
_Avoid_: Source, import type, platform when the provider role is meant

**Source Reference**:
The identity linking an Artwork to one Source Provider. Its external identifier is unique only within that provider.
_Avoid_: External ID by itself, source ID by itself

**Creation Method**:
The way an Artwork first entered PixiShelf, such as a source scan, URL archive, local directory import, or manual creation. It is independent of Source Provider.
_Avoid_: Source

**Storage Key**:
An immutable PixiShelf-assigned identifier used to keep a locally created or imported Artwork stable in storage. It is never a remote identity.
_Avoid_: External ID, provider ID

## Archiving

**Archive Intake Submission**:
A durable record of one administrator action that adds one or more source URLs. It groups audit context but does not create a closed batch lifecycle or change global FIFO order.
_Avoid_: Batch job, Archive Import

**Archive Intake Item**:
One durable URL-resolution entry in the global archive inbox FIFO. It may become ready, fail, be retried, or enqueue/reuse an Archive Import.
_Avoid_: Archive Item, browser request

**Archive Import**:
A durable, per-work attempt created or reused from a ready Archive Intake Item to preserve its frozen metadata and ordered media in PixiShelf.
_Avoid_: Scan, download when referring to the whole operation

**Archive Item**:
One ordered remote media entry tracked by an Archive Import.
_Avoid_: Image when its media type is not yet known

**Archive Revision**:
An immutable snapshot of an archived work at a point in time. The latest published revision is shown by default while earlier revisions remain recoverable.
_Avoid_: Version when referring to application releases

**Source Snapshot**:
The source-provided metadata observed during an Archive Import or update check.
_Avoid_: Artwork metadata when it may include local edits

**Published Archive**:
An Archive Revision whose required media and manifest have passed validation and are visible in the catalog.
_Avoid_: Completed download

## Curation

**Local Override**:
An intentional user edit that takes precedence over a later Source Snapshot without erasing the source-provided value.
_Avoid_: Manual metadata

**Source Tag**:
A tag assignment supplied by a particular Source Reference. Refreshing that source may replace its Source Tags but never user-curated or derived tags.
_Avoid_: Imported tag when its provenance matters

**Uploader**:
The source account that published a remote gallery. An Uploader is not assumed to be the Artwork's creator.
_Avoid_: Artist, creator

**Unknown Origin**:
An existing Artwork whose source identity cannot be established from trustworthy evidence. PixiShelf preserves it without guessing a Source Provider.
_Avoid_: Pixiv by default

## Collections

**Series**:
An ordered collection of independently meaningful Artworks. A Series does not replace the ordered Media inside one Artwork.
_Avoid_: Album when referring to one Artwork's media, folder when referring to a curated relation

**User Curation**:
Local titles, tags, ordering, grouping, likes, settings, and other decisions intentionally maintained by the owner.
_Avoid_: Cache, imported metadata

## Operations

**System Job**:
A durable execution record for one background operation, including its trigger, payload, state, progress, events, retry data, and terminal result.
_Avoid_: Request, thread, task definition

**Execution Lane**:
A fixed Worker resource class attached to every System Job. `ARCHIVE_RESOLVE` separates metadata resolution from `BACKGROUND_WRITER` media-writing jobs; both may update their own durable state. Execution and concurrency rules belong to the [current architecture](./docs/architecture/current-architecture.md).
_Avoid_: Worker process, configurable concurrency pool

**Scheduled Task**:
A persisted schedule definition that may materialize a System Job in an eligible window. It is not itself a run.
_Avoid_: Cron job instance, System Job

**Derived Media**:
A reproducible image generated from source media, such as a poster, chapter preview, or representative keyframe.
_Avoid_: Original, archive item

**Published Generation**:
The validated derived-media generation referenced by normal read paths. A replacement is prepared separately and becomes visible only after publication.
_Avoid_: Temporary output, any file that happens to exist

**Audit Record**:
A durable explanation of what a scan, import, replacement, migration, or background job attempted and what happened to each relevant item.
_Avoid_: Process log when business history is meant

## Creator attribution

**Artist**: a local PERSON or GROUP credited for a work. `ArtworkArtist` and its evidence maintain effective attribution; `Artwork.artistId` remains a legacy/storage reference. An Uploader is not assumed to be an Artist. See [creator relations](./docs/features/creator-relations.md).

**Series Membership**: an ordered `SeriesArtwork` relation with source, manual, or legacy provenance. Membership, local exclusion and sort override are separate from the Series' external identity. See [series ownership](./docs/features/pixiv-series-sync.md).

## Reading

**Logical Media**: one readable display item. Existing APNG/video group members jointly represent one item; physical Image row count is not always reading progress count.

**Reading Summary**: one account's progress, actual visit count and last position for an Artwork. Manual completion changes progress but does not fabricate a visit or viewing time.

**Media Revision**: the Artwork's reading-generation boundary. Full replacement or rebuild invalidates earlier reading state; ordinary edits retain still-existing media. See [reading semantics](./docs/features/artwork-reading.md).

## Concept relationships

![核心领域 UML 概念类图](./docs/diagrams/features/domain-model.svg)

[Mermaid 源文件](./docs/diagrams/features/domain-model.mmd)。图中的 Media 对应 Prisma `Image`，SourceReference 对应 `ArtworkExternalRef`，Account 对应 `UserBA`；这是概念关系图，不是字段全集。依据为 Schema 的作品、来源、创作者、系列和阅读关系。

`Archive Intake Submission` groups `Archive Intake Item`; an item enqueues or reuses `Archive Import`. A successful import publishes an immutable `Archive Revision`. `Scheduled Task` materializes `System Job`, which executes a domain transition. Runtime state does not replace domain audit history.

术语定义只在本文维护。产品不变量与非目标见[产品基线](./docs/product/product-baseline.md)；备份数据分类及恢复责任见[备份与恢复](./docs/operations/backup-and-recovery.md)；精确字段和枚举以 [Prisma Schema](./packages/pixishelf-db/prisma/schema.prisma) 为准。
