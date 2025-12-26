-- ============================================================================
-- 1. ROBUST COLUMN CHECK (payment_status)
-- ============================================================================
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'payment_status') THEN 
    ALTER TABLE public.bookings ADD COLUMN payment_status VARCHAR(50) DEFAULT 'PENDING'; 
  END IF; 
END $$;

-- ============================================================================
-- 2. CREATE POSTGRES TRIGGER (The "Live" Update Mechanism)
-- ============================================================================
-- This ensures that whenever a Payment is successful, the Booking is INSTANTLY marked as SUCCESS financially.

CREATE OR REPLACE FUNCTION public.fn_sync_booking_payment_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If payment is COMPLETED or SUCCESS, mark booking as SUCCESS
  IF NEW.status IN ('COMPLETED', 'SUCCESS', 'PAID') THEN
    UPDATE public.bookings
    SET payment_status = 'SUCCESS'
    WHERE id = NEW.booking_id; -- Uses snake_case for join column
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to avoid duplication errors
DROP TRIGGER IF EXISTS trg_sync_payment_to_booking ON public.payments;

-- Create Trigger
CREATE TRIGGER trg_sync_payment_to_booking
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_booking_payment_status();

-- ============================================================================
-- 3. BACKFILL HISTORICAL DATA
-- ============================================================================
-- Map existing 'COMPLETED' payments to 'SUCCESS' in bookings
UPDATE public.bookings
SET payment_status = 'SUCCESS'
FROM public.payments
WHERE public.bookings.id = payments.booking_id
  AND payments.status IN ('COMPLETED', 'SUCCESS', 'PAID');

-- Fallback for legacy booking data (if booking is COMPLETED and no payment info pending)
UPDATE public.bookings
SET payment_status = 'SUCCESS'
WHERE status = 'COMPLETED' 
  AND (payment_status IS NULL OR payment_status = 'PENDING');

-- ============================================================================
-- 4. INDEXES (Vital for Admin Dashboard Performance)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON public.bookings(payment_status);
-- REMOVED problematic scheduledDate index to avoid error block. 
-- The payment_status index is the critical one for finance speed.
