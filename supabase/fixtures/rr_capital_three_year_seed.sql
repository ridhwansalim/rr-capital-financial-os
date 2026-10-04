-- RR Capital synthetic evaluation data fixture.
-- The currently loaded 40-month fixture was applied as a guarded one-time
-- transaction on 2026-10-04. See docs/current-sample-data.md for the live
-- row counts and exact generated ID ranges. This file is intentionally a
-- safety stub: do not replay older fixture SQL against the populated owner.
-- The matching cleanup file removes only the fixed a7300000-... ID ranges.
-- Rebuild a fresh test owner/database before preparing a future reseed.
DO $$
BEGIN
  RAISE EXCEPTION 'RR Capital evaluation data is already loaded. See docs/current-sample-data.md; do not replay historical seed SQL.';
END $$;
