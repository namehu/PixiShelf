# Desktop acceptance continuation — 2026-10-30

The final gate is now complete. The user explicitly confirmed only synthetic artwork 52 under operation `a705515b-9ea3-487b-bbe0-293565711fa9`; the same confirmation was submitted through the browser and reached DELETED / DONE. Artwork 52 and its two originals are gone; artwork 51 and all other artwork/file data were preserved. See [desktop acceptance](./browser-acceptance.md) and [after audit](./browser-delete-resume-after.json). **Do not replay deletion or recreate the fixture automatically.**

The following commands document how the isolated services were resumed after that confirmation, and may be used later for read-only evidence inspection. They do not perform deletion.

The original App/Worker groups73596/73597 were stopped while waiting for confirmation; [pending-delete-gate.json](./pending-delete-gate.json) preserves that historical READY state. After approval, the resumed groups78373/78374 were also stopped with no active jobs and no listeners on5502/55842. See [final service audit](./browser-resume-delete-service-audit.json), [final cleanup](./browser-process-cleanup-resume-delete.json) and [before final stop](./browser-before-stop-resume-delete.json). The database, remaining copied media, completed operation, private manifests and preserved warm dump remain in place.

To inspect the retained isolated environment later, use a fresh log label when restarting services from the task worktree:

```bash
cd /private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf
node docs/records/evidence/hot-run-reuse-2026-10-30/manage-browser-services.cjs start inspect-completed
curl -fsS http://127.0.0.1:55842/readyz
```

The helper records fresh owned process groups and new logs without overwriting prior evidence. It starts services only; it does not perform the deletion. The App uses `http://127.0.0.1:5502`, and validation URLs must include `entry=direct`. The existing private account and environment are under `/private/tmp/pixishelf-hot-run-reuse-20261030`; do not print or commit their contents. The operation is already complete. Open its deletion record to inspect evidence; do not click or recreate a deletion action. The previous READY state and pending-delete-gate.json are historical before-action evidence.

After completion, confirm no active job remains and stop only the fresh process groups recorded by the helper:

```bash
node docs/records/evidence/hot-run-reuse-2026-10-30/manage-browser-services.cjs stop
```

Do not repeat the A/B benchmark or clear databases, caches or media. [measurement.json](./measurement.json) and its frozen source hashes remain the accepted single-observation comparison. The final runtime differs only by the logged checkpoint identity and its focused test, as recorded in [runtime-variance.json](./runtime-variance.json).
