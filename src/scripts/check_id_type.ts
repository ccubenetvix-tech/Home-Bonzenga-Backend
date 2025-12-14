
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ID_TO_CHECK = '50b4dfad-e60f-42ee-9242-5c731460394e';

async function checkId() {
    const output: string[] = [];
    output.push(`Checking ID: ${ID_TO_CHECK}`);

    // Check users table
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, role')
        .eq('id', ID_TO_CHECK)
        .maybeSingle();

    if (user) {
        output.push('✅ FOUND IN USERS TABLE:');
        output.push(JSON.stringify(user, null, 2));
    } else {
        output.push('❌ Not found in users table');
        if (userError) output.push(`Error: ${userError.message}`);
    }

    // Check vendor table
    const { data: vendor, error: vendorError } = await supabase
        .from('vendor')
        .select('id, shopname, user_id')
        .eq('id', ID_TO_CHECK) // Check if it's the VENDOR ID
        .maybeSingle();

    // Also check if it's a USER ID in the vendor table
    const { data: vendorByUserId } = await supabase
        .from('vendor')
        .select('id, shopname, user_id')
        .eq('user_id', ID_TO_CHECK)
        .maybeSingle();

    if (vendor) {
        output.push('✅ FOUND IN VENDOR TABLE (AS ID):');
        output.push(JSON.stringify(vendor, null, 2));
    } else {
        output.push('❌ Not found in vendor table as ID');
    }

    if (vendorByUserId) {
        output.push('✅ FOUND IN VENDOR TABLE (AS USER_ID):');
        output.push(JSON.stringify(vendorByUserId, null, 2));
    }

    fs.writeFileSync('id_check_output.txt', output.join('\n'));
}

checkId();
