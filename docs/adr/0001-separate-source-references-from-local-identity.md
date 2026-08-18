---
status: accepted
scope: 外部来源引用与本地 Artwork 身份分离
last-verified: 2026-08-18
---

# Separate source references from local artwork identity

PixiShelf will keep `Artwork` source-independent and represent remote identity with Source References that are unique by `(providerKey, externalId)`. The existing local `e_{id}_{suffix}` value becomes a Storage Key and never represents a Source Provider; Creation Method is recorded separately from provider identity. This avoids cross-site numeric ID collisions, prevents local imports from being mislabeled as Pixiv, and lets one Artwork retain more than one trustworthy source reference without expanding a site-specific enum for every new provider.

## Considered options

- Adding `E_HENTAI_IMPORTED` to the existing source enum was rejected because it keeps mixing provider identity with ingestion method.
- Keeping one globally unique `externalId` was rejected because different providers legitimately reuse the same identifiers.
- Treating local storage as a fictional provider was rejected because a local creation method is not an external origin.

## Consequences

Existing Pixiv identities are backfilled only when supported by strong evidence. Ambiguous historical records remain Unknown Origin, and legacy fields stay in place through a compatibility release before any destructive cleanup.
