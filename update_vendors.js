const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateVendors() {
    console.log('Updating placeholder vendors with real names...');

    const updates = [
        { oldName: 'vendor one', newName: 'Sleek Style' },
        { oldName: 'vendor two', newName: 'Pure Bliss' }
    ];

    for (const update of updates) {
        const { data, error } = await supabase
            .from('vendor')
            .update({ shopname: update.newName, description: `Welcome to ${update.newName}! We offer premium beauty services.` })
            .eq('shopname', update.oldName)
            .select();

        if (error) {
            console.error(`Error updating ${update.oldName}:`, error);
        } else {
            console.log(`Successfully updated ${update.oldName} to ${update.newName}. Rows affected: ${data?.length}`);
        }
    }

    process.exit(0);
}

updateVendors();
