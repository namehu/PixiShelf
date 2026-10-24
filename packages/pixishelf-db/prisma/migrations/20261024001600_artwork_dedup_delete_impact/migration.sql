-- Legacy operation evidence is left NULL and retains its original meaning.
ALTER TABLE "ArtworkDedupOperationArtwork" ADD COLUMN "impactSignature" TEXT;
CREATE FUNCTION artwork_dedup_direct_delete_impact_signature(artwork_id integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
   (SELECT to_jsonb(a)-ARRAY['updatedAt','deletedAt','likeCount'] FROM "Artwork" a WHERE a.id=artwork_id),
   (SELECT jsonb_agg(jsonb_build_array(to_jsonb(m),to_jsonb(t)) ORDER BY m.id) FROM "ArtworkTag" m JOIN "Tag" t ON t.id=m."tagId" WHERE m."artworkId"=artwork_id),
   (SELECT jsonb_agg(jsonb_build_array(to_jsonb(m),to_jsonb(s)) ORDER BY m."seriesId") FROM "SeriesArtwork" m JOIN "Series" s ON s.id=m."seriesId" WHERE m."artworkId"=artwork_id),
   (SELECT jsonb_agg(jsonb_build_array(i.id,v."posterPath",v."manualPosterTimestamp") ORDER BY i.id) FROM "Image" i LEFT JOIN "MediaVideoMetadata" v ON v."imageId"=i.id WHERE i."artworkId"=artwork_id),
   (SELECT jsonb_agg(jsonb_build_array(p.id,p."previewPath") ORDER BY p.id) FROM "MediaChapterPreview" p JOIN "Image" i ON i.id=p."imageId" WHERE i."artworkId"=artwork_id)
 )::text,'UTF8')),'hex');
$$;
