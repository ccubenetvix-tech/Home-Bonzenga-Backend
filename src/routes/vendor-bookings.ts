import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Get all bookings for a vendor
router.get('/bookings', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    // Get vendor ID from user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', req.user!.id)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Get bookings with related data
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:users!bookings_customer_id_fkey(id, first_name, last_name, email, phone),
        manager:users!bookings_manager_id_fkey(id, first_name, last_name, email),
        employee:employees(id, name, role, phone, email, specialization),
        address:addresses(*),
        items:booking_items(
          *,
          service:services(*),
          catalog_service:service_catalog(*)
        ),
        products:booking_products(
          *,
          product_catalog:product_catalog(*)
        ),
        payments:payments(*)
      `)
      .eq('vendor_id', vendor.id)
      .in('status', ['PENDING', 'AWAITING_MANAGER', 'AWAITING_VENDOR_RESPONSE', 'AWAITING_BEAUTICIAN', 'CONFIRMED', 'IN_PROGRESS'])
      .order('scheduled_date', { ascending: true });

    if (bookingsError) {
      console.error('Error fetching bookings:', bookingsError);
      return res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
    }

    // Transform data to match expected format (camelCase)
    const transformedBookings = bookings?.map(booking => ({
      ...booking,
      customerId: booking.customer_id,
      vendorId: booking.vendor_id,
      managerId: booking.manager_id,
      employeeId: booking.employee_id,
      addressId: booking.address_id,
      scheduledDate: booking.scheduled_date,
      scheduledTime: booking.scheduled_time,
      cancellationReason: booking.cancellation_reason,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      customer: booking.customer ? {
        id: booking.customer.id,
        firstName: booking.customer.first_name,
        lastName: booking.customer.last_name,
        email: booking.customer.email,
        phone: booking.customer.phone
      } : null,
      manager: booking.manager ? {
        id: booking.manager.id,
        firstName: booking.manager.first_name,
        lastName: booking.manager.last_name,
        email: booking.manager.email
      } : null,
      employee: booking.employee ? {
        id: booking.employee.id,
        name: booking.employee.name,
        role: booking.employee.role,
        phone: booking.employee.phone,
        email: booking.employee.email,
        specialization: booking.employee.specialization
      } : null
    })) || [];

    res.json({
      success: true,
      data: transformedBookings
    });
  } catch (error) {
    console.error('Error fetching vendor bookings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// Approve a booking
router.put('/bookings/:id/approve', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    // Get vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', req.user!.id)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Verify booking exists and belongs to this vendor
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, status')
      .eq('id', id)
      .eq('vendor_id', vendor.id)
      .in('status', ['PENDING', 'AWAITING_VENDOR_RESPONSE'])
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or not available for approval' });
    }

    const now = new Date().toISOString();
    const status = 'AWAITING_BEAUTICIAN';

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status,
        employee_id: null,
        vendor_responded_at: now,
        beautician_assigned_at: null,
        updated_at: now
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey(*),
        manager:users!bookings_manager_id_fkey(*),
        employee:employees(*),
        address:addresses(*),
        items:booking_items(
          *,
          service:services(*),
          catalog_service:service_catalog(*)
        ),
        products:booking_products(
          *,
          product_catalog:product_catalog(*)
        ),
        payments:payments(*)
      `)
      .single();

    if (updateError) {
      console.error('Error updating booking:', updateError);
      return res.status(500).json({ success: false, message: 'Failed to update booking' });
    }

    // Create booking event
    await supabase
      .from('booking_events')
      .insert({
        booking_id: id,
        type: 'VENDOR_ACCEPTED',
        data: {
          vendorId: vendor.id,
          status
        }
      });

    // Transform to camelCase
    const transformed = {
      ...updatedBooking,
      customerId: updatedBooking.customer_id,
      vendorId: updatedBooking.vendor_id,
      managerId: updatedBooking.manager_id,
      employeeId: updatedBooking.employee_id,
      addressId: updatedBooking.address_id,
      scheduledDate: updatedBooking.scheduled_date,
      scheduledTime: updatedBooking.scheduled_time,
      cancellationReason: updatedBooking.cancellation_reason,
      createdAt: updatedBooking.created_at,
      updatedAt: updatedBooking.updated_at
    };

    res.json({
      success: true,
      message: 'Booking confirmed successfully',
      data: transformed
    });
  } catch (error) {
    console.error('Error approving booking:', error);
    res.status(500).json({ success: false, message: 'Failed to approve booking' });
  }
});

// Reject a booking
router.put('/bookings/:id/reject', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Get vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', req.user!.id)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Verify booking exists and belongs to this vendor
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', id)
      .eq('vendor_id', vendor.id)
      .in('status', ['PENDING', 'AWAITING_VENDOR_RESPONSE'])
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or not available for rejection' });
    }

    const now = new Date().toISOString();

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'AWAITING_MANAGER',
        vendor_id: null,
        manager_id: null,
        manager_assigned_at: null,
        vendor_responded_at: now,
        beautician_assigned_at: null,
        updated_at: now
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey(*),
        manager:users!bookings_manager_id_fkey(*),
        address:addresses(*),
        items:booking_items(
          *,
          service:services(*),
          catalog_service:service_catalog(*)
        ),
        products:booking_products(
          *,
          product_catalog:product_catalog(*)
        )
      `)
      .single();

    if (updateError) {
      console.error('Error updating booking:', updateError);
      return res.status(500).json({ success: false, message: 'Failed to update booking' });
    }

    // Create booking event
    await supabase
      .from('booking_events')
      .insert({
        booking_id: id,
        type: 'VENDOR_REJECTED',
        data: {
          vendorId: vendor.id,
          reason: reason || null
        }
      });

    // Transform to camelCase
    const transformed = {
      ...updatedBooking,
      customerId: updatedBooking.customer_id,
      vendorId: updatedBooking.vendor_id,
      managerId: updatedBooking.manager_id,
      employeeId: updatedBooking.employee_id,
      addressId: updatedBooking.address_id,
      scheduledDate: updatedBooking.scheduled_date,
      scheduledTime: updatedBooking.scheduled_time,
      cancellationReason: updatedBooking.cancellation_reason,
      createdAt: updatedBooking.created_at,
      updatedAt: updatedBooking.updated_at
    };

    res.json({
      success: true,
      message: 'Booking rejected successfully',
      data: transformed
    });
  } catch (error) {
    console.error('Error rejecting booking:', error);
    res.status(500).json({ success: false, message: 'Failed to reject booking' });
  }
});

// Assign beautician to booking
router.put('/bookings/:id/assign-beautician', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { employeeId, beautician } = req.body as {
      employeeId?: string;
      beautician?: {
        name: string;
        role?: string;
        email?: string;
        phone?: string;
        experience?: number;
        specialization?: string;
      };
    };

    // Get vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', req.user!.id)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Get booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, vendor_responded_at')
      .eq('id', id)
      .eq('vendor_id', vendor.id)
      .in('status', ['AWAITING_BEAUTICIAN', 'AWAITING_VENDOR_RESPONSE'])
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not awaiting beautician assignment',
      });
    }

    let assignedEmployeeId = employeeId || null;

    if (assignedEmployeeId) {
      // Note: employees table doesn't have vendor_id in Supabase schema, so we check by manager_id or skip this check
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('id')
        .eq('id', assignedEmployeeId)
        .eq('status', 'ACTIVE')
        .single();

      if (employeeError || !employee) {
        return res.status(404).json({ success: false, message: 'Employee not found' });
      }
    } else if (beautician && beautician.name) {
      // Create new employee
      const { data: createdEmployee, error: createError } = await supabase
        .from('employees')
        .insert({
          name: beautician.name,
          role: beautician.role || 'Beautician',
          email: beautician.email || null,
          phone: beautician.phone || null,
          specialization: beautician.specialization || null,
          status: 'ACTIVE',
          manager_id: req.user!.id // Assuming manager_id can be used for vendor association
        })
        .select('id')
        .single();

      if (createError || !createdEmployee) {
        console.error('Error creating employee:', createError);
        return res.status(500).json({ success: false, message: 'Failed to create employee' });
      }
      assignedEmployeeId = createdEmployee.id;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide either employeeId or beautician details',
      });
    }

    const now = new Date().toISOString();

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'BEAUTICIAN_ASSIGNED',
        employee_id: assignedEmployeeId,
        beautician_assigned_at: now,
        vendor_responded_at: booking.vendor_responded_at || now,
        updated_at: now
      })
      .eq('id', id)
      .select(`
        *,
        customer:users!bookings_customer_id_fkey(*),
        manager:users!bookings_manager_id_fkey(*),
        employee:employees(*),
        address:addresses(*),
        items:booking_items(
          *,
          service:services(*),
          catalog_service:service_catalog(*)
        ),
        products:booking_products(
          *,
          product_catalog:product_catalog(*)
        ),
        payments:payments(*)
      `)
      .single();

    if (updateError) {
      console.error('Error updating booking:', updateError);
      return res.status(500).json({ success: false, message: 'Failed to update booking' });
    }

    // Create booking event
    await supabase
      .from('booking_events')
      .insert({
        booking_id: id,
        type: 'BEAUTICIAN_ASSIGNED',
        data: {
          vendorId: vendor.id,
          employeeId: assignedEmployeeId,
        }
      });

    // Transform to camelCase
    const transformed = {
      ...updatedBooking,
      customerId: updatedBooking.customer_id,
      vendorId: updatedBooking.vendor_id,
      managerId: updatedBooking.manager_id,
      employeeId: updatedBooking.employee_id,
      addressId: updatedBooking.address_id,
      scheduledDate: updatedBooking.scheduled_date,
      scheduledTime: updatedBooking.scheduled_time,
      cancellationReason: updatedBooking.cancellation_reason,
      createdAt: updatedBooking.created_at,
      updatedAt: updatedBooking.updated_at
    };

    res.json({
      success: true,
      message: 'Beautician assigned successfully',
      data: transformed,
    });
  } catch (error) {
    console.error('Error assigning beautician:', error);
    res.status(500).json({ success: false, message: 'Failed to assign beautician' });
  }
});

// ==================== ASSIGNMENT MANAGEMENT (MULTI-VENDOR) ====================

// Get assignments for logged in vendor
router.get('/assignments', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    // Get vendor ID
    const { data: vendor } = await supabase.from('vendor').select('id').eq('user_id', req.user!.id).single();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const { data: assignments, error } = await supabase
      .from('vendor_assignments')
      .select(`
         *,
         booking:bookings!bookingId (
           id, scheduledDate, scheduledTime, address:addresses(*), customer:users!bookings_customer_id_fkey(*)
         ),
         employee:employees(*),
         items:booking_items(*),
         products:booking_products(*)
       `)
      .eq('vendorId', vendor.id)
      .order('createdAt', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: assignments });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ success: false });
  }
});

// Assign beautician to assignment
router.put('/assignments/:id/beautician', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    // Verify ownership
    const { data: vendor } = await supabase.from('vendor').select('id').eq('user_id', req.user!.id).single();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const { data: assignment, error: checkError } = await supabase
      .from('vendor_assignments')
      .select('id')
      .eq('id', id)
      .eq('vendorId', vendor.id)
      .single();

    if (checkError || !assignment) return res.status(404).json({ message: 'Assignment not found' });

    // Update
    const { error } = await supabase
      .from('vendor_assignments')
      .update({ employeeId, status: 'ASSIGNED' })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error assigning beautician:', error);
    res.status(500).json({ success: false });
  }
});


// ==================== AT-HOME ASSIGNMENTS (PHASE 2) ====================

// 1. Get Assigned At-Home Bookings (Refactored for Robustness)
router.get('/athome-assignments', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    // 1. Get Vendor ID
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', req.user!.id)
      .single();

    if (vendorError || !vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    console.log(`Fetching at-home assignments for vendor: ${vendor.id}`);

    // 2. Find relevant Booking IDs via separate queries
    const { data: serviceJoin } = await supabase
      .from('athome_booking_services')
      .select('booking_id')
      .eq('assigned_vendor_id', vendor.id)
      .neq('status', 'REJECTED');

    const { data: productJoin } = await supabase
      .from('athome_booking_products')
      .select('booking_id')
      .eq('assigned_vendor_id', vendor.id)
      .neq('status', 'REJECTED');

    const bookingIds = Array.from(new Set([
      ...(serviceJoin?.map(s => s.booking_id) || []),
      ...(productJoin?.map(p => p.booking_id) || [])
    ]));

    if (bookingIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 3. Fetch Master Bookings
    const { data: bookingsDoc, error: bookingsError } = await supabase
      .from('athome_bookings')
      .select(`
        *,
        customer:users!athome_bookings_customer_id_fkey (first_name, last_name, phone, email)
      `)
      .in('id', bookingIds)
      .order('created_at', { ascending: false });

    if (bookingsError) throw bookingsError;
    const bookings = bookingsDoc || [];

    // 4. Fetch Child Items (Manual Join for Safety)
    // Services
    let servicesMap: Record<string, any[]> = {};
    const { data: serviceItems } = await supabase
      .from('athome_booking_services')
      .select('*, master_service:admin_services(name, category)')
      .in('booking_id', bookingIds);

    (serviceItems || []).forEach((s: any) => {
      if (!servicesMap[s.booking_id]) servicesMap[s.booking_id] = [];
      servicesMap[s.booking_id].push(s);
    });

    // Products
    let productsMap: Record<string, any[]> = {};
    const { data: productItems } = await supabase
      .from('athome_booking_products')
      .select('*, master_product:admin_products(name, category)')
      .in('booking_id', bookingIds);

    (productItems || []).forEach((p: any) => {
      if (!productsMap[p.booking_id]) productsMap[p.booking_id] = [];
      productsMap[p.booking_id].push(p);
    });

    // 5. Assemble Result
    const relevantBookings = bookings.map((b: any) => {
      const allServices = servicesMap[b.id] || [];
      const allProducts = productsMap[b.id] || [];

      // Filter for this vendor
      const myServices = allServices.filter((s: any) => s.assigned_vendor_id === vendor.id);
      const myProducts = allProducts.filter((p: any) => p.assigned_vendor_id === vendor.id);

      // Determine status
      // If any of MY items are 'ASSIGNED', then overall is 'PENDING_ACCEPTANCE'.
      // If all are 'ACCEPTED' (and check logic doesn't fail), it's 'ACCEPTED'.
      const myItems = [...myServices, ...myProducts];
      const hasPending = myItems.some((i: any) => i.status === 'ASSIGNED');
      const vendorStatus = hasPending ? 'PENDING_ACCEPTANCE' : 'ACCEPTED';

      return {
        ...b,
        myServices,
        myProducts,
        vendorStatus
      };
    });

    res.json({ success: true, data: relevantBookings });

  } catch (error: any) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assignments', error: error.message });
  }
});

// 2. Accept Assignment
router.post('/athome-assignments/:id/accept', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params; // Booking ID
    const { data: vendor } = await supabase.from('vendor').select('id').eq('user_id', req.user!.id).single();

    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    // Update Services
    await supabase
      .from('athome_booking_services')
      .update({ status: 'ACCEPTED' })
      .eq('booking_id', id)
      .eq('assigned_vendor_id', vendor.id);

    // Update Products
    await supabase
      .from('athome_booking_products')
      .update({ status: 'ACCEPTED' })
      .eq('booking_id', id)
      .eq('assigned_vendor_id', vendor.id);

    // Update Master Booking (Mark as ACCEPTED/CONFIRMED)
    // Note: In a multi-vendor scenario, we might want to check if ALL are accepted.
    // For Phase 2 simplicity, if the assigned vendor accepts, we mark the booking as progressing.
    await supabase
      .from('athome_bookings')
      .update({ status: 'ACCEPTED' })
      .eq('id', id);

    res.json({ success: true, message: 'Assignment accepted' });

  } catch (error: any) {
    console.error('Error accepting assignment:', error);
    res.status(500).json({ success: false, message: 'Failed to accept assignment' });
  }
});

// 3. Reject Assignment
router.post('/athome-assignments/:id/reject', requireAuth, requireRole(['VENDOR']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params; // Booking ID
    const { data: vendor } = await supabase.from('vendor').select('id').eq('user_id', req.user!.id).single();

    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    // Reject Services (Reset to PENDING and unassign)
    await supabase
      .from('athome_booking_services')
      .update({
        status: 'PENDING',
        assigned_vendor_id: null
      })
      .eq('booking_id', id)
      .eq('assigned_vendor_id', vendor.id);

    // Reject Products (Reset to PENDING and unassign)
    await supabase
      .from('athome_booking_products')
      .update({
        status: 'PENDING',
        assigned_vendor_id: null
      })
      .eq('booking_id', id)
      .eq('assigned_vendor_id', vendor.id);

    // Reset Master Booking to PENDING so Manager sees it again
    await supabase
      .from('athome_bookings')
      .update({ status: 'PENDING' })
      .eq('id', id);

    res.json({ success: true, message: 'Assignment rejected' });

  } catch (error: any) {
    console.error('Error rejecting assignment:', error);
    res.status(500).json({ success: false, message: 'Failed to reject assignment' });
  }
});

export default router;

