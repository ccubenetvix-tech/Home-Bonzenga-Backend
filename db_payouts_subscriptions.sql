-- ==========================================
-- 1. SETUP PAYOUT TRANSACTIONS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payout_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL, -- Vendor ID or Beautician ID
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    net_paid DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    month VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'COMPLETED', -- 'COMPLETED', 'PENDING'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID -- Admin User ID
);

-- ==========================================
-- 2. ADD SUBSCRIPTION & FINANCIAL COLUMNS TO VENDOR TABLE
-- ==========================================
-- 20-day cycle, $10 fee
DO $$ BEGIN
    -- Subscription Status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendor' AND column_name = 'subscription_status') THEN
        ALTER TABLE public.vendor ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'ACTIVE'; -- 'ACTIVE', 'OVERDUE', 'INACTIVE'
    END IF;

    -- Last Payment Date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendor' AND column_name = 'last_subscription_payment') THEN
        ALTER TABLE public.vendor ADD COLUMN last_subscription_payment TIMESTAMPTZ;
    END IF;

    -- Next Due Date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendor' AND column_name = 'subscription_due_date') THEN
        ALTER TABLE public.vendor ADD COLUMN subscription_due_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '20 days');
    END IF;
END $$;

-- ==========================================
-- 3. NOTIFICATIONS TABLE (For Dashboard alerts)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- Recipient (Vendor/Beautician User ID)
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'INFO', -- 'PAYOUT', 'SYSTEM', 'BOOKING'
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
