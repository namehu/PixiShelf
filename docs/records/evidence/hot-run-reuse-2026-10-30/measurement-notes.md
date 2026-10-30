# Hot-run reuse same-input measurement — 2026-10-30

One isolated full-executor incremental run per revision: v0.55.2 c8d1f380 (v8) and frozen new source (v9). This is a warm local observation, with no repeated big benchmark or full App validation, and no NAS latency claim.

## Frozen input and recovery basis

The exact retained 2,000 physical images / 50 artworks were read-only reused. File digest includes relative path, SHA-256, size, mtimeNs, inode and device: `8680a87f640a4e625c6443d49fa8582c6252b49759f6c5d7ffbdd82c0a92977a`. Both measured databases were restored from the same preserved warm dump SHA-256 `27f56230021955550eae72292d8db06e02894177ced3008653e1a2fe46835b0a`. The old sample and dump were not changed. New v9 clones received only the job-policy migration to accept scan version9; row preservation and negative policy probes are in the dated policy evidence. The v8 baseline clone retained133 migrations.

Source and bundle hashes, including the identical common driver hash, are in [source-hashes.json](./source-hashes.json). Private dump, credentials, account fixture and full raw outputs remain outside Git in the task temp directory. Browser media is an independent copy. No App or Worker service competed during the comparison.

## Results and boundaries

| Metric                                         |          Before |           After |
| ---------------------------------------------- | --------------: | --------------: |
| Full measured wall, including real queue waits |   12,447.587 ms |    3,474.777 ms |
| Context mutation/finalization transactions     |             659 |              21 |
| SQL BEGIN, including queue/fence work          |             666 |              24 |
| Real SQL statements, including controls        |           12741 |             704 |
| Instrumented Prisma API operations             |            9811 |             593 |
| Sampled whole-process RSS peak                 | 171786240 bytes | 169459712 bytes |
| Scheduling waits actually slept                |            0 ms |            0 ms |

Wall reduction is 72.085%; context transaction reduction is 96.813%. Targets were60% and80%, respectively. These are sequential single observations, not confidence intervals. Both return semantic result digest `9c8c620c96e92375cf1ed94477297d09527affbf2697bbf774d1c0be912a6bb0`. See [measurement.json](./measurement.json) for exact result graph, cache/read/decoding/search counters and memory.

Wall starts before the first measured queue read and ends after terminal settlement reads; fixture freezing and result audit are excluded. SQL is captured by a dedicated Prisma client query-event listener, with no parameters or connection credentials. API methods, context transactions, runtime persisted counters and real SQL statements have separately named scopes.

The common wrapper measures beforeBody (transaction acquisition plus pre-fence), body, and afterBody (post-fence plus commit/finalization) for both versions. New runtime observers further split only successfully committed mutation transactions into acquisition/pre-fence/body/post-fence/commit-finalization. Baseline unsupported splits are null. Finalizer split is unavailable; persisted snapshots are explicitly incomplete at their cutoff. Timestamped persisted-run observations are not represented as exact end-to-end phase wall, and SQL is not assigned to inferred phases.

RSS sampled every20 ms covers the whole benchmark process during the run; process-lifetime high-water and reader child peaks are separate. metadataPeakBytes estimates task metadata, not total Worker memory or a container limit.

The SQL files retain the union of top30 frequency and top15 query-event-duration groups with exact aggregate counts/durations for all omitted groups. These reconcile to whole-run totals. Full raw groups remain private with checksums.

## Replay

Use a fresh uniquely named isolated clone of the preserved checkpoint, the same physical fixture and both frozen sources. The helpers refuse existing output/database names. Build the identical dated driver against each source with build-benchmark.cjs; measure baseline with HOT_RUN_DEFINITION_VERSION=8 and new source with9. Do not reuse completed measured databases as if they were the warm checkpoint. The driver honors real availableAt waits. Keep output, SQL groups and source hashes together.

## Final runtime and separate recovery checks

The measured optimized snapshot logged performance inputDigest/searchVersion as null, while its durable result search version remained available. These measured unknowns were retained without backfill. The final runtime adds only the checkpoint identity telemetry fields and its focused test; [runtime-variance.json](./runtime-variance.json) lists exact measured/runtime source hashes and patch. [services-source.json](./services-source.json) records the final Worker build. No performance run was repeated for this logging change.

Both actual Worker SIGKILL/restart cases passed on a separate 502-file tiny synthetic fixture: a committed500-original prefix and a copied group with member copy pending. Each resumed the same job at attempt2, completed502 originals without duplicate counters or rows, and produced the same result digest. See [worker-lifecycle.json](./worker-lifecycle.json). A deterministic test-only database barrier held the next uncommitted transaction; it was removed before recovery. The initial private startup-timeout mismatch and copied-root namespace setup failures are identified separately and their logs retained privately. They do not enter the A/B results or count as successful restart cases. All restart test Worker processes were stopped. Browser services ran separately for desktop acceptance; both original and resumed process groups have now been stopped, with no active job or port listener. See [final service audit](./browser-resume-delete-service-audit.json).

reusedRelations counts exact groups, containment relations and visual/partial pairs; copiedRows includes metadata and result detail stages. discardedCopyRows/discardedReusedRelations denote discarded committed copy work, and are not labeled replay. Unknown counters remain null.

The browser services were subsequently stopped with no active jobs. The sole unfinished gate is the specific synthetic delete confirmation; the READY operation and all keeper/target originals remain unchanged. See [continuation.md](./continuation.md) for owned-process cleanup and the exact restart command. No deletion, cancellation or database clearing was performed while waiting for confirmation.

## Final authorized deletion

After explicit user confirmation, the same isolated operation was submitted through the real browser and completed. Only synthetic artwork52 and its two originals were deleted; the other57 artworks/2028 original files and their recorded fields and SHA/state digest were unchanged. See [before](./browser-delete-resume-before.json), [after](./browser-delete-resume-after.json) and [desktop acceptance](./browser-acceptance.md). This closes the previously pending delete gate; previous READY-state evidence remains historical, and the action must not be replayed. No benchmark was repeated.
