
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    const { data, error } = await supabase
        .from('beauticians')
        .select('*')
        .limit(1);

    if (error) {
        fs.writeFileSync('schema_debug_beautician.txt', 'Error: ' + JSON.stringify(error));
    } else {
        fs.writeFileSync('schema_debug_beautician.txt', 'Columns: ' + JSON.stringify(Object.keys(data?.[0] || {})));
    }
}

checkSchema();
