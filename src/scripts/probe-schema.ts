
import { supabase } from '../lib/supabase';

async function probe() {
    console.log('Probing schema...');

    // Check 'services' table
    const { data: services, error: error1 } = await supabase
        .from('services')
        .select('*')
        .limit(1);

    console.log('Table "services":', error1 ? error1.message : 'Exists', services ? services.length : 0);

    // Check 'vendor_services' table
    const { data: vServices, error: error2 } = await supabase
        .from('vendor_services')
        .select('*')
        .limit(1);

    console.log('Table "vendor_services":', error2 ? error2.message : 'Exists', vServices ? vServices.length : 0);

    if (!error2 && vServices && vServices.length > 0) {
        console.log('Sample vendor_services row:', vServices[0]);
    } else if (!error2) {
        console.log('vendor_services exists but is empty. Trying to insert dummy to check columns is risky.');
    }

}

probe();
