import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/authorizeAdmin';

const router = Router();

router.get('/at-salon-services', authenticate, authorizeAdmin, async (req: any, res: any) => {
    try {
        console.log('📋 Fetching all at-salon services for admin (dedicated route)...');
        const { data, error } = await supabase
            .from('vendor_orders')
            .select(`
        id,
        vendor_id,
        vendor:vendor(shopname),
        customer_name,
        customer_email,
        services,
        total_amount,
        appointment_date,
        appointment_time,
        booking_status,
        payment_status,
        created_at
      `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedOrders = (data || []).map((order: any) => ({
            id: order.id,
            vendorName: order.vendor?.shopname || 'Unknown Salon',
            customerName: order.customer_name,
            customerEmail: order.customer_email,
            appointmentDate: order.appointment_date,
            appointmentTime: order.appointment_time,
            services: order.services || [],
            totalAmount: order.total_amount,
            paymentStatus: order.payment_status,
            bookingStatus: order.booking_status,
            createdAt: order.created_at
        }));

        res.json({
            success: true,
            orders: formattedOrders,
            count: formattedOrders.length
        });
    } catch (err: any) {
        console.error('Error in adminAtSalonServices:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to fetch at-salon services',
            orders: [],
            count: 0
        });
    }
});

export default router;
