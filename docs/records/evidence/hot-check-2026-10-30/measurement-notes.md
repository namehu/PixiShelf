# Hot-check same-input measurement — 2026-10-30

This is one local isolated full-executor run per revision, not a NAS or production latency claim. No repeat of the earlier 5k/10k visual-kernel experiments was performed. No full App build/test was run for this measurement.

## Frozen inputs and recovery basis

- Old source: `git archive a46438f613a95a63fe2e348b61a2fbf336d07cc7`, retained at `/private/tmp/pixishelf-dedup-hot-20261030/baseline-source.tar`. SHA-256: `90ab1cadd84b073ae916e6ed3105585a4778c8028ae0613cf11c4d8659f5fb0a`.
- The 2026-10-29 release fixture was copied once into this task's temporary media root. It contains 2,000 registered still images, 50 artworks and 25 exact duplicate pairs. The files were reused, not regenerated. `fileStateDigest` in measurement.json includes relative path, SHA-256, size, mtimeNs, inode and device of each copied file.
- The archived old executor completed one FULL warmup before the checkpoint. The warmup is excluded from before/after measurements. Both measured runs use the same physical files and page/filesystem cache is warm; database clones share one completed warm-cache dump. No App or Worker service competed during measured runs.
- Databases are new `dedup_hot_*_20261030` databases on the retained isolated PostgreSQL listener `127.0.0.1:55432`. Each clone contains 50 Artwork, 2,000 Image, 2,000 MediaContentFingerprint, 2,000 MediaVisualFingerprint, and 133 finished migrations. `checkpoint.json` records the dump checksum and restore checks. The pg_restore client emitted `SET transaction_timeout = 0` unsupported by the server; this exact session setting was removed for subsequent SQL restores. The first baseline restore completed all data with only that one harmless setting warning; its counts were verified too.
- Source lists and built artifact checksums are in `source-hashes.json`. Baseline dependencies came from the archive's local package source paths; installed dependency directories were symlinked for building. The after snapshot overlays the implementation diff and new hot-batch module onto the archive. No uncommitted source was used as the old baseline.
- The private checkpoint dump, accounts, env files and media remain outside Git under the task temp directory. There was no schema migration in this change, and no development/production database or media write. The archive is the code recovery point; the dump plus fixed physical fixture is the measurement replay point.

## Results and metric boundaries

| Metric | Before | After |
| --- | ---: | ---: |
| Full measured wall, including scheduling waits | 32,768.605 ms | 25,195.629 ms |
| Through first INDEX performance snapshot | 30,078.132 ms | 22,167.514 ms |
| Executor mutation/finalization transaction wrapper calls | 814 | 666 |
| Persisted executor-domain transactions | 817 | 669 |
| SQL `BEGIN` statements, including queue/latch work | 825 | 677 |
| SQL statements, including transaction controls | 15,481 | 12,876 |
| Persisted executor-domain DB API calls | 8,540 | 7,169 |
| Instrumented Prisma operations, including queue/raw operations | 11,874 | 9,911 |
| Context mutation/finalization transaction wall sum | 25,229.810 ms | 23,487.366 ms |
| Persisted scheduling cooldown | 6,008 ms | 7 ms |

Total wall reduction is 23.11%; pre-INDEX wall reduction is 26.30%. These are sequential single observations, not a confidence interval. The two after yields were observed with `availableAt` already eligible (remaining 0 ms), while the two baseline yields still had roughly 3 seconds remaining each. The after 7 ms is real snapshot-to-eligibility settlement time; it is not rounded to zero.

Both full runs returned the same normalized result digest `f6b3f49dd2bd5d18dc5a7e2fcfbf3b5feb09e77f643eb591b0a62233359d4841`, input digest and search version. Both completed with statMedia=2,000, cacheHitMedia=2,000, hashedMedia=0, readBytes=0, decodedImages=0, ownFeatureHits=2,000, candidatePairs=0, compareCalls=0, indexNodeVisits=0 and indexRebuilds=0; 25 duplicate groups and zero changed/failed artworks. The entire STAT/originals/cache/relations/features/search/publication path ran; this is not just a prepared-feature visual-kernel timing.

The largest remaining measured transaction-wall bucket is MATCH: 14,450.730 → 14,203.392 ms; its SQL event duration is 13,467 → 13,309 ms. Original stat/cache bucket transaction wall is 6,446.539 → 4,645.128 ms. These buckets follow the most recently observed run stage/checkpoint; the first read of a transition can be associated with the previous bucket. They are not separately measured end-to-end phase wall and must not be added to total wall or persisted transaction durations. This round does not change relation/partial semantics.

Persisted API counts are completed executor-domain Prisma methods up to the performance snapshot cutoff; transaction capture includes the known finalizer but excludes its later full commit wall. The wrapper count excludes reader cleanup transactions which are performed through the dependency database. SQL query events independently count physical statements and transaction control, including queue/fence/settlement; SQL bind values and connection credentials were not recorded. Instrumented API counts include raw/queue operations and are a different scope from persisted domain counters.

## Replay without touching live instances

The exact measurement driver is `packages/pixishelf-job-executors/scripts/artwork-dedup-hot-check-benchmark.ts`; its identical driver hash is recorded for both bundles. All helper scripts in this directory are dated fixture tooling, with explicit `dedup_hot_*_20261030` / loopback-port guards and refusal to overwrite existing output/databases except the documented first-restore resume path. They require the retained 2026-10-29 fixture and installed workspace dependencies; the 2,000 source image bytes and private credentials are intentionally not embedded here.

1. Retain the archive, seed fixture manifest and private checkpoint. `prepare-databases.cjs` originally created fresh core/seed databases and deployed migrations; `seed-fixture.cjs` copied and verified the retained synthetic fixture. Do not rerun these against occupied task databases.
2. The warmup command used archived `baseline-bundle/hot-check-benchmark.cjs warm warm`. Its cache was then backed up and restored by `clone-checkpoint.cjs` into fresh baseline/after/browser/restart databases.
3. Build the same measurement driver against old/after frozen source using `build-benchmark.cjs SOURCE LABEL`. Source SHA-256 values must match `source-hashes.json` for an exact replay.
4. In a fresh isolated baseline clone, source its private env and run `node .../baseline-bundle/hot-check-benchmark.cjs measure baseline`; after it exits, source the after-clone env and run the corresponding after bundle. The driver respects real queue `availableAt`; it does not fast-forward scheduling clocks.
5. Preserve fresh output labels/directories for a replay. Do not overwrite the accepted evidence or reuse completed measured databases as if they were the original checkpoint. Keep output JSON, SQL groups and source hashes together.

The later browser/Worker lifecycle exercise uses a separate checkpoint clone after all measurements. Its process restarts, App compilation and browser traffic do not enter the numbers above.

The committed SQL files retain the union of the 30 most frequent and 15 highest query-event-duration groups, plus exact aggregate counts/durations for every omitted group by phase. Their sum reconciles to the whole-run SQL statement count. Full statement groups remain in the task temp evidence; committed files include their raw result checksums. This avoids copying roughly a megabyte of repeated normalized SELECT shapes into the repository.
