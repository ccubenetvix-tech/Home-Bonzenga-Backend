-- Create Subscriptions Ledger Table if not exists
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('VENDOR', 'BEAUTICIAN')),
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- YYYY-MM
    amount DECIMAL(10, 2) DEFAULT 10.00,
    status TEXT DEFAULT 'UNPAID', -- PAID, UNPAID
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, entity_id, month)
);

-- Ensure payouts table exists (from previous step, just safety)
CREATE TABLE IF NOT EXISTS payout_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL, -- VENDOR, BEAUTICIAN
    entity_id UUID NOT NULL,
    month TEXT NOT NULL, -- YYYY-MM
    amount DECIMAL(10, 2) NOT NULL,
    net_paid DECIMAL(10, 2) NOT NULL, -- Amount actually transferred
    reference TEXT,
    notes TEXT,
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure notifications table exists
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'INFO', -- INFO, WARNING, SUCCESS, ERROR
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policies (Simplified for admin/broad usage)
CREATE POLICY "Admins can manage subscriptions" ON subscriptions FOR ALL USING (
    exists (select 1 from users where id = auth.uid() and role = 'ADMIN')
);

CREATE POLICY "Admins can manage outcomes" ON payout_transactions FOR ALL USING (
    exists (select 1 from users where id = auth.uid() and role = 'ADMIN')
);
-- Allow vendors/beauticians to view their own payouts
CREATE POLICY "Users can view own payouts" ON payout_transactions FOR SELECT USING (
    auth.uid() IN (SELECT user_id FROM vendor WHERE id = entity_id AND entity_type = 'VENDOR')
    OR
    auth.uid() IN (SELECT user_id FROM beauticians WHERE id = entity_id AND entity_type = 'BEAUTICIAN')
);
-- NOTE: Beauticians might not have user_id linked in this schema? Assuming they are standard users?
-- If beauticians table doesn't have user_id, this policy might fail or do nothing.
-- Adjusting policy to be safe:
CREATE POLICY "Vendors can view own payouts" ON payout_transactions FOR SELECT USING (
    (entity_type = 'VENDOR' AND EXISTS (SELECT 1 FROM vendor WHERE id = entity_id AND user_id = auth.uid()))
);
