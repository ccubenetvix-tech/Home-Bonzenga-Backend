import express from 'express';
import { supabase } from '../lib/supabase';

const router = express.Router();

// GET /api/config
// Public endpoint for frontend customization (Nav, Footer, Meta)
// No middleware protection needed as this is public info
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('platform_name, platform_description, support_email, support_phone, platform_address')
            .eq('id', 1)
            .single();

        if (error) {
            // Return defaults if table/row missing
            return res.json({
                success: true,
                config: {
                    platformName: 'Home Bonzenga',
                    platformDescription: 'Premium Beauty Services',
                    supportEmail: 'support@homebonzenga.com',
                    supportPhone: '+243 123 456 789',
                    platformAddress: 'Kinshasa, DR Congo'
                }
            });
        }

        res.json({
            success: true,
            config: {
                platformName: data.platform_name,
                platformDescription: data.platform_description,
                supportEmail: data.support_email,
                supportPhone: data.support_phone,
                platformAddress: data.platform_address
            }
        });

    } catch (error: any) {
        console.error('Error fetching public config:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

export default router;
