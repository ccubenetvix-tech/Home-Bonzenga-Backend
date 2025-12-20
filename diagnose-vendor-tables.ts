
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables for Supabase.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log('Diagnosing Vendor Tables...');

    // 1. Check 'vendor' table
    const { count: vendorCount, error: vendorError } = await supabase
        .from('vendor')
        .select('*', { count: 'exact', head: true });

    if (vendorError) console.log(`Error accessing 'vendor': ${vendorError.message}`);
    else console.log(`Table 'vendor' count: ${vendorCount}`);

    // 2. Check 'vendors' table
    const { count: vendorsCount, error: vendorsError } = await supabase
        .from('vendors')
        .select('*', { count: 'exact', head: true });

    if (vendorsError) console.log(`Error accessing 'vendors': ${vendorsError.message}`);
    else console.log(`Table 'vendors' count: ${vendorsCount}`);

    // 3. Check specific ID existing in both
    // ID from error: 11a9931e-f692-4a2b-8375-c77a3e6cef7c
    const targetId = '11a9931e-f692-4a2b-8375-c77a3e6cef7c';
    if (targetId) {
        const { data: v1 } = await supabase.from('vendor').select('id').eq('id', targetId);
        console.log(`ID ${targetId} in 'vendor': ${v1?.length ? 'YES' : 'NO'}`);

        const { data: v2 } = await supabase.from('vendors').select('id').eq('id', targetId);
        console.log(`ID ${targetId} in 'vendors': ${v2?.length ? 'YES' : 'NO'}`);
    }
}

diagnose();
