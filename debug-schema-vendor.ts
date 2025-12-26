
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking vendor table structure...');
    const { data, error } = await supabase
        .from('vendor')
        .select('*')
        .limit(1);

    if (error) {
        fs.writeFileSync('schema_debug_vendor.txt', 'Error: ' + JSON.stringify(error));
    } else {
        if (data && data.length > 0) {
            fs.writeFileSync('schema_debug_vendor.txt', 'Columns: ' + JSON.stringify(Object.keys(data[0])));
        } else {
            // Try just inserting a dummy or reading error message to infer?
            // Actually, we can check for specific columns by selecting them and seeing if error occurs
            fs.writeFileSync('schema_debug_vendor.txt', 'No data found in vendor table.');
        }
    }

    console.log('Checking payout_transactions table...');
    const { data: ptData, error: ptError } = await supabase
        .from('payout_transactions')
        .select('*')
        .limit(1);

    if (ptError) {
        fs.appendFileSync('schema_debug_vendor.txt', '\nError Payouts: ' + JSON.stringify(ptError));
    } else {
        fs.appendFileSync('schema_debug_vendor.txt', '\nPayouts Table Exists.');
    }
}

checkSchema();
