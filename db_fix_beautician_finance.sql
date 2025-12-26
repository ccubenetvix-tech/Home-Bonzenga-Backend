-- ==========================================
-- FIX BEAUTICIAN FINANCE DATA (AT-HOME)
-- ==========================================

-- 1. Ensure 'payment_status' column exists on 'athome_bookings'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athome_bookings' AND column_name = 'payment_status') THEN
        ALTER TABLE public.athome_bookings ADD COLUMN payment_status VARCHAR(50) DEFAULT 'PENDING';
    END IF;
END $$;

-- 2. Backfill: Mark bookings as 'SUCCESS' if they have a successful payment
-- This links 'payments.booking_id' -> 'athome_bookings.id'
UPDATE public.athome_bookings
SET payment_status = 'SUCCESS'
FROM public.payments
WHERE public.athome_bookings.id = public.payments.booking_id
  AND public.payments.status IN ('COMPLETED', 'SUCCESS', 'PAID');

-- 3. Backfill: Mark all COMPLETED bookings as 'SUCCESS' (Fallback for cash payments or missing payment records)
UPDATE public.athome_bookings
SET payment_status = 'SUCCESS'
WHERE status = 'COMPLETED' 
  AND (payment_status IS NULL OR payment_status != 'SUCCESS');

-- 4. Create Trigger to ensure Future Payments update the booking status instantly
CREATE OR REPLACE FUNCTION public.fn_sync_athome_payment_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If payment is successful, mark the linked at-home booking as SUCCESS
  IF NEW.status IN ('COMPLETED', 'SUCCESS', 'PAID') THEN
    UPDATE public.athome_bookings
    SET payment_status = 'SUCCESS'
    WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if exists to avoid conflicts
DROP TRIGGER IF EXISTS trg_sync_payment_to_athome_booking ON public.payments;

-- Attach trigger
CREATE TRIGGER trg_sync_payment_to_athome_booking
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_athome_payment_status();
