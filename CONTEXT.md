---
status: current
scope: PixiShelf 的统一领域语言、概念关系和业务不变量
last-verified: 2026-08-18
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

**Archive Import**:
A user-requested attempt to resolve a source URL and preserve its work, metadata, and media in PixiShelf.
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

## Concept Relationships

```text
Series
  └── ordered Artwork
        ├── ordered Media
        ├── zero or more Source Reference
        ├── Source Snapshot
        ├── User Curation / Local Override
        └── zero or more immutable Archive Revision

Scheduled Task ──materializes──> System Job ──executes──> domain transition
Source Media ──generates──> Derived Media ──publishes──> Published Generation
```

The important boundaries are:

- multiple media belonging to one work remain one Artwork with ordered Media;
- independently meaningful episodes or works can become multiple Artworks in a Series;
- provider identity, creation method, local identity, and storage location are separate concerns;
- runtime job state does not replace domain audit history;
- a file existing on disk does not by itself mean it is published or safe to expose.

## Business Invariants

1. `Artwork` remains meaningful without any Source Reference.
2. A remote identifier is unique only together with its Source Provider.
3. Creation Method never proves Source Provider identity.
4. Unknown historical origin is preserved as unknown instead of guessed.
5. Media order belongs to the Artwork and is stable unless an explicit reorder occurs.
6. Source refresh may replace Source Tags and Source Snapshots, but not User Curation or Local Overrides.
7. Archive Revisions are immutable after publication; updates publish a new revision.
8. Incomplete archive revisions and derived-media generations are not visible to normal catalog reads.
9. Original media and user curation are non-reproducible data; derived media may be rebuilt from validated originals.
10. Deletion, replacement, migration, and restoration of original media require an explicit durable intent and audit trail.
11. Database and filesystem state must be backed up and restored from a compatible point in time.
12. A browser request or process log is not sufficient durability for a long-running operation.
13. Production steady state has one queue-consuming general Worker; a legacy consumer cannot run beside an enabled Central Dispatcher.
14. An authenticated user is the instance administrator in the current single-user deployment. This is a deployment boundary, not a future multi-tenant authorization model.

## Data Classes

| Class               | Examples                                                         | Recovery expectation                                            |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Non-reproducible    | original media, local curation, source mapping, local overrides  | protect with consistent database and filesystem backups         |
| Operational history | System Jobs, events, audit records, migration history            | retain enough to diagnose and safely resume or recover          |
| Reproducible        | thumbnails, posters, chapter previews, keyframes, request caches | may be rebuilt, but publication pointers must remain consistent |

The product boundary and non-goals are defined in [Product Baseline](./docs/product/product-baseline.md). Exact fields and enum values remain authoritative in `packages/pixishelf-db/prisma/schema.prisma`.
