-- 1. FIX: Add missing customer_visible column
ALTER TABLE booking_live_updates 
ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN DEFAULT TRUE;

-- 2. Ensure other required columns exist
ALTER TABLE athome_booking_services 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE beauticians 
ADD COLUMN IF NOT EXISTS total_services_completed INTEGER DEFAULT 0;

-- 3. Re-create the RPC (No changes needed to logic, just re-run to be safe)
CREATE OR REPLACE FUNCTION complete_at_home_service_transaction(
  p_booking_id UUID,
  p_customer_id UUID
)
RETURNS JSON
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_record RECORD;
  v_beautician_id UUID;
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

  v_beautician_id := v_booking_record.assigned_beautician_id;

  -- 2. Update Master Booking Status
  UPDATE athome_bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_booking_id;

  -- 3. Update Services Status
  UPDATE athome_booking_services
  SET status = 'COMPLETED', completed_at = NOW()
  WHERE booking_id = p_booking_id;

  -- 4. Increment Beautician Count (Atomic)
  IF v_beautician_id IS NOT NULL THEN
      UPDATE beauticians
      SET total_services_completed = COALESCE(total_services_completed, 0) + 1
      WHERE id = v_beautician_id;

      -- Update legacy column if exists
      BEGIN
        UPDATE beauticians
        SET completed_services_count = COALESCE(completed_services_count, 0) + 1
        WHERE id = v_beautician_id;
      EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 5. Insert Live Update (NOW SAFE due to ALTER TABLE above)
  INSERT INTO booking_live_updates (booking_id, status, message, updated_by, customer_visible)
  VALUES (p_booking_id, 'COMPLETED', 'Service successfully completed', p_customer_id, true);

  -- 6. Update Payout Status (Safe block)
  BEGIN
    UPDATE beautician_payouts
    SET status = 'PENDING'
    WHERE booking_id = p_booking_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'message', 'Database Error: ' || SQLERRM);
END;
$$;
