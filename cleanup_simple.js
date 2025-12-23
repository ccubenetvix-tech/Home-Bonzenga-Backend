const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
    console.log('Starting simplified database cleanup...');

    const placeholders = ['vendor one', 'vendor two'];

    const { data, error } = await supabase
        .from('vendor')
        .delete()
        .in('shopname', placeholders)
        .select();

    if (error) {
        console.error('Error deleting placeholder vendors:', error);
        process.exit(1);
    }

    console.log(`Successfully deleted ${data?.length || 0} placeholder vendors:`, data);
    process.exit(0);
}

cleanup();
