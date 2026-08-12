# Artwork feed query performance

Baseline date: 2026-08-12. PostgreSQL measurements use `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` against connection-scoped temporary tables, so benchmark data never enters the PixiShelf database.

## Dataset and scenarios

- 50,000 artworks, 200 artists, 300,000 artwork-tag relations, 200,000 media rows, and 16,666 video metadata rows.
- Indexes mirror the relevant Prisma schema indexes, including artwork source date, artwork-tag pairs, artwork-media path, media type, and video metadata.
- The complex filter combines two required tags, source type, audible video, video media type, source date, and database-created date.
- Timings below cover database selection only. Media hydration, response serialization, and network transfer must still be measured in the target deployment when investigating an incident.

## Baseline and result

| Query | Before | After | Acceptance |
| --- | ---: | ---: | ---: |
| Card list default first-page count | 6.014 ms | unchanged | <= 25 ms |
| Card list default first-page IDs | 0.075 ms | unchanged | <= 25 ms |
| Card list ordered page at offset 25,000 | 6.612 ms | unchanged | <= 25 ms at this dataset size |
| Complex viewer exact count | 239.686 ms on every page | removed | no `COUNT(*)` in Viewer page query |
| Complex viewer page selection | 58.674 ms | 15.261 ms | <= 25 ms |
| Stable random page selection | 63.808 ms | unchanged | <= 100 ms |

The multi-tag predicate now starts with the selective `ArtworkTag(tagId, artworkId)` index, groups matching artwork IDs once, and joins the remaining filters to that candidate set. Previously it ran a correlated aggregate for thousands of candidate artworks. Viewer pagination now requests one extra row to determine `nextPage`, so it no longer repeats an exact count that the UI never displays.

## Regression gates

- Unit tests require grouped multi-tag SQL and reject the former correlated predicate.
- Viewer service tests require exactly one raw page-selection query, no `COUNT(*)`, one batch media query, one batch tag query, and one batch like-status query.
- Card list tests preserve its first-page-only count and later-page overfetch behavior.
- Stable random ordering remains an `O(n)` scan and top-N sort because its seed is dynamic. Revisit the random pagination strategy before treating 100,000+ artwork libraries as a supported performance target.
