
import { supabase } from '../lib/supabase';

async function probe() {
    console.log('Probing schema...');

    // Check 'athome_booking_products' table
    const { data: bookingProducts, error: error3 } = await supabase
        .from('athome_booking_products')
        .select('*')
        .limit(1);

    console.log('Table "athome_booking_products":', error3 ? error3.message : 'Exists', bookingProducts ? bookingProducts.length : 0);

    if (error3) {
        console.error('Error details:', error3);
    } else if (bookingProducts && bookingProducts.length > 0) {
        console.log('Sample row columns:', Object.keys(bookingProducts[0]));
    } else {
        // Try to insert a dummy row to test columns if empty, but that might be messy.
        // Instead, we just report it exists.
        console.log('Table exists but is empty.');
    }

}

probe();
