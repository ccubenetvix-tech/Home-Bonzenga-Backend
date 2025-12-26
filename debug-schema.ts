
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking bookings table structure...');
    const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .limit(1);

    if (error) {
        fs.writeFileSync('schema_debug.txt', 'Error: ' + JSON.stringify(error));
    } else {
        if (data && data.length > 0) {
            fs.writeFileSync('schema_debug.txt', 'Columns: ' + JSON.stringify(Object.keys(data[0])));
        } else {
            fs.writeFileSync('schema_debug.txt', 'No data found in bookings table.');
        }
    }
}

checkSchema();
