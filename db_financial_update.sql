-- ============================================================================
-- 1. Create system_credentials table (Manager System Role)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(20) UNIQUE NOT NULL, -- Ensures only one 'MANAGER' row
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT now()
);

COMMENT ON TABLE public.system_credentials IS 'Stores system role credentials (e.g., MANAGER) separate from users table.';

-- Seed specific system roles if not exist (Admin sets the password later)
-- We insert a placeholder so the row exists. Admin can update it via Dashboard.
INSERT INTO public.system_credentials (role, email, password_hash, is_active)
VALUES ('MANAGER', 'manager@homebonzenga.com', 'PENDING_RESET_VIA_ADMIN', TRUE)
ON CONFLICT (role) DO NOTHING;


-- ============================================================================
-- 2. Create Financial Tables (For Admin Finance Dashboard)
-- ============================================================================

-- Monthly Earnings Summary (Aggregated data for fast loading)
CREATE TABLE IF NOT EXISTS public.monthly_earnings_summary (
    entity_type TEXT NOT NULL, -- 'VENDOR' or 'BEAUTICIAN'
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- Format: 'YYYY-MM'
    total_services INTEGER DEFAULT 0,
    gross_amount NUMERIC(15,2) DEFAULT 0,
    commission_amount NUMERIC(15,2) DEFAULT 0,
    net_payable NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, month)
);

-- Subscriptions (Monthly platform fees)
CREATE TABLE IF NOT EXISTS public.subscriptions (
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    month TEXT NOT NULL,
    amount NUMERIC(10,2) DEFAULT 10.00,
    status TEXT DEFAULT 'UNPAID', -- 'PAID', 'UNPAID'
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, month)
);

-- Payout Transactions (Record of payments made to providers)
CREATE TABLE IF NOT EXISTS public.payout_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    month TEXT NOT NULL,
    gross_amount NUMERIC(15,2) DEFAULT 0,
    commission_amount NUMERIC(15,2) DEFAULT 0,
    net_paid NUMERIC(15,2) DEFAULT 0,
    reference_id TEXT,
    created_by UUID, -- Admin User ID
    created_at TIMESTAMP DEFAULT now()
);

-- Entity Status (For freezing accounts financially)
CREATE TABLE IF NOT EXISTS public.entity_status (
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    frozen_reason TEXT,
    updated_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id)
);

-- ============================================================================
-- 3. Cleanup Legacy Manager Data (Optional but recommended)
-- ============================================================================
-- Remove 'MANAGER' role users from standard users table to strictly enforce system role
-- WARNING: Only run this if you are sure all legacy managers are migrated or obsolete.
-- DELETE FROM auth.users WHERE raw_user_meta_data->>'role' = 'MANAGER';
-- DELETE FROM public.users WHERE role = 'MANAGER';
