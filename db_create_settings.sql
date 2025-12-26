-- Create platform_settings table for dynamic configuration
CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure singleton
    platform_name TEXT DEFAULT 'Home Bonzenga',
    platform_description TEXT DEFAULT 'Premium Beauty Services Platform',
    support_email TEXT DEFAULT 'support@homebonzenga.com',
    support_phone TEXT DEFAULT '+243 123 456 789',
    platform_address TEXT DEFAULT 'Kinshasa, DR Congo',
    timezone TEXT DEFAULT 'Africa/Kinshasa',
    
    -- System flags
    maintenance_mode BOOLEAN DEFAULT FALSE,
    debug_mode BOOLEAN DEFAULT FALSE,
    auto_backup BOOLEAN DEFAULT TRUE,
    backup_frequency TEXT DEFAULT 'daily',
    
    -- Business settings (optional/unused but good to have schema for)
    commission_rate DECIMAL(5,2) DEFAULT 15.00,
    min_payout DECIMAL(10,2) DEFAULT 50.00,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) -- Optional tracking
);

-- Separate Row Level Security not strictly needed if accessed via service role in backend, 
-- but good practice to enable it and allow public read (if we were using frontend supabase client).
-- Since we use backend API, we handle auth there.

-- Insert default row if not exists
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
