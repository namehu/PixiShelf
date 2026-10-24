-- SQL CHECK treats NULL as unknown/pass; explicitly require the new protocol's presence.
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_direct_protocol_present"
 CHECK ("preparePurpose" <> 'DIRECT_DELETE' OR "protocolVersion" IS NOT NULL);
