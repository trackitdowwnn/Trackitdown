-- =============================================================================
-- WHAT:  Bound posts.plate length with a column CHECK (<= 15 chars, or NULL).
-- WHY:   Closes the LOW residual from the plate-canon fix review: create_post
--        stores the RAW trimmed plate (upper(trim(p_plate))) as the display
--        value, and only its ALPHANUMERIC canon is gated to 2–8 chars. So an
--        input like 'AB' + 200 hyphens canons to 'AB' (passes the format gate)
--        yet is stored verbatim as a 200-char junk string that PlateChip would
--        render. posts.plate had NO length CHECK (see payments_foundation), so
--        the raw value was unbounded. A column CHECK is the right home for this:
--        it bounds EVERY write path (create_post, the owner's draft-edit UPDATE
--        grant, any future writer) in one place — not just one function.
--        15 is comfortably above any real UK plate incl. spacing (canon ≤ 8),
--        while rejecting padded junk. Not a security issue (uniqueness stays
--        canon-matched); this is data integrity + making the "bounded" claim true.
-- LINKS: supabase/migrations/20260713195000_create_post_plate_canon_fix.sql
--          (the canon fix this completes); supabase/migrations/
--          20260707110712_payments_foundation.sql (plate column, previously
--          unbounded). Found in security review.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Adds one CHECK constraint. All
--        existing plates are real (≤ ~8 chars), so the constraint validates
--        against current data without change. No drop/rename/data change.
-- =============================================================================

alter table public.posts
  add constraint posts_plate_len_chk
  check (plate is null or char_length(plate) <= 15);
