
-- FINAL FIX FOR VENDOR ASSIGNMENT CONSTRAINTS
-- This script ensures ALL potentially conflicting constraints are removed
-- and the correct constraint pointing to 'vendor' (singular) is created.

BEGIN;

-- 1. Remove ANY overlapping constraints on athome_booking_services
ALTER TABLE athome_booking_services 
DROP CONSTRAINT IF EXISTS athome_booking_services_assigned_vendor_id_fkey;

ALTER TABLE athome_booking_services 
DROP CONSTRAINT IF EXISTS athome_booking_services_service_vendor_id_fkey; -- Removing the old named constraint if it exists

-- 2. Create the CORRECT constraint pointing to 'vendor' (singular)
ALTER TABLE athome_booking_services 
ADD CONSTRAINT athome_booking_services_assigned_vendor_id_fkey 
FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);

COMMIT;
