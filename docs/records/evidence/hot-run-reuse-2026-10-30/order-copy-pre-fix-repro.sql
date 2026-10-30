\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE review_images (id integer PRIMARY KEY, artwork_id integer, sort_order integer);
CREATE TEMP TABLE review_pages (pair_id text, ordinal integer, left_image_id integer, right_image_id integer, PRIMARY KEY(pair_id,ordinal));
INSERT INTO review_images SELECT n,1,n FROM generate_series(1,1001) n;
INSERT INTO review_images SELECT n+2000,2,n FROM generate_series(1,1001) n;
INSERT INTO review_pages SELECT 'old',n,n,n+2000 FROM generate_series(1,1001) n;
WITH page AS MATERIALIZED (SELECT * FROM review_pages WHERE pair_id='old' AND (pair_id,ordinal)>('',0) ORDER BY pair_id,ordinal LIMIT 1000),
positions AS MATERIALIZED (SELECT id,(row_number() OVER(PARTITION BY artwork_id ORDER BY sort_order,id)-1)::integer idx FROM review_images),
projected AS MATERIALIZED (SELECT p.pair_id,p.ordinal,l.idx li,r.idx ri,
 row_number() OVER(PARTITION BY p.pair_id ORDER BY l.idx NULLS LAST,r.idx NULLS LAST,p.ordinal)::integer next_ordinal
 FROM review_pages p LEFT JOIN positions l ON l.id=p.left_image_id LEFT JOIN positions r ON r.id=p.right_image_id WHERE p.pair_id IN (SELECT DISTINCT pair_id FROM page)),
copied AS (INSERT INTO review_pages SELECT 'new',projected.next_ordinal,p.left_image_id,p.right_image_id FROM page p JOIN projected ON projected.pair_id=p.pair_id AND projected.ordinal=p.ordinal ON CONFLICT DO NOTHING RETURNING ordinal)
SELECT 'first_copy' AS phase,count(*) AS copied FROM copied;
UPDATE review_images SET sort_order=-sort_order;
WITH page AS MATERIALIZED (SELECT * FROM review_pages WHERE pair_id='old' AND (pair_id,ordinal)>('old',1000) ORDER BY pair_id,ordinal LIMIT 1000),
positions AS MATERIALIZED (SELECT id,(row_number() OVER(PARTITION BY artwork_id ORDER BY sort_order,id)-1)::integer idx FROM review_images),
projected AS MATERIALIZED (SELECT p.pair_id,p.ordinal,l.idx li,r.idx ri,
 row_number() OVER(PARTITION BY p.pair_id ORDER BY l.idx NULLS LAST,r.idx NULLS LAST,p.ordinal)::integer next_ordinal
 FROM review_pages p LEFT JOIN positions l ON l.id=p.left_image_id LEFT JOIN positions r ON r.id=p.right_image_id WHERE p.pair_id IN (SELECT DISTINCT pair_id FROM page)),
copied AS (INSERT INTO review_pages SELECT 'new',projected.next_ordinal,p.left_image_id,p.right_image_id FROM page p JOIN projected ON projected.pair_id=p.pair_id AND projected.ordinal=p.ordinal ON CONFLICT DO NOTHING RETURNING ordinal)
SELECT 'after_order_change' AS phase,(SELECT count(*) FROM page) AS source_page_rows,count(*) AS copied FROM copied;
SELECT pair_id,count(*) AS evidence_rows FROM review_pages GROUP BY pair_id ORDER BY pair_id;
ROLLBACK;
