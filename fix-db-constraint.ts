
import { Client } from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function runFix() {
    console.log('Starting DB Constraint Fix...');

    if (dbUrl) {
        console.log('Found DATABASE_URL, attempting direct connection...');
        const client = new Client({
            connectionString: dbUrl,
            ssl: { rejectUnauthorized: false } // Required for Supabase in many envs
        });

        try {
            await client.connect();
            console.log('Connected to Postgres.');

            const sql = `
                BEGIN;
                -- Fix Service FK
                ALTER TABLE athome_booking_services DROP CONSTRAINT IF EXISTS athome_booking_services_assigned_vendor_id_fkey;
                ALTER TABLE athome_booking_services ADD CONSTRAINT athome_booking_services_assigned_vendor_id_fkey FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);
                
                -- Fix Product FK
                ALTER TABLE athome_booking_products DROP CONSTRAINT IF EXISTS athome_booking_products_assigned_vendor_id_fkey;
                ALTER TABLE athome_booking_products ADD CONSTRAINT athome_booking_products_assigned_vendor_id_fkey FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);
                COMMIT;
            `;

            await client.query(sql);
            console.log('SUCCESS: Foreign Key constraints updated via Node-PG.');
            await client.end();
            process.exit(0);
        } catch (err: any) {
            console.error('PG Client Error:', err.message);
            // Fallback to next method
        }
    } else {
        console.log('DATABASE_URL not found in environment.');
    }

    if (supabaseUrl && supabaseKey) {
        console.log('Attempting Supabase RPC (exec_sql)...');
        const supabase = createClient(supabaseUrl, supabaseKey);

        const sql = `
            BEGIN;
            ALTER TABLE athome_booking_services DROP CONSTRAINT IF EXISTS athome_booking_services_assigned_vendor_id_fkey;
            ALTER TABLE athome_booking_services ADD CONSTRAINT athome_booking_services_assigned_vendor_id_fkey FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);
            ALTER TABLE athome_booking_products DROP CONSTRAINT IF EXISTS athome_booking_products_assigned_vendor_id_fkey;
            ALTER TABLE athome_booking_products ADD CONSTRAINT athome_booking_products_assigned_vendor_id_fkey FOREIGN KEY (assigned_vendor_id) REFERENCES vendor(id);
            COMMIT;
        `;

        const { error } = await supabase.rpc('exec_sql', { query: sql });
        if (error) {
            // Try a common variation or just raw query if feasible (not feasible via std client)
            console.error('Supabase RPC Error (might not exist):', error.message);
        } else {
            console.log('SUCCESS: Executed via RPC.');
            process.exit(0);
        }
    }

    console.log('\n❌ COULD NOT AUTOMATE FIX.');
    console.log('Please run the "fix_schema.sql" file manually in your Supabase SQL Editor.');
}

runFix();
