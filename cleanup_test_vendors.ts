import { supabase } from './src/lib/supabase';

async function cleanup() {
    console.log('Starting database cleanup...');

    const placeholders = ['vendor one', 'vendor two'];

    const { data, error } = await supabase
        .from('vendor')
        .delete()
        .in('shopname', placeholders)
        .select();

    if (error) {
        console.error('Error deleting placeholder vendors:', error);
        process.exit(1);
    }

    console.log(`Successfully deleted ${data?.length || 0} placeholder vendors:`, data);
    process.exit(0);
}

cleanup();
