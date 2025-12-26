-- ============================================================================
-- 1. ADD payment_status to bookings (At-Home Source)
-- ============================================================================
-- Ensure the column exists
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'payment_status') THEN 
    ALTER TABLE public.bookings ADD COLUMN payment_status VARCHAR(50) DEFAULT 'PENDING'; 
  END IF; 
END $$;

-- ============================================================================
-- 2. BACKFILL payment_status from payments table
-- ============================================================================
-- Update bookings to 'PAID' if a successful payment exists
-- CORRECTION: Using 'booking_id' instead of 'bookingId' based on schema error
UPDATE public.bookings
SET payment_status = 'PAID'
FROM public.payments
WHERE public.bookings.id = payments.booking_id
  AND payments.status = 'COMPLETED';

-- Safety fallback: If status is COMPLETED, assume user paid (legacy data)
UPDATE public.bookings
SET payment_status = 'PAID'
WHERE status = 'COMPLETED' 
  AND payment_status = 'PENDING';

-- ============================================================================
-- 3. ENSURE indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON public.bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_vendor_orders_status ON public.vendor_orders(booking_status);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
