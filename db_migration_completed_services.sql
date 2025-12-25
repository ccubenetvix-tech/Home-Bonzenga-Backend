-- Migration: Add completed_services_count to beauticians table
-- Run this in your Supabase SQL Editor

-- 1. Add the column
ALTER TABLE beauticians 
ADD COLUMN IF NOT EXISTS completed_services_count INTEGER DEFAULT 0;

-- 2. Optional: Backfill counts for any existing completed bookings
-- This ensures the count is accurate if you have historical data
WITH completed_counts AS (
    SELECT assigned_beautician_id, COUNT(*) as cnt
    FROM athome_bookings
    WHERE status = 'COMPLETED' AND assigned_beautician_id IS NOT NULL
    GROUP BY assigned_beautician_id
)
UPDATE beauticians
SET completed_services_count = completed_counts.cnt
FROM completed_counts
WHERE beauticians.id = completed_counts.assigned_beautician_id;

-- 3. Verify
SELECT id, name, completed_services_count FROM beauticians;
