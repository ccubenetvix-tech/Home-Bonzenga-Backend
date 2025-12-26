-- Create platform_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure singleton row
    platform_name TEXT DEFAULT 'Home Bonzenga',
    platform_description TEXT DEFAULT 'Premium Beauty Services Platform',
    support_email TEXT DEFAULT 'support@homebonzenga.com',
    support_phone TEXT DEFAULT '+243 123 456 789',
    platform_address TEXT DEFAULT 'Kinshasa, DR Congo',
    timezone TEXT DEFAULT 'Africa/Kinshasa',
    
    -- System Settings
    maintenance_mode BOOLEAN DEFAULT FALSE,
    debug_mode BOOLEAN DEFAULT FALSE,
    auto_backup BOOLEAN DEFAULT TRUE,
    backup_frequency TEXT DEFAULT 'daily',

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Insert default row if missing
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Grant access (if using Supabase client directly, but we use backend API so this is optional but good practice)
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read of basic settings" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "Allow admin update" ON platform_settings FOR UPDATE USING (
  exists (select 1 from users where id = auth.uid() and role = 'ADMIN')
);
