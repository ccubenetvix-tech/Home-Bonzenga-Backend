
import { Router } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

// POST /api/at-salon-booking
router.post('/', async (req, res) => {
    console.log('Received POST /api/at-salon-booking');

    try {
        // 1. Read Payload (Frontend sends nested objects)
        const { vendorId, customer, appointment, services, totalAmount, paymentMethod } = req.body;

        console.log('Payload:', JSON.stringify(req.body, null, 2));

        // 2. Basic Validation
        if (!vendorId) return res.status(400).json({ error: 'vendorId is missing' });
        if (!customer?.name || !customer?.phone) return res.status(400).json({ error: 'customer info missing' });
        if (!appointment?.date || !appointment?.time) return res.status(400).json({ error: 'appointment info missing' });
        if (!services || !Array.isArray(services) || services.length === 0) return res.status(400).json({ error: 'services missing' });
        if (totalAmount === undefined) return res.status(400).json({ error: 'totalAmount missing' });

        // 3. Generate Mock Data
        const transactionId = `MOCK_TXN_${Date.now()}`;
        const paymentStatus = 'PAID';

        // 4. Construct DB Payload for vendor_orders table
        const dbPayload = {
            vendor_id: vendorId,
            customer_name: customer.name,
            customer_phone: customer.phone,
            customer_email: customer.email,
            appointment_date: appointment.date,
            appointment_time: appointment.time,
            notes: appointment.notes || '',
            services: services, // JSONB
            total_amount: totalAmount,
            payment_status: paymentStatus,
            payment_method: paymentMethod || 'MOCK',
            transaction_id: transactionId,
            booking_status: 'CONFIRMED',
            appointment_type: 'AT_SALON', // Explicit requirement
            created_at: new Date().toISOString()
        };

        // 5. Insert into vendor_orders
        const { data, error } = await supabase
            .from('vendor_orders')
            .insert(dbPayload)
            .select('id')
            .single();

        if (error) {
            console.error('Supabase Insert Error:', error);
            // Return JSON error, never HTML
            return res.status(500).json({ error: 'Database insert failed: ' + error.message });
        }

        const bookingId = data.id;
        console.log('Booking created successfully:', bookingId);

        // 6. Success Response
        return res.status(200).json({
            success: true,
            bookingId: bookingId,
            transaction_id: transactionId,
            message: 'Booking confirmed'
        });

    } catch (err: any) {
        console.error('At-Salon Booking Exception:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
