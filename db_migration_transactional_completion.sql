-- 1. Ensure athome_booking_services has completed_at
ALTER TABLE athome_booking_services 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2. Ensure beauticians has total_services_completed
ALTER TABLE beauticians 
ADD COLUMN IF NOT EXISTS total_services_completed INTEGER DEFAULT 0;

-- Backfill from completed_services_count if exists and total_services_completed is 0
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beauticians' AND column_name = 'completed_services_count') THEN
        UPDATE beauticians 
        SET total_services_completed = completed_services_count 
        WHERE total_services_completed = 0;
    END IF;
END $$;

-- 3. Create Atomic RPC for Service Completion
CREATE OR REPLACE FUNCTION complete_at_home_service_transaction(
  p_booking_id UUID,
  p_customer_id UUID
)
RETURNS JSON
SECURITY DEFINER -- Runs with privileges of creator (schema owner)
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_record RECORD;
BEGIN
  -- 1. Validate Booking & Customer Ownership
  SELECT * INTO v_booking_record
  FROM athome_bookings
  WHERE id = p_booking_id AND customer_id = p_customer_id;

  IF v_booking_record.id IS NULL THEN
     RETURN json_build_object('success', false, 'message', 'Booking not found or access denied');
  END IF;

  IF v_booking_record.status = 'COMPLETED' THEN
     RETURN json_build_object('success', false, 'message', 'Booking already completed');
  END IF;

  -- 2. Update Master Booking Status
  UPDATE athome_bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_booking_id;

  -- 3. Update Services Status (Assumes 'status' is the column, based on existing schema)
  UPDATE athome_booking_services
  SET status = 'COMPLETED', completed_at = NOW()
  WHERE booking_id = p_booking_id;

  -- 4. Increment Beautician Count (Update both columns if they exist to maintain compatibility)
  IF v_booking_record.assigned_beautician_id IS NOT NULL THEN
      UPDATE beauticians
      SET total_services_completed = COALESCE(total_services_completed, 0) + 1
      WHERE id = v_booking_record.assigned_beautician_id;

      -- Try to update old column if it exists, ignore error if not
      BEGIN
        UPDATE beauticians
        SET completed_services_count = COALESCE(completed_services_count, 0) + 1
        WHERE id = v_booking_record.assigned_beautician_id;
      EXCEPTION WHEN OTHERS THEN
        -- Column might not exist, ignore
      END;
  END IF;

  -- 5. Insert Live Update
  INSERT INTO booking_live_updates (booking_id, status, message, updated_by, customer_visible)
  VALUES (p_booking_id, 'COMPLETED', 'Service successfully completed', p_customer_id, true);

  -- 6. Update Payout Status (if exists)
  UPDATE beautician_payouts
  SET status = 'PENDING'
  WHERE booking_id = p_booking_id;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  -- Rollback happens automatically in PL/PGSQL on error
  RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$;
