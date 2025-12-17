
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    try {
        console.log('🔍 Fetching one service to check columns...');
        const { data: services, error } = await supabase
            .from('vendor_services')
            .select('*')
            .limit(1);

        if (error) {
            console.error('❌ Error:', error);
        } else if (services && services.length > 0) {
            console.log('✅ Service Keys:', Object.keys(services[0]));
            console.log('Sample:', services[0]);
        } else {
            console.log('⚠️ No services found.');
        }

    } catch (error) {
        console.error('Unexpected error:', error);
    }
}

verify();
