-- CRITICAL FIX FOR VENDOR ASSIGNMENT
-- The current Foreign Key references an empty 'vendors' table.
-- We must redirect it to the active 'vendor' table.

BEGIN;

-- 1. Fix Service Assignment FK
ALTER TABLE athome_booking_services
DROP CONSTRAINT IF EXISTS athome_booking_services_assigned_vendor_id_fkey;

ALTER TABLE athome_booking_services
ADD CONSTRAINT athome_booking_services_assigned_vendor_id_fkey
FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);

-- 2. Fix Product Assignment FK
ALTER TABLE athome_booking_products
DROP CONSTRAINT IF EXISTS athome_booking_products_assigned_vendor_id_fkey;

ALTER TABLE athome_booking_products
ADD CONSTRAINT athome_booking_products_assigned_vendor_id_fkey
FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);

COMMIT;
