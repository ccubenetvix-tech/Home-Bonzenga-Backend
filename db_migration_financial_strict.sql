-- STRICT FINANCIAL MODULE MIGRATION --

-- 1. DROP EXISTING TABLES IF ANY (Resetting to ensure strict compliance)
DROP TABLE IF EXISTS vendor_subscriptions CASCADE;
DROP TABLE IF EXISTS monthly_sales_summary CASCADE;
DROP TABLE IF EXISTS payout_transactions CASCADE;

-- 2. CREATE subscriptions TABLE
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    amount DECIMAL(10, 2) DEFAULT 10.00,
    status TEXT NOT NULL CHECK (status IN ('PAID', 'UNPAID')) DEFAULT 'UNPAID',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_subscription_entry UNIQUE (entity_type, entity_id, month)
);

-- 3. CREATE entity_status TABLE
CREATE TABLE IF NOT EXISTS entity_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    entity_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    frozen_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_entity_status UNIQUE (entity_type, entity_id)
);

-- 4. CREATE monthly_earnings_summary TABLE
CREATE TABLE IF NOT EXISTS monthly_earnings_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    total_services INTEGER DEFAULT 0,
    gross_amount DECIMAL(10, 2) DEFAULT 0.00,
    commission_percentage DECIMAL(5, 2) DEFAULT 15.00,
    commission_amount DECIMAL(10, 2) GENERATED ALWAYS AS (gross_amount * 0.15) STORED,
    net_payable DECIMAL(10, 2) GENERATED ALWAYS AS (gross_amount * 0.85) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_monthly_summary UNIQUE (entity_type, entity_id, month)
);

-- 5. CREATE payout_transactions TABLE
CREATE TABLE IF NOT EXISTS payout_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    gross_amount DECIMAL(10, 2) NOT NULL,
    commission_amount DECIMAL(10, 2) NOT NULL,
    net_paid DECIMAL(10, 2) NOT NULL,
    payment_method TEXT DEFAULT 'MANUAL',
    reference_id TEXT,
    paid_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID, -- Can track Admin ID if available
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. INDEXES
CREATE INDEX IF NOT EXISTS idx_subscriptions_month ON subscriptions(month);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_entity_status_active ON entity_status(is_active);
CREATE INDEX IF NOT EXISTS idx_monthly_earnings_month ON monthly_earnings_summary(month);
CREATE INDEX IF NOT EXISTS idx_payouts_month ON payout_transactions(month);

-- 7. SEED entity_status FOR EXISTING VENDORS
INSERT INTO entity_status (entity_type, entity_id, is_active)
SELECT 'VENDOR', id, true FROM vendor
ON CONFLICT (entity_type, entity_id) DO NOTHING;

-- 8. SEED entity_status FOR EXISTING BEAUTICIANS
INSERT INTO entity_status (entity_type, entity_id, is_active)
SELECT 'BEAUTICIAN', id, true FROM beauticians
ON CONFLICT (entity_type, entity_id) DO NOTHING;

-- 9. NOTIFY
NOTIFY pgrst, 'reload config';
