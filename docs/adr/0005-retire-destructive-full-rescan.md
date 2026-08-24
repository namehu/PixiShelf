---
status: accepted
scope: 退役破坏性 Pixiv 全量重扫，并以增量发现、定向来源同步和只读来源核对替代
last-verified: 2026-08-24
---

# Retire destructive full rescan in favor of source-aware maintenance

PixiShelf will remove destructive Pixiv full rescan from normal product and API workflows. Routine maintenance will be
split into incremental discovery for new or failed inputs, explicit refresh for selected Source References, and a
catalog-safe consistency audit that reports new, changed, missing, invalid, or conflicting source inputs before any
repair is requested.

This decision follows the separation between local Artwork identity and external Source References established by
[ADR-0001](./0001-separate-source-references-from-local-identity.md). An Artwork, its original media, and User Curation are not a
rebuildable cache of one Pixiv directory. Removing or rebuilding every Pixiv-created Artwork is therefore no longer a
valid routine synchronization strategy.

## Decision boundaries

- “Scan for new works” is the default directory action. Existing unchanged works do not enter the publish path.
- “Refresh source” is explicit and bounded to one Artwork or a selected set of audit results.
- “Audit source consistency” may enumerate the whole Pixiv metadata tree, but it does not delete Artwork, Media,
  Source References, User Curation, or original files.
- A missing metadata file is evidence for review, not permission to detach a Source Reference or delete an Artwork.
- Disaster reconstruction, if ever needed, is an offline backup-and-recovery operation and is not exposed as a normal
  page or webhook action.
- The existing scan Webhook URL, authentication, accepted response, and status polling contract remain compatible.
  List-mode callers must submit only `type=list` and `metadataList`; the public `force` request field is retired and
  rejected as invalid input for both directory discovery and explicit lists.
- Historical terminal `FULL_RECONCILE` jobs and `ScanRunMode.FULL` records remain readable. After the compatibility
  window and a non-terminal job audit, the v1 payload parser and executor branch are removed; the release procedure
  blocks installation while any old executable job remains.

## Considered options

- Keeping destructive full rescan behind a stronger confirmation was rejected because confirmation does not make
  multi-source identity, User Curation, or cross-filesystem recovery safe.
- Keeping the current `FULL_RECONCILE` bulk refresh under a new label was rejected because it still hashes, parses, and
  republishes every discovered source item and can silently amplify a publisher compatibility bug across the catalog.
- Keeping only “skip every existing work” incremental scan was rejected because metadata changes, failed imports,
  missing inputs, and post-restore drift would become permanently invisible.
- Automatically deleting missing Source References was rejected because an unavailable mount, wrong scan root, partial
  walk, or cancellation can look identical to genuine removal.

## Consequences

The ordinary workflow becomes safer and cheaper in proportion to the number of changed inputs rather than the number
of cataloged works. The system retains an explicit repair path and durable audit history, but no longer promises that a
single button can rebuild the catalog from one source directory.

The filesystem must still be enumerated when no trusted change feed exists. A persistent metadata inventory avoids
rehashing and republishing unchanged files; it does not claim that discovering new nested files can be constant time on
an arbitrary NAS filesystem.

The implementation and staged compatibility plan are defined in
[Pixiv source discovery, refresh, and audit](../design/pixiv-source-maintenance.md).
