-- 1. Create vendor_subscriptions table
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    month TEXT NOT NULL, -- Format: YYYY-MM
    subscription_amount DECIMAL(10, 2) DEFAULT 10.00,
    status TEXT CHECK (status IN ('PENDING', 'PAID')) DEFAULT 'PENDING',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_vendor_subscription_month UNIQUE (vendor_id, month)
);

-- 2. Create monthly_sales_summary table
CREATE TABLE IF NOT EXISTS monthly_sales_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')) NOT NULL,
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    total_services INTEGER DEFAULT 0,
    gross_sales DECIMAL(10, 2) DEFAULT 0.00,
    commission_percentage DECIMAL(5, 2) DEFAULT 0.00,
    commission_amount DECIMAL(10, 2) DEFAULT 0.00,
    net_payable DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_monthly_summary UNIQUE (entity_type, entity_id, month)
);

-- 3. Create payout_transactions table
CREATE TABLE IF NOT EXISTS payout_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')) NOT NULL,
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    amount_paid DECIMAL(10, 2) NOT NULL,
    payment_method TEXT,
    reference_id TEXT,
    paid_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_vendor_subscriptions_month ON vendor_subscriptions(month);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_summary_month ON monthly_sales_summary(month);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_month ON payout_transactions(month);

-- Comments for documentation
COMMENT ON TABLE vendor_subscriptions IS 'Tracks the fixed monthly subscription fee ($10) for Salon Vendors.';
COMMENT ON TABLE monthly_sales_summary IS 'Aggregated monthly financial stats for Vendors and Beauticians.';
COMMENT ON TABLE payout_transactions IS 'Record of actual payments made from Admin to Vendors/Beauticians.';
