-- Remove precise timestamp from stock_movements (NF525 compliance)
-- Only keep DATE granularity (moved_on), no time-of-day information
ALTER TABLE stock_movements DROP COLUMN IF EXISTS created_at;

-- Add a comment documenting the intent
COMMENT ON TABLE stock_movements IS 'Inventory daily usage tracking. NOT a sales record. Stores only daily aggregates per variant (one row per variant per day). No transaction-level granularity, no timestamps, no prices.';
