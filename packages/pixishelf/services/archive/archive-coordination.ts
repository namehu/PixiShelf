/**
 * Serializes archive publication, intake enqueue decisions, and lifecycle
 * maintenance that mutate the same provider identity or published artwork.
 *
 * Same lane/identity mutations are kept inside one advisory-lock domain so
 * a staging cleanup, a lifecycle transition, and a publish/update path cannot
 * interleave and observe each other's partial writes.
 */
export const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117
