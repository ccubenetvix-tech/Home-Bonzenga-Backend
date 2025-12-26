
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking athome_bookings table structure...');
    const { data, error } = await supabase
        .from('athome_bookings')
        .select('*')
        .limit(1);

    if (error) {
        fs.writeFileSync('schema_debug_athome.txt', 'Error: ' + JSON.stringify(error));
    } else {
        if (data && data.length > 0) {
            fs.writeFileSync('schema_debug_athome.txt', 'Columns: ' + JSON.stringify(Object.keys(data[0])));
        } else {
            fs.writeFileSync('schema_debug_athome.txt', 'No data found in athome_bookings table (columns unknown).');
        }
    }
}

checkSchema();
