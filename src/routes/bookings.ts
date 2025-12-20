import { Router } from 'express';
import { supabase, supabaseAnon } from '../lib/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Middleware to protect routes (simplified for demo)
const protect = (req: any, res: any, next: any) => {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // In a real app, you'd verify the token here or use Supabase auth middleware
  next();
};

const BOOKING_SELECT = `
  *,
  customer:users!customerId (
    id, firstName, lastName, email, phone
  ),
  vendor:vendor!vendorId (
    *,
    user:users!userId (
      id, firstName, lastName, email
    )
  ),
  manager:users!managerId (
    id, firstName, lastName, email
  ),
  employee:employees!employeeId (
    id, name, role, phone, email, experience, specialization
  ),
  address:addresses!addressId (*),
  serviceCatalog:service_catalog!catalogServiceId (*),
  items:booking_items (
    *,
    service:services (*),
    catalogService:service_catalog (*),
    addons:booking_item_addons (
      *,
      addon:addons (*)
    )
  ),
  products:booking_products (
    *,
    productCatalog:product_catalog (*)
  ),
  payments (*),
  events:booking_events (*)
`;

type ProductSelectionInput = {
  productCatalogId?: string;
  id?: string;
  quantity?: number;
};

type ServiceSelectionInput = {
  id: string;
  price?: number;
  quantity?: number;
};

function normaliseProductSelections(
  input?: ProductSelectionInput[] | null
): Array<{ productCatalogId: string; quantity: number }> {
  if (!Array.isArray(input)) {
    return [];
  }

  const totals = new Map<string, number>();
  for (const item of input) {
    const key = (item?.productCatalogId || item?.id || '').trim();
    if (!key) continue;
    const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
    totals.set(key, (totals.get(key) ?? 0) + quantity);
  }

  return Array.from(totals.entries()).map(([productCatalogId, quantity]) => ({
    productCatalogId,
    quantity,
  }));
}

async function resolveAddressId(
  customerId: string,
  providedAddressId?: string,
  addressPayload?: any
): Promise<string> {
  if (providedAddressId) {
    const { data: existing } = await supabase
      .from('addresses')
      .select('id')
      .eq('id', providedAddressId)
      .eq('userId', customerId)
      .single();

    if (existing) {
      return existing.id;
    }
  }

  if (addressPayload) {
    const street =
      addressPayload.street ||
      addressPayload.line1 ||
      addressPayload.addressLine1 ||
      addressPayload.address ||
      addressPayload.address1 ||
      '';
    const city =
      addressPayload.city ||
      addressPayload.town ||
      addressPayload.village ||
      addressPayload.locality ||
      '';

    if (street && city) {
      const { data: created, error } = await supabase
        .from('addresses')
        .insert({
          userId: customerId,
          name: addressPayload.name || null,
          type: addressPayload.type || 'HOME',
          street,
          city,
          state: addressPayload.state || addressPayload.stateProvince || '',
          zipCode:
            addressPayload.zipCode ||
            addressPayload.postalCode ||
            addressPayload.zip ||
            '',
          latitude:
            typeof addressPayload.latitude === 'number'
              ? addressPayload.latitude
              : null,
          longitude:
            typeof addressPayload.longitude === 'number'
              ? addressPayload.longitude
              : null,
          isDefault: false,
        })
        .select('id')
        .single();

      if (error) throw error;
      if (!created) throw new Error('Failed to create address');
      return created.id;
    }
  }

  const { data: defaultAddress } = await supabase
    .from('addresses')
    .select('id')
    .eq('userId', customerId)
    .eq('isDefault', true)
    .single();

  if (defaultAddress) {
    return defaultAddress.id;
  }

  throw new Error('address_required');
}

function computePlatformRevenue(total: number, vendorPayout?: number | null) {
  const payout = Number(vendorPayout ?? 0);
  const revenue = Number(total ?? 0) - payout;
  const safeRevenue = Number.isFinite(revenue) ? revenue : 0;
  return safeRevenue < 0 ? 0 : safeRevenue;
}

// Create At-Salon Booking
router.post('/at-salon', async (req, res) => {
  try {
    const { vendorId, customer, appointment, services, totalAmount } = req.body;

    // 1. Basic Payload Validation
    if (!vendorId) {
      return res.status(400).json({ error: 'vendorId is missing' });
    }
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ error: 'customer.name or customer.phone is missing' });
    }
    if (!appointment?.date || !appointment?.time) {
      return res.status(400).json({ error: 'appointment.date or appointment.time is missing' });
    }
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: 'services is empty or missing' });
    }
    if (totalAmount === undefined || totalAmount === null || isNaN(Number(totalAmount))) {
      return res.status(400).json({ error: 'totalAmount is missing or invalid' });
    }

    // 2. Date Validation (Next 7 days only)
    const appointmentDate = new Date(appointment.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 7);

    if (appointmentDate < today) {
      return res.status(400).json({ error: 'Cannot book for past dates' });
    }
    if (appointmentDate > maxDate) {
      return res.status(400).json({ error: 'Booking is allowed only for the next 7 days' });
    }

    // 3. Vendor & Working Hours Validation
    // Fetch vendor working hours
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('working_hours')
      .eq('id', vendorId)
      .single();

    if (vendorError || !vendor) {
      console.error('Failed to fetch vendor working hours:', vendorError);
      return res.status(404).json({ error: 'Vendor not found', details: vendorError });
    }

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = daysOfWeek[appointmentDate.getDay()];
    const workingHours = vendor.working_hours as Record<string, string> | undefined;

    if (workingHours) {
      const hoursQuote = workingHours[dayName]; // e.g., "09:00-18:00" or "Closed"

      if (!hoursQuote || hoursQuote.toLowerCase() === 'closed') {
        return res.status(400).json({ error: `Vendor is closed on ${dayName}` });
      }

      // Simple time range check if format is HH:MM-HH:MM or similar
      // For robustness, we'll try to parse if it contains proper times.
      // Assuming format "09:00 - 18:00" or similar.
      // If parsing fails, we skip strict check to avoid blocking valid bookings due to dirty data.
      // Split by '-' or space
      const times = hoursQuote.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (times && times.length >= 3) {
        const openTime = times[1];
        const closeTime = times[2];
        const bookingTime = appointment.time; // "14:30"

        if (bookingTime < openTime || bookingTime > closeTime) {
          return res.status(400).json({ error: `Booking time must be between ${openTime} and ${closeTime}` });
        }
      }
    }

    // 4. Mock Success Payment Logic
    const paymentStatus = 'PAID';
    const transactionId = `MOCK_${Date.now()}_${Math.random().toString(36).substring(7).toUpperCase()}`;

    // 5. Database Insert (vendor_orders)
    const { data, error } = await supabase
      .from('vendor_orders')
      .insert({
        vendor_id: vendorId,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email,
        appointment_date: appointment.date,
        appointment_time: appointment.time,
        notes: appointment.notes,
        services: services, // Store full JSON snapshot
        total_amount: totalAmount,
        payment_status: paymentStatus,
        payment_method: 'MOCK', // As requested
        transaction_id: transactionId,
        booking_status: 'CONFIRMED'
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert failure:', error);
      return res.status(500).json({ error: `Supabase insert failure: ${error.message}` });
    }

    // Success Response
    return res.status(200).json({
      success: true,
      bookingId: data.id
    });

  } catch (error: any) {
    console.error('Error in /at-salon:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new booking (supports at-home catalog flow and legacy vendor flow)
router.post('/', async (req, res) => {
  try {
    const {
      customerId: bodyCustomerId,
      vendorId: bodyVendorId,
      catalogServiceId,
      catalogServiceIds, // Support array of catalog service IDs
      services,
      productSelections,
      products,
      scheduledDate,
      scheduledTime,
      address,
      addressId,
      notes,
      bookingType,
      paymentMethod = 'ONLINE',
      serviceMode,
      total: providedTotal,
    } = req.body || {};

    const customerId = (bodyCustomerId || (req as AuthenticatedRequest).user?.id || '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    if (!scheduledDate || !scheduledTime) {
      return res
        .status(400)
        .json({ error: 'scheduledDate and scheduledTime are required' });
    }

    const bookingDate = new Date(scheduledDate);
    if (Number.isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledDate value' });
    }

    const timeString = String(scheduledTime);
    if (!timeString || timeString.length < 3) {
      return res.status(400).json({ error: 'Invalid scheduledTime value' });
    }

    const normalisedProducts = normaliseProductSelections(
      Array.isArray(productSelections) ? productSelections : products
    );

    // Support both single catalogServiceId and array of catalogServiceIds
    const catalogServiceIdsArray = catalogServiceIds
      ? (Array.isArray(catalogServiceIds) ? catalogServiceIds : [catalogServiceIds])
      : (catalogServiceId ? [catalogServiceId] : []);

    const isCatalogFlow = catalogServiceIdsArray.length > 0;
    const resolvedBookingType = (
      bookingType ||
      (isCatalogFlow ? 'AT_HOME' : 'SALON_VISIT')
    )
      .toString()
      .toUpperCase();

    // Start "transaction" (sequential operations)
    try {
      const addressIdResolved = await resolveAddressId(
        customerId,
        addressId,
        address
      );

      let serviceSubtotal = 0;
      let productSubtotal = 0;
      let vendorPayoutTotal = 0;
      let computedDuration = 0;
      const bookingItemsData: any[] = [];
      const bookingProductsData: any[] = [];

      if (isCatalogFlow) {
        // Handle multiple catalog services
        const { data: serviceCatalogRecords, error: catalogError } = await supabase
          .from('service_catalog')
          .select('*')
          .in('id', catalogServiceIdsArray.map(id => String(id)))
          .eq('isActive', true);

        if (catalogError) throw catalogError;
        if (!serviceCatalogRecords || serviceCatalogRecords.length !== catalogServiceIdsArray.length) {
          throw new Error('catalog_service_not_found');
        }

        // Process each catalog service
        for (const serviceCatalogRecord of serviceCatalogRecords) {
          serviceSubtotal += serviceCatalogRecord.customerPrice;
          vendorPayoutTotal += serviceCatalogRecord.vendorPayout;
          computedDuration += serviceCatalogRecord.duration || 0;

          bookingItemsData.push({
            catalogServiceId: serviceCatalogRecord.id,
            quantity: 1,
            price: serviceCatalogRecord.customerPrice,
            basePrice: serviceCatalogRecord.customerPrice,
            vendorPayout: serviceCatalogRecord.vendorPayout,
            duration: serviceCatalogRecord.duration,
            name: serviceCatalogRecord.name,
            description: serviceCatalogRecord.description,
          });
        }
      } else {
        if (!Array.isArray(services) || services.length === 0) {
          throw new Error('service_selection_required');
        }

        const serviceIds = (services as ServiceSelectionInput[])
          .map((service) => service.id)
          .filter((id) => typeof id === 'string' && id.trim().length > 0);

        if (serviceIds.length === 0) {
          throw new Error('service_selection_required');
        }

        const { data: dbServices, error: servicesError } = await supabase
          .from('services')
          .select('*')
          .in('id', serviceIds);

        if (servicesError) throw servicesError;
        if (!dbServices || dbServices.length !== serviceIds.length) {
          throw new Error('service_not_found');
        }

        dbServices.forEach((serviceRecord) => {
          const selection = (services as ServiceSelectionInput[]).find(
            (svc) => svc.id === serviceRecord.id
          );
          const quantity = Math.max(1, Number(selection?.quantity ?? 1) || 1);
          const unitPrice = Number(
            selection?.price ?? serviceRecord.price ?? 0
          );

          serviceSubtotal += unitPrice * quantity;
          computedDuration += (serviceRecord.duration || 0) * quantity;

          bookingItemsData.push({
            serviceId: serviceRecord.id,
            quantity,
            price: unitPrice * quantity,
            basePrice: unitPrice,
            duration: serviceRecord.duration,
            name: serviceRecord.name,
            description: serviceRecord.description,
          });
        });
      }

      if (normalisedProducts.length > 0) {
        const { data: productCatalogRecords, error: productsError } = await supabase
          .from('product_catalog')
          .select('*')
          .in('id', normalisedProducts.map((item) => item.productCatalogId))
          .eq('isActive', true);

        if (productsError) throw productsError;
        if (!productCatalogRecords || productCatalogRecords.length !== normalisedProducts.length) {
          throw new Error('product_not_found');
        }

        normalisedProducts.forEach((selection) => {
          const productRecord = productCatalogRecords.find(
            (record) => record.id === selection.productCatalogId
          );
          if (!productRecord) {
            return;
          }
          const quantity = Math.max(1, selection.quantity || 1);
          productSubtotal += productRecord.customerPrice * quantity;
          vendorPayoutTotal += productRecord.vendorPayout * quantity;

          bookingProductsData.push({
            productCatalogId: productRecord.id,
            quantity,
            unitPrice: productRecord.customerPrice,
            vendorPayout: productRecord.vendorPayout,
          });
        });
      }

      const subtotal = serviceSubtotal + productSubtotal;
      const total =
        Number(providedTotal) && Number(providedTotal) > 0
          ? Number(providedTotal)
          : subtotal;
      const duration =
        computedDuration || Number(req.body?.duration) || 60;

      const status = isCatalogFlow ? 'AWAITING_MANAGER' : 'PENDING';
      const vendorId =
        !isCatalogFlow && bodyVendorId ? String(bodyVendorId) : null;

      // Create Booking
      const { data: bookingRecord, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          customerId,
          vendorId,
          managerId: null,
          catalogServiceId: isCatalogFlow && catalogServiceIdsArray.length > 0
            ? String(catalogServiceIdsArray[0]) // Store first service ID for backward compatibility
            : null,
          bookingType: resolvedBookingType,
          status,
          scheduledDate: bookingDate.toISOString(),
          scheduledTime: timeString,
          duration,
          subtotal,
          discount: 0,
          tax: 0,
          total,
          serviceSubtotal,
          productSubtotal,
          vendorPayout: vendorPayoutTotal || null,
          platformRevenue: computePlatformRevenue(total, vendorPayoutTotal),
          includeProducts: bookingProductsData.length > 0,
          serviceMode: serviceMode || (isCatalogFlow ? 'WITH_PRODUCTS' : null),
          addressId: addressIdResolved,
          notes: notes || null,
          managerAssignedAt: null,
          vendorRespondedAt: null,
          beauticianAssignedAt: null,
          customerNotifiedAt: null,
        })
        .select()
        .single();

      if (bookingError) throw bookingError;
      if (!bookingRecord) throw new Error('Failed to create booking record');

      // Create Booking Items
      if (bookingItemsData.length > 0) {
        const itemsToInsert = bookingItemsData.map(item => ({
          ...item,
          bookingId: bookingRecord.id
        }));
        const { error: itemsError } = await supabase
          .from('booking_items')
          .insert(itemsToInsert);

        if (itemsError) throw itemsError;
      }

      // Create Booking Products
      if (bookingProductsData.length > 0) {
        const productsToInsert = bookingProductsData.map(item => ({
          ...item,
          bookingId: bookingRecord.id
        }));
        const { error: productsError } = await supabase
          .from('booking_products')
          .insert(productsToInsert);

        if (productsError) throw productsError;
      }

      // Create Payment
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          bookingId: bookingRecord.id,
          userId: customerId,
          amount: total,
          status: total > 0 ? 'COMPLETED' : 'PENDING',
          method: paymentMethod,
        });

      if (paymentError) throw paymentError;

      // Create Booking Event
      await supabase
        .from('booking_events')
        .insert({
          bookingId: bookingRecord.id,
          type: 'CREATED',
          data: JSON.stringify({
            createdBy: customerId,
            flow: isCatalogFlow ? 'AT_HOME' : 'DIRECT',
            includeProducts: bookingProductsData.length > 0,
          }),
        });

      // Fetch complete booking to return
      const { data: completeBooking, error: fetchError } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('id', bookingRecord.id)
        .single();

      if (fetchError) {
        console.error('Error fetching complete booking:', fetchError);
        // Return the basic record if fetch fails
        return res.status(201).json({
          message: 'Booking created successfully',
          booking: bookingRecord,
        });
      }

      res.status(201).json({
        message: 'Booking created successfully',
        booking: completeBooking,
      });

    } catch (err: any) {
      throw err;
    }

  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    console.error('Error creating booking:', error);

    if (message === 'address_required') {
      return res.status(400).json({
        error:
          'addressId is required or provide address fields (street, city)',
      });
    }
    if (message === 'catalog_service_not_found') {
      return res.status(404).json({
        error: 'Selected at-home service is no longer available',
      });
    }
    if (message === 'service_selection_required') {
      return res
        .status(400)
        .json({ error: 'Please select at least one service' });
    }
    if (message === 'service_not_found') {
      return res
        .status(404)
        .json({ error: 'One or more selected services are unavailable' });
    }
    if (message === 'product_not_found') {
      return res
        .status(404)
        .json({ error: 'One or more selected products are unavailable' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's bookings
router.get('/user/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = '10', offset = '0' } = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    let query = supabase
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('customerId', userId)
      .order('createdAt', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: bookings, error } = await query;

    if (error) throw error;

    res.json({ bookings });
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get booking by ID
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: booking, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('id', id)
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ booking });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update booking status
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const validStatuses = [
      'PENDING',
      'AWAITING_MANAGER',
      'AWAITING_VENDOR_RESPONSE',
      'AWAITING_BEAUTICIAN',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const now = new Date().toISOString();
    const updateData: any = { status };

    if (status === 'AWAITING_MANAGER') {
      updateData.vendorId = null; // disconnect vendor
      updateData.managerAssignedAt = null;
      updateData.vendorRespondedAt = null;
      updateData.beauticianAssignedAt = null;
    }
    if (status === 'AWAITING_VENDOR_RESPONSE') {
      updateData.managerAssignedAt = now;
    }
    if (status === 'CONFIRMED') {
      updateData.vendorRespondedAt = now;
    }
    if (status === 'AWAITING_BEAUTICIAN') {
      // We don't have a way to check current value easily without fetching, 
      // but we can just set it if it's null in logic, or just update it.
      // For simplicity, we'll just update it.
      // Ideally we'd check if it's already set.
    }
    if (status === 'COMPLETED') {
      updateData.customerNotifiedAt = now;
    }

    const { data: booking, error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', id)
      .select(BOOKING_SELECT)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Booking not found' });
      }
      throw error;
    }

    await supabase.from('booking_events').insert({
      bookingId: id,
      type: 'STATUS_CHANGED',
      data: JSON.stringify({
        status,
        updatedBy: (req as any)?.user?.id || null,
      }),
    });

    res.json({ booking });
  } catch (error: any) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel booking
router.patch('/:id/cancel', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const { data: booking, error } = await supabase
      .from('bookings')
      .update({
        status: 'CANCELLED',
        cancellationReason: reason || 'Cancelled by user',
      })
      .eq('id', id)
      .select(BOOKING_SELECT)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Booking not found' });
      }
      throw error;
    }

    await supabase.from('booking_events').insert({
      bookingId: booking.id,
      type: 'CANCELLED',
      data: JSON.stringify({
        reason: reason || null,
        cancelledBy: (req as any)?.user?.id || null,
      }),
    });

    res.json({ booking, message: 'Booking cancelled successfully' });
  } catch (error: any) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get booking statistics for user
router.get('/user/:userId/stats', protect, async (req, res) => {
  try {
    const { userId } = req.params;

    const activeStatuses = [
      'PENDING',
      'AWAITING_MANAGER',
      'AWAITING_VENDOR_RESPONSE',
      'AWAITING_BEAUTICIAN',
      'CONFIRMED',
      'IN_PROGRESS',
    ];

    // Parallel queries
    const [
      { count: activeBookings },
      { count: completedBookings },
      { count: pendingPayments },
      { count: totalBookings },
      { count: awaitingManager },
      { count: awaitingVendor },
      { count: awaitingBeautician },
    ] = await Promise.all([
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId)
        .in('status', activeStatuses),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId)
        .eq('status', 'COMPLETED'),
      supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('userId', userId)
        .in('status', ['PENDING', 'PROCESSING']),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId)
        .eq('status', 'AWAITING_MANAGER'),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId)
        .eq('status', 'AWAITING_VENDOR_RESPONSE'),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customerId', userId)
        .eq('status', 'AWAITING_BEAUTICIAN'),
    ]);

    res.json({
      activeBookings: activeBookings || 0,
      completedBookings: completedBookings || 0,
      pendingPayments: pendingPayments || 0,
      totalBookings: totalBookings || 0,
      awaitingManager: awaitingManager || 0,
      awaitingVendor: awaitingVendor || 0,
      awaitingBeautician: awaitingBeautician || 0,
    });
  } catch (error) {
    console.error('Error fetching booking stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
