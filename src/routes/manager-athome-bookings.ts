import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ==================== MANAGER AT-HOME BOOKINGS (PHASE 2) ====================

// 1. Get all At-Home requests (PENDING or ASSIGNED)
router.get('/', requireAuth, requireRole(['MANAGER']), async (req: AuthenticatedRequest, res) => {
    try {
        console.log('Fetching at-home bookings for manager...');

        // Fetch Master Bookings
        const { data: bookings, error: bookingsError } = await supabase
            .from('athome_bookings')
            .select(`
        *,
        customer:users!athome_bookings_customer_id_fkey (first_name, last_name, phone, email)
      `)
            .order('created_at', { ascending: false });

        if (bookingsError) throw bookingsError;

        // Fetch Services & Products for these bookings (Manual filtering to avoid N+1 if possible, but simplest is separate queries per page)
        // For now, we fetch ALL relevant items. In prod, use pagination + limited fetch.
        const bookingIds = bookings.map((b: any) => b.id);

        let servicesMap: Record<string, any[]> = {};
        let productsMap: Record<string, any[]> = {};

        if (bookingIds.length > 0) {
            const { data: services } = await supabase
                .from('athome_booking_services')
                .select(`
          *,
          master_service:admin_services (name, category)
        `)
                .in('booking_id', bookingIds);

            const { data: products } = await supabase
                .from('athome_booking_products')
                .select(`
           *,
           master_product:admin_products (name, category)
        `)
                .in('booking_id', bookingIds);

            (services || []).forEach((s: any) => {
                if (!servicesMap[s.booking_id]) servicesMap[s.booking_id] = [];
                servicesMap[s.booking_id].push(s);
            });

            (products || []).forEach((p: any) => {
                if (!productsMap[p.booking_id]) productsMap[p.booking_id] = [];
                productsMap[p.booking_id].push(p);
            });
        }

        const transformedBookings = bookings.map((b: any) => ({
            ...b,
            services: servicesMap[b.id] || [],
            products: productsMap[b.id] || []
        }));

        res.json({ success: true, data: transformedBookings });

    } catch (error: any) {
        console.error('Error fetching manager at-home bookings:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings', error: error.message });
    }
});

// 2. Get Eligible Vendors for a Booking
router.get('/:id/eligible-vendors', requireAuth, requireRole(['MANAGER']), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        // Logic: Find vendors who are APPROVED.
        // Enhanced Logic: Filter by those who have at least one matching service/product?
        // For MVP phase 2, we return ALL approved vendors, but we could flag "recommended" if they match the category.

        // Fetch booking details to know what is needed
        // const { data: booking } = await supabase.from('athome_bookings').select('*').eq('id', id).single();
        // For now, just return all approved vendors
        const { data: vendors, error } = await supabase
            .from('vendor')
            .select(`
        id, shopname, status,
        user:users!user_id (first_name, last_name)
      `)
            .eq('status', 'APPROVED');

        if (error) throw error;

        res.json({ success: true, data: vendors });
    } catch (error: any) {
        console.error('Error fetching eligible vendors:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch vendors' });
    }
});

// 3. Assign Vendor to Booking
router.post('/:id/assign', requireAuth, requireRole(['MANAGER']), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { service_vendor_id, product_vendor_id } = req.body;

        if (!service_vendor_id && !product_vendor_id) {
            return res.status(400).json({ success: false, message: 'Must select at least one vendor' });
        }

        console.log(`Assigning vendors for booking ${id}: S=${service_vendor_id}, P=${product_vendor_id}`);

        // Update Services (Assign to service_vendor_id)
        if (service_vendor_id) {
            const { error: sError } = await supabase
                .from('athome_booking_services')
                .update({
                    assigned_vendor_id: service_vendor_id,
                    status: 'ASSIGNED'
                })
                .eq('booking_id', id);

            if (sError) throw sError;
        }

        // Update Products (Assign to product_vendor_id)
        if (product_vendor_id) {
            const { error: pError } = await supabase
                .from('athome_booking_products')
                .update({
                    assigned_vendor_id: product_vendor_id,
                    status: 'ASSIGNED'
                })
                .eq('booking_id', id);

            if (pError) throw pError;
        }

        // Update Master Status
        const { error: mError } = await supabase
            .from('athome_bookings')
            .update({ status: 'ASSIGNED' })
            .eq('id', id);

        if (mError) throw mError;

        res.json({ success: true, message: 'Vendors assigned successfully' });

    } catch (error: any) {
        console.error('Error assigning vendors:', error);
        res.status(500).json({ success: false, message: 'Failed to assign vendors' });
    }
});

export default router;
