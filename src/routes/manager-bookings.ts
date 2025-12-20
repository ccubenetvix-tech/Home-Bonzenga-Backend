import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRole, AuthenticatedRequest, authenticateManager } from '../middleware/auth';

const router = Router();

// Get all bookings for manager dashboard (alias 1: with explicit /bookings)
router.get('/bookings', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, bookingType, notesContains, page = '1', limit = '10' } = req.query;

    let query = supabase
      .from('bookings')
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (
          id, first_name, last_name, email, phone
        ),
        vendor:vendor (
          id, shop_name,
          user:users!vendors_user_id_fkey (
            id, first_name, last_name, email
          )
        ),
        manager:users!bookings_manager_id_fkey (
          id, first_name, last_name, email
        ),
        service_catalog:service_catalog (*),
        address:addresses (*),
        items:booking_items (
          *,
          service:services (*),
          catalog_service:service_catalog (*),
          addons:booking_addons (
            *,
            addon:addons (*)
          )
        ),
        products:booking_products (
          *,
          product_catalog:product_catalog (*)
        ),
        employee:employees (
          id, name, role, phone, email, experience, specialization
        ),
        payments:payments (
          id, status, amount, method
        )
      `, { count: 'exact' });

    if (status) query = query.eq('status', status);
    // bookingType is not directly on bookings table in Supabase schema usually, 
    // but if it was added, we'd filter by it. Assuming it's derived or in metadata for now.
    // If it's in metadata (notes), we can't easily filter in SQL without JSONB operators.
    // For now, we'll skip bookingType filter at SQL level if it's not a column.

    if (notesContains && String(notesContains).trim().length > 0) {
      query = query.ilike('notes', `%${String(notesContains).trim()}%`);
    }

    const from = (parseInt(page as string) - 1) * parseInt(limit as string);
    const to = from + parseInt(limit as string) - 1;

    query = query.order('scheduled_date', { ascending: false }).range(from, to);

    const { data: bookings, count, error } = await query;

    if (error) throw error;

    // Transform to camelCase
    const transformedBookings = (bookings || []).map((booking: any) => ({
      ...booking,
      customerId: booking.customer_id,
      vendorId: booking.vendor_id,
      managerId: booking.manager_id,
      employeeId: booking.employee_id,
      addressId: booking.address_id,
      serviceCatalogId: booking.service_catalog_id,
      scheduledDate: booking.scheduled_date,
      scheduledTime: booking.scheduled_time,
      cancellationReason: booking.cancellation_reason,
      managerAssignedAt: booking.manager_assigned_at,
      vendorRespondedAt: booking.vendor_responded_at,
      beauticianAssignedAt: booking.beautician_assigned_at,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      customer: booking.customer ? {
        id: booking.customer.id,
        firstName: booking.customer.first_name,
        lastName: booking.customer.last_name,
        email: booking.customer.email,
        phone: booking.customer.phone
      } : null,
      vendor: booking.vendor ? {
        ...booking.vendor,
        shopName: booking.vendor.shop_name,
        user: booking.vendor.user ? {
          id: booking.vendor.user.id,
          firstName: booking.vendor.user.first_name,
          lastName: booking.vendor.user.last_name,
          email: booking.vendor.user.email
        } : null
      } : null,
      manager: booking.manager ? {
        id: booking.manager.id,
        firstName: booking.manager.first_name,
        lastName: booking.manager.last_name,
        email: booking.manager.email
      } : null,
      serviceCatalog: booking.service_catalog ? {
        ...booking.service_catalog,
        customerPrice: booking.service_catalog.customer_price,
        vendorPayout: booking.service_catalog.vendor_payout,
        allowsProducts: booking.service_catalog.allows_products,
        isActive: booking.service_catalog.is_active
      } : null,
      items: (booking.items || []).map((item: any) => ({
        ...item,
        catalogService: item.catalog_service,
        service: item.service
      })),
      products: (booking.products || []).map((prod: any) => ({
        ...prod,
        productCatalog: prod.product_catalog
      }))
    }));

    res.json({
      success: true,
      data: {
        bookings: transformedBookings,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: count || 0,
          pages: Math.ceil((count || 0) / parseInt(limit as string))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching manager bookings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// Supabase-powered view of at-home bookings
router.get('/at-home', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id,
        status,
        total,
        subtotal,
        discount,
        tax,
        notes,
        duration,
        scheduled_date,
        scheduled_time,
        created_at,
        updated_at,
        customer:users!bookings_customer_id_fkey (
          id,
          first_name,
          last_name,
          email,
          phone
        ),
        address:addresses!bookings_address_id_fkey (
          id,
          street,
          city,
          state,
          zip_code
        ),
        payments:payments (
          id,
          status,
          amount,
          method
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase fetch error for manager at-home bookings:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch at-home bookings from Supabase.' });
    }

    const parseMetadata = (raw: any) => {
      if (!raw) return null;
      if (typeof raw === 'object') return raw;
      try {
        return JSON.parse(String(raw));
      } catch {
        return null;
      }
    };

    const bookings = (data || [])
      .map((row: any) => {
        const metadata = parseMetadata(row.notes);
        const isAtHome = metadata?.flow === 'AT_HOME' || String(row.notes || '').toUpperCase().includes('AT_HOME');
        if (!isAtHome) {
          return null;
        }

        const items = Array.isArray(metadata?.services)
          ? metadata.services.map((service: any) => ({
            service: {
              name: service?.name || 'At-home service',
              price: Number(service?.price) || 0
            },
            quantity: Number(service?.quantity) || 1
          }))
          : [];

        const payments = Array.isArray(row.payments)
          ? row.payments.map((payment: any) => ({
            id: payment.id,
            status: payment.status,
            amount: Number(payment.amount) || 0,
            method: payment.method
          }))
          : [];

        const statusRaw = String(row.status || 'PENDING').toUpperCase();
        const status =
          statusRaw === 'PENDING'
            ? 'AWAITING_MANAGER'
            : statusRaw;

        return {
          id: row.id,
          status,
          bookingType: 'AT_HOME',
          total: Number(row.total) || 0,
          subtotal: Number(row.subtotal ?? row.total) || 0,
          discount: Number(row.discount) || 0,
          tax: Number(row.tax) || 0,
          duration: Number(row.duration) || 0,
          scheduledDate: row.scheduled_date,
          scheduledTime: row.scheduled_time,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          notes: metadata?.customerNotes || '',
          metadata,
          customer: {
            id: row.customer?.id || metadata?.createdBy?.id || '',
            firstName: row.customer?.first_name || metadata?.createdBy?.firstName || '',
            lastName: row.customer?.last_name || metadata?.createdBy?.lastName || '',
            email: row.customer?.email || metadata?.createdBy?.email || '',
            phone: row.customer?.phone || metadata?.phone || ''
          },
          vendor: metadata?.assignedVendor || null,
          address: {
            street: row.address?.street || '',
            city: row.address?.city || '',
            state: row.address?.state || '',
            zipCode: row.address?.zip_code || ''
          },
          items,
          payments
        };
      })
      .filter((booking: any) => booking !== null);

    res.json({
      success: true,
      data: {
        bookings
      }
    });
  } catch (err) {
    console.error('Error building at-home bookings feed for manager:', err);
    res.status(500).json({ success: false, message: 'Failed to load at-home bookings.' });
  }
});

// Lightweight sync endpoint (development use)
router.post('/at-home/sync', async (req, res) => {
  try {
    const { bookingId } = req.body || {};
    console.log('Received at-home booking sync payload', bookingId ? `for booking ${bookingId}` : '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to process at-home sync payload.' });
  }
});

// Get all bookings for manager dashboard (alias 2: base path '/')
router.get('/', authenticateManager, async (req: AuthenticatedRequest, res) => {
  // Redirect to /bookings logic
  // We can just reuse the logic or redirect internally, but for clarity I'll copy the logic (or call a shared function)
  // For simplicity in this rewrite, I'll just call the same logic as /bookings
  // But since I can't easily call the other route handler, I'll duplicate the logic (it's cleaner than internal redirect in express sometimes)

  try {
    const { status, notesContains, page = '1', limit = '10' } = req.query as any;

    let query = supabase
      .from('bookings')
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (
          id, first_name, last_name, email, phone
        ),
        vendor:vendor (
          id, shop_name,
          user:users!vendors_user_id_fkey (
            id, first_name, last_name, email
          )
        ),
        manager:users!bookings_manager_id_fkey (
          id, first_name, last_name, email
        ),
        service_catalog:service_catalog (*),
        address:addresses (*),
        items:booking_items (
          *,
          service:services (*),
          catalog_service:service_catalog (*),
          addons:booking_addons (
            *,
            addon:addons (*)
          )
        ),
        products:booking_products (
          *,
          product_catalog:product_catalog (*)
        ),
        employee:employees (
          id, name, role, phone, email, experience, specialization
        )
      `, { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (notesContains && String(notesContains).trim().length > 0) {
      query = query.ilike('notes', `%${String(notesContains).trim()}%`);
    }

    const from = (parseInt(page as string) - 1) * parseInt(limit as string);
    const to = from + parseInt(limit as string) - 1;

    query = query.order('scheduled_date', { ascending: false }).range(from, to);

    const { data: bookings, count, error } = await query;

    if (error) throw error;

    // Transform to camelCase
    const transformedBookings = (bookings || []).map((booking: any) => ({
      ...booking,
      customerId: booking.customer_id,
      vendorId: booking.vendor_id,
      managerId: booking.manager_id,
      employeeId: booking.employee_id,
      addressId: booking.address_id,
      serviceCatalogId: booking.service_catalog_id,
      scheduledDate: booking.scheduled_date,
      scheduledTime: booking.scheduled_time,
      cancellationReason: booking.cancellation_reason,
      managerAssignedAt: booking.manager_assigned_at,
      vendorRespondedAt: booking.vendor_responded_at,
      beauticianAssignedAt: booking.beautician_assigned_at,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      customer: booking.customer ? {
        id: booking.customer.id,
        firstName: booking.customer.first_name,
        lastName: booking.customer.last_name,
        email: booking.customer.email,
        phone: booking.customer.phone
      } : null,
      vendor: booking.vendor ? {
        ...booking.vendor,
        shopName: booking.vendor.shop_name,
        user: booking.vendor.user ? {
          id: booking.vendor.user.id,
          firstName: booking.vendor.user.first_name,
          lastName: booking.vendor.user.last_name,
          email: booking.vendor.user.email
        } : null
      } : null,
      manager: booking.manager ? {
        id: booking.manager.id,
        firstName: booking.manager.first_name,
        lastName: booking.manager.last_name,
        email: booking.manager.email
      } : null,
      serviceCatalog: booking.service_catalog ? {
        ...booking.service_catalog,
        customerPrice: booking.service_catalog.customer_price,
        vendorPayout: booking.service_catalog.vendor_payout,
        allowsProducts: booking.service_catalog.allows_products,
        isActive: booking.service_catalog.is_active
      } : null,
      items: (booking.items || []).map((item: any) => ({
        ...item,
        catalogService: item.catalog_service,
        service: item.service
      })),
      products: (booking.products || []).map((prod: any) => ({
        ...prod,
        productCatalog: prod.product_catalog
      }))
    }));

    res.json({
      success: true,
      data: {
        bookings: transformedBookings,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: count || 0,
          pages: Math.ceil((count || 0) / parseInt(limit as string))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching manager bookings (base path):', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// Assign vendor to a booking (alias 1)
router.put('/bookings/:id/assign-vendor', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { vendorId } = req.body;

    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'Vendor ID is required' });
    }

    // Verify vendor exists and is approved
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('id', vendorId)
      .eq('status', 'APPROVED')
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found or not approved' });
    }

    const now = new Date().toISOString();

    // Update booking
    const { data: booking, error: updateError } = await supabase
      .from('bookings')
      .update({
        vendor_id: vendorId,
        manager_id: req.user?.id || null,
        manager_assigned_at: now,
        status: 'AWAITING_VENDOR_RESPONSE',
        vendor_responded_at: null,
        beautician_assigned_at: null
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (*),
        vendor:vendor (*),
        manager:users!bookings_manager_id_fkey (*)
      `)
      .single();

    if (updateError) throw updateError;

    await supabase.from('booking_events').insert({
      booking_id: id,
      type: 'MANAGER_ASSIGNED_VENDOR',
      data: {
        managerId: req.user?.id || null,
        vendorId
      }
    });

    res.json({
      success: true,
      message: 'Vendor assigned successfully',
      data: booking
    });
  } catch (error) {
    console.error('Error assigning vendor:', error);
    res.status(500).json({ success: false, message: 'Failed to assign vendor' });
  }
});

// Assign vendor to a booking (alias 2: base path)
router.put('/:id/assign-vendor', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { vendorId } = req.body;

    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'Vendor ID is required' });
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('id', vendorId)
      .eq('status', 'APPROVED')
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found or not approved' });
    }

    const now = new Date().toISOString();

    const { data: booking, error: updateError } = await supabase
      .from('bookings')
      .update({
        vendor_id: vendorId,
        manager_id: req.user?.id || null,
        manager_assigned_at: now,
        status: 'AWAITING_VENDOR_RESPONSE',
        vendor_responded_at: null,
        beautician_assigned_at: null
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (*),
        vendor:vendor (*),
        manager:users!bookings_manager_id_fkey (*)
      `)
      .single();

    if (updateError) throw updateError;

    await supabase.from('booking_events').insert({
      booking_id: id,
      type: 'MANAGER_ASSIGNED_VENDOR',
      data: {
        managerId: req.user?.id || null,
        vendorId
      }
    });

    res.json({ success: true, message: 'Vendor assigned successfully', data: booking });
  } catch (error) {
    console.error('Error assigning vendor (base path):', error);
    res.status(500).json({ success: false, message: 'Failed to assign vendor' });
  }
});

// Get booking statistics for manager (alias 1)
router.get('/bookings/stats', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { count: total } = await supabase.from('bookings').select('*', { count: 'exact', head: true });
    const { count: pending } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).in('status', ['PENDING', 'AWAITING_MANAGER', 'AWAITING_VENDOR_RESPONSE']);
    const { count: awaitingManager } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_MANAGER');
    const { count: awaitingVendor } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_VENDOR_RESPONSE');
    const { count: awaitingBeautician } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_BEAUTICIAN');
    const { count: confirmed } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'CONFIRMED');
    const { count: inProgress } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'IN_PROGRESS');
    const { count: completed } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED');

    res.json({
      success: true,
      data: {
        total: total || 0,
        pending: pending || 0,
        awaitingManager: awaitingManager || 0,
        awaitingVendor: awaitingVendor || 0,
        awaitingBeautician: awaitingBeautician || 0,
        confirmed: confirmed || 0,
        inProgress: inProgress || 0,
        completed: completed || 0
      }
    });
  } catch (error) {
    console.error('Error fetching booking stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// Get booking statistics for manager (alias 2: base path)
router.get('/stats', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { count: total } = await supabase.from('bookings').select('*', { count: 'exact', head: true });
    const { count: pending } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).in('status', ['PENDING', 'AWAITING_MANAGER', 'AWAITING_VENDOR_RESPONSE']);
    const { count: awaitingManager } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_MANAGER');
    const { count: awaitingVendor } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_VENDOR_RESPONSE');
    const { count: awaitingBeautician } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'AWAITING_BEAUTICIAN');
    const { count: confirmed } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'CONFIRMED');
    const { count: inProgress } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'IN_PROGRESS');
    const { count: completed } = await supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED');

    res.json({
      success: true,
      data: {
        total: total || 0,
        pending: pending || 0,
        awaitingManager: awaitingManager || 0,
        awaitingVendor: awaitingVendor || 0,
        awaitingBeautician: awaitingBeautician || 0,
        confirmed: confirmed || 0,
        inProgress: inProgress || 0,
        completed: completed || 0
      }
    });
  } catch (error) {
    console.error('Error fetching booking stats (base path):', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// Get all available employees (beauticians) for manager assignment
router.get('/employees', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { status = 'ACTIVE', vendorId } = req.query;

    let query = supabase
      .from('employees')
      .select(`
        *,
        vendor:vendors (
          id, shop_name,
          user:users!vendors_user_id_fkey (
            email, phone
          )
        )
      `)
      .order('name', { ascending: true });

    if (status) query = query.eq('status', status);
    if (vendorId) query = query.eq('vendor_id', vendorId); // Note: schema might not have vendor_id directly on employees if it's linked via manager, but assuming it is for now based on previous code.

    const { data: employees, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: (employees || []).map((emp: any) => ({
        id: emp.id,
        name: emp.name,
        role: emp.role,
        email: emp.email,
        phone: emp.phone,
        experience: emp.experience,
        specialization: emp.specialization,
        status: emp.status,
        rating: emp.rating,
        totalBookings: emp.total_bookings,
        vendor: emp.vendor ? {
          id: emp.vendor.id,
          shopName: emp.vendor.shop_name,
          email: emp.vendor.user?.email,
          phone: emp.vendor.user?.phone
        } : null
      }))
    });
  } catch (error) {
    console.error('Error fetching employees for manager:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch employees' });
  }
});

// Assign employee (beautician) to a booking
router.put('/bookings/:id/assign-employee', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    }

    // Verify booking exists and is in a state that allows assignment
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', id)
      .in('status', ['AWAITING_MANAGER', 'AWAITING_VENDOR_RESPONSE', 'PENDING'])
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not available for employee assignment'
      });
    }

    // Verify employee exists and is active
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('status', 'ACTIVE')
      .single();

    if (employeeError || !employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or not active'
      });
    }

    const now = new Date().toISOString();

    // Update booking with employee assignment
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        employee_id: employeeId,
        manager_id: req.user!.id,
        status: 'CONFIRMED',
        beautician_assigned_at: now,
        manager_assigned_at: now
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (*),
        employee:employees (*),
        vendor:vendors (*),
        address:addresses (*)
      `)
      .single();

    if (updateError) throw updateError;

    // Create booking event
    await supabase.from('booking_events').insert({
      booking_id: id,
      type: 'BEAUTICIAN_ASSIGNED',
      data: {
        assignedBy: req.user!.id,
        employeeId,
        assignedAt: now
      }
    });

    res.json({
      success: true,
      message: 'Employee assigned successfully',
      data: updatedBooking
    });
  } catch (error) {
    console.error('Error assigning employee to booking:', error);
    res.status(500).json({ success: false, message: 'Failed to assign employee' });
  }
});

// ==================== VENDOR ASSIGNMENT (MULTI-VENDOR) ====================

// Create vendor assignment
router.post('/bookings/:id/assignments', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { vendorId, itemIds, productIds } = req.body;

    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'Vendor ID is required' });
    }

    // Verify vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor') // Note: table name is 'vendors' or 'vendor' depending on schema map
      .select('id')
      .eq('id', vendorId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Create assignment
    const { data: assignment, error: assignError } = await supabase
      .from('vendor_assignments')
      .insert({
        bookingId: id,
        vendorId,
        status: 'PENDING'
      })
      .select()
      .single();

    if (assignError) throw assignError;

    // Link items
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      const { error: itemsError } = await supabase
        .from('booking_items')
        .update({ vendorAssignmentId: assignment.id })
        .in('id', itemIds);

      if (itemsError) throw itemsError;
    }

    // Link products
    if (productIds && Array.isArray(productIds) && productIds.length > 0) {
      const { error: productsError } = await supabase
        .from('booking_products')
        .update({ vendorAssignmentId: assignment.id })
        .in('id', productIds);

      if (productsError) throw productsError;
    }

    // Update booking status if needed
    await supabase.from('bookings').update({ status: 'ASSIGNED_TO_VENDOR' }).eq('id', id);

    res.json({ success: true, data: assignment });
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ success: false, message: 'Failed to create assignment' });
  }
});

// Get assignments for a booking
router.get('/bookings/:id/assignments', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const { data: assignments, error } = await supabase
      .from('vendor_assignments')
      .select(`
        *,
        vendor:vendor (*),
        items:booking_items (*),
        products:booking_products (*)
      `)
      .eq('bookingId', id);

    if (error) throw error;

    res.json({ success: true, data: assignments });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
  }
});

// ==================== AT-HOME BOOKING MANAGEMENT (PHASE 2) ====================

// 1. Get Live At-Home Bookings (Payment Success)
// 1. Get Live At-Home Bookings (Payment Success) - Updated Phase 2 Strategy
router.get('/athome-bookings', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('Fetching live at-home bookings for manager...');

    // 1. Fetch Bookings
    const { data: bookingsDoc, error: bookingsError } = await supabase
      .from('athome_bookings')
      .select(`
        *,
        customer:users!athome_bookings_customer_id_fkey (
          first_name, last_name, phone, email
        )
      `)
      .eq('payment_status', 'SUCCESS')
      .order('created_at', { ascending: false });

    if (bookingsError) throw bookingsError;
    const bookings = bookingsDoc || [];
    const bookingIds = bookings.map((b: any) => b.id);

    // 2. Manual Joins for Services
    let servicesMap: Record<string, any[]> = {};
    if (bookingIds.length > 0) {
      const { data: services, error: servError } = await supabase
        .from('athome_booking_services')
        .select('*, admin_service:admin_services(name, category, description)')
        .in('booking_id', bookingIds);

      if (!servError && services) {
        services.forEach((s: any) => {
          if (!servicesMap[s.booking_id]) servicesMap[s.booking_id] = [];
          servicesMap[s.booking_id].push({
            ...s,
            master_service: s.admin_service
          });
        });
      }
    }

    // 3. Manual Joins for Products
    let productsMap: Record<string, any[]> = {};
    if (bookingIds.length > 0) {
      const { data: products, error: prodError } = await supabase
        .from('athome_booking_products')
        .select('*, admin_product:admin_products(name, category, description)')
        .in('booking_id', bookingIds);

      if (!prodError && products) {
        products.forEach((p: any) => {
          if (!productsMap[p.booking_id]) productsMap[p.booking_id] = [];
          productsMap[p.booking_id].push({
            ...p,
            master_product: p.admin_product
          });
        });
      }
    }

    // 4. Combine
    const finalBookings = bookings.map((b: any) => ({
      ...b,
      services: servicesMap[b.id] || [],
      products: productsMap[b.id] || []
    }));

    res.json({ success: true, data: finalBookings });
  } catch (error: any) {
    console.error('Error fetching at-home bookings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings', error: error.message });
  }
});

// 2. Get Eligible Vendors for a Booking
router.get('/athome-bookings/:id/eligible-vendors', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    console.log(`Finding eligible vendors for booking ${id}...`);

    // Fetch booking to get requirements
    const { data: booking, error: bookingError } = await supabase
      .from('athome_bookings')
      .select(`
        *,
        services:athome_booking_services (*),
        products:athome_booking_products (*)
      `)
      .eq('id', id)
      .single();

    if (bookingError || !booking) throw bookingError || new Error('Booking not found');

    // Fetch all active vendors
    // REMOVED legacy joins to vendor_services and products to prevent 500 errors as per Phase 2 requirements
    const { data: vendors, error: vendorError } = await supabase
      .from('vendor')
      .select(`
        id, shopname, service_radius, latitude, longitude,
        user:users!vendors_user_id_fkey(first_name, last_name, phone)
      `)
      .eq('status', 'APPROVED');

    if (vendorError) throw vendorError;

    // Filter Logic
    // Requirements:
    // 1. One or more vendors can be eligible.
    // 2. Match service category/intent.

    // Since we cannot query legacy vendor_services, we assume all approved vendors are potential candidates
    // for the manager to assign. We can refine this later if a new 'vendor_services' JSONB structure is confirmed.

    // We still return 'serviceVendors' and 'productVendors' as keys for frontend compatibility

    res.json({
      success: true,
      data: {
        serviceVendors: vendors,
        productVendors: vendors
      }
    });

  } catch (error: any) {
    console.error('Error fetching eligible vendors:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendors', error: error.message });
  }
});

// 3. Assign Vendor(s)
router.post('/athome-bookings/:id/assign', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { service_vendor_id, product_vendor_id } = req.body;

    console.log(`Assigning vendors for booking ${id}...`);

    // Assign Service Vendor
    if (service_vendor_id) {
      const { error: serviceError } = await supabase
        .from('athome_booking_services')
        .update({
          assigned_vendor_id: service_vendor_id,
          status: 'ASSIGNED'
        })
        .eq('booking_id', id);

      if (serviceError) throw serviceError;
    }

    // Assign Product Vendor (if different or same)
    if (product_vendor_id) {
      const { error: productError } = await supabase
        .from('athome_booking_products')
        .update({
          assigned_vendor_id: product_vendor_id,
          status: 'ASSIGNED'
        })
        .eq('booking_id', id);

      if (productError) throw productError;
    }

    // Update Master Booking Status to ASSIGNED
    // This ensures it moves out of 'PENDING' lists in dashboards
    const { error: masterError } = await supabase
      .from('athome_bookings')
      .update({ status: 'ASSIGNED' })
      .eq('id', id);

    if (masterError) {
      console.error('Error updating master booking status:', masterError);
      // We don't throw here to avoid rolling back partial successes, but we log it.
    }

    res.json({ success: true, message: 'Vendors assigned successfully' });

  } catch (error: any) {
    console.error('Error assigning vendor:', error);
    res.status(500).json({ success: false, message: 'Failed to assign vendor', error: error.message });
  }
});

export default router;

// ==================== ONE-TIME UTILITIES ====================

// Bulk update: set AWAITING_MANAGER for at-home PENDING bookings (notes contains 'at home')
router.put('/bookings/bulk/awaiting-manager', authenticateManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { phrase = 'at home' } = (req.body || {}) as { phrase?: string };

    // Update bookings that are clearly at-home (by notes) and still pending
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'AWAITING_MANAGER' })
      .eq('status', 'PENDING')
      .ilike('notes', `%${String(phrase).trim()}%`)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Bookings updated to AWAITING_MANAGER',
      data: {
        count: data?.length || 0,
        phrase
      }
    });
  } catch (error) {
    console.error('Error bulk-updating bookings to AWAITING_MANAGER:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk update bookings' });
  }
});
