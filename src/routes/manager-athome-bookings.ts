
import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRole, AuthenticatedRequest, authenticateManager } from '../middleware/auth';

const router = Router();

// ==================== MANAGER AT-HOME BOOKINGS (PHASE 2) ====================

// 1. Get all At-Home requests (PENDING or ASSIGNED)
router.get('/', authenticateManager, async (req: AuthenticatedRequest, res) => {
    try {
        console.log('Fetching at-home bookings for manager...');

        const { data: bookings, error: bookingsError } = await supabase
            .from('athome_bookings')
            .select(`
        *,
        customer:users!athome_bookings_customer_id_fkey (first_name, last_name, phone, email)
      `)
            .order('created_at', { ascending: false });

        if (bookingsError) throw bookingsError;

        const bookingIds = bookings.map((b: any) => b.id);

        let servicesMap: Record<string, any[]> = {};
        let productsMap: Record<string, any[]> = {};

        if (bookingIds.length > 0) {
            console.log(`[Manager] Querying services/products for ${bookingIds.length} bookings...`);

            const { data: services, error: sError } = await supabase
                .from('athome_booking_services')
                .select(`
          *,
          master_service:admin_services!athome_booking_services_admin_service_id_fkey (name, category)
        `)
                .in('booking_id', bookingIds);

            if (sError) console.error('[Manager] Error fetching services:', sError);
            else console.log(`[Manager] Found ${services?.length || 0} services.`);

            const { data: products, error: pError } = await supabase
                .from('athome_booking_products')
                .select(`
           *,
           master_product:admin_products!athome_booking_products_admin_product_id_fkey (name, category)
        `)
                .in('booking_id', bookingIds);

            if (pError) console.error('[Manager] Error fetching products:', pError);
            else console.log(`[Manager] Found ${products?.length || 0} products.`);

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
router.get('/:id/eligible-vendors', authenticateManager, async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        console.log(`[Manager] Fetching eligible vendors for booking ${id}`);

        const { data: booking, error: bookingError } = await supabase
            .from('athome_bookings')
            .select('*')
            .eq('id', id)
            .single();

        if (bookingError || !booking) {
            console.error('Error fetching booking main details:', bookingError);
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const { data: bookingServices, error: bsError } = await supabase
            .from('athome_booking_services')
            .select('*')
            .eq('booking_id', id);

        if (bsError) throw bsError;

        const { data: bookingProducts, error: bpError } = await supabase
            .from('athome_booking_products')
            .select('*')
            .eq('booking_id', id);

        if (bpError) throw bpError;

        const adminServiceIds = (bookingServices || []).map((s: any) => s.admin_service_id).filter(Boolean);
        const adminProductIds = (bookingProducts || []).map((p: any) => p.admin_product_id).filter(Boolean);

        let serviceCategories = new Set<string>();
        let productCategories = new Set<string>();

        if (adminServiceIds.length > 0) {
            const { data: adminServices } = await supabase
                .from('admin_services')
                .select('id, name, category')
                .in('id', adminServiceIds);

            adminServices?.forEach((as: any) => {
                if (as.category) serviceCategories.add(as.category);
            });
        }

        if (adminProductIds.length > 0) {
            const { data: adminProducts } = await supabase
                .from('admin_products')
                .select('id, name, category')
                .in('id', adminProductIds);

            adminProducts?.forEach((ap: any) => {
                if (ap.category) productCategories.add(ap.category);
            });
        }

        console.log('Target Service Categories:', Array.from(serviceCategories));
        console.log('Target Product Categories:', Array.from(productCategories));

        // Helper: Fetch Vendors & Items With Robust Multi-Level Fallback
        const fetchVendorsWithItems = async (itemIds: string[], categoryIds: string[], isProduct: boolean) => {
            let targetVendorIds: string[] = [];
            let matchType = 'match';
            const itemTable = isProduct ? 'vendor_products' : 'vendor_services';
            const fkCol = isProduct ? 'admin_product_id' : 'admin_service_id';

            // LEVEL 0: Strict Admin Item ID Match (Best Match)
            if (itemIds.length > 0) {
                const { data: matches } = await supabase
                    .from(itemTable)
                    .select('vendor_id')
                    .in(fkCol, itemIds);

                (matches || []).forEach((m: any) => targetVendorIds.push(m.vendor_id));
            }

            // LEVEL 1: Soft Category Match (ILIKE)
            if (categoryIds.length > 0) {
                const orConditions = categoryIds.map(c => `category.ilike.%${c}%`).join(',');
                const { data: matches } = await supabase
                    .from(itemTable)
                    .select('vendor_id')
                    .or(orConditions);

                (matches || []).forEach((m: any) => targetVendorIds.push(m.vendor_id));
            }

            targetVendorIds = Array.from(new Set(targetVendorIds));

            // LEVEL 2 & 3: Fallback - Fetch ALL Approved Vendors if no match found
            if (targetVendorIds.length === 0) {
                console.log(`[Manager] Level 0/1 (ID/Category Match) yielded 0 vendors for ${isProduct ? 'Product' : 'Service'}. Triggering FALLBACK to ALL.`);
                matchType = 'fallback';

                const { data: all } = await supabase
                    .from('vendor')
                    .select('id')
                    .ilike('status', 'approved');

                (all || []).forEach((v: any) => targetVendorIds.push(v.id));
            }

            if (targetVendorIds.length === 0) {
                console.warn('[Manager] CRITICAL: No approved vendors found in system at all.');
                return [];
            }

            // 3. Fetch Vendor Details (NO GENDER)
            const { data: vendors, error: vError } = await supabase
                .from('vendor')
                .select(`
            id, shopname, status, address, city,
            user:users!vendors_user_id_fkey (first_name, last_name)
        `)
                .in('id', targetVendorIds)
                .ilike('status', 'approved');

            if (vError) {
                console.error('Error fetching vendors:', vError);
                return [];
            }

            // 4. Fetch Items Manually for Inventory Display
            const { data: rawItems } = await supabase
                .from(itemTable)
                .select('*')
                .in('vendor_id', targetVendorIds);

            // 5. Resolve Names (Manual Join)
            const startTable = isProduct ? 'admin_products' : 'admin_services';

            const masterIds = Array.from(new Set((rawItems || []).map((i: any) => i[fkCol]).filter(Boolean)));
            let masterNameMap: Record<string, string> = {};

            if (masterIds.length > 0) {
                const { data: masters } = await supabase.from(startTable).select('id, name').in('id', masterIds);
                (masters || []).forEach((m: any) => masterNameMap[m.id] = m.name);
            }

            // 6. Attach Items and Match Type
            return (vendors || []).map((v: any) => {
                const vendorItems = (rawItems || []).filter((i: any) => i.vendor_id === v.id);
                const mappedItems = vendorItems.map((i: any) => ({
                    name: masterNameMap[i[fkCol]] || 'Unknown Item'
                    // removed price from backend view per UI request to clean up
                }));
                const uniqueItemNames = Array.from(new Set(mappedItems.map((i: any) => i.name))).join(', ');

                return {
                    ...v,
                    // Per user request: Show city / area in smaller text
                    // Use city if available, else address (usually longer)
                    location: v.city ? v.city : (v.address || 'Unknown'),
                    items: mappedItems,
                    inventory: uniqueItemNames || 'No specific items listed',
                    match_type: matchType
                };
            });
        };

        const serviceVendorsList = await fetchVendorsWithItems(adminServiceIds, Array.from(serviceCategories), false);
        const productVendorsList = await fetchVendorsWithItems(adminProductIds, Array.from(productCategories), true);

        const mapVendorToOutput = (v: any) => ({
            id: v.id,
            shopname: v.shopname,
            shopName: v.shopname,
            // Only shopname per UI request (removed ownerName from dropdown label logic in frontend, but keeping data here just in case)
            ownerName: v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : 'Unknown',
            location: v.location, // Already formatted above
            matchType: v.match_type,
            inventory: v.inventory
        });

        res.json({
            success: true,
            data: {
                serviceVendors: serviceVendorsList.map(mapVendorToOutput),
                productVendors: productVendorsList.map(mapVendorToOutput)
            }
        });

    } catch (error: any) {
        console.error('Error fetching eligible vendors:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch vendors', error: error.message });
    }
});

// 3. Assign Vendor to Booking
router.post('/:id/assign', authenticateManager, async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { service_vendor_id, product_vendor_id } = req.body;

        if (!service_vendor_id && !product_vendor_id) {
            console.warn(`[Manager] Assign failed: No vendors selected for booking ${id}`);
            return res.status(400).json({ success: false, message: 'Please select a vendor for services or products.' });
        }

        console.log(`Assigning vendors for booking ${id}: ServiceVendor=${service_vendor_id || 'None'}, ProductVendor=${product_vendor_id || 'None'}`);

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

        if (product_vendor_id) {
            // Note: athome_booking_products does not have 'assigned_vendor_id' column in current schema.
            // We only update status to ASSIGNED.
            const { error: pError } = await supabase
                .from('athome_booking_products')
                .update({
                    // assigned_vendor_id: product_vendor_id, // Column does not exist
                    status: 'ASSIGNED'
                })
                .eq('booking_id', id);

            if (pError) throw pError;
        }

        const { error: mError } = await supabase
            .from('athome_bookings')
            .update({ status: 'ASSIGNED' })
            .eq('id', id);

        if (mError) throw mError;

        res.json({ success: true, message: 'Vendors assigned successfully' });

    } catch (error: any) {
        console.error('Error assigning vendors:', error);
        res.status(500).json({ success: false, message: 'Failed to assign vendors', error: error.message });
    }
});

export default router;
