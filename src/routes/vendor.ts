import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { checkVendorApproved } from '../middleware/vendorApproval';

import { authenticate } from '../middleware/auth';

const router = Router();

// Test endpoint to verify route is working
router.get('/test', (req, res) => {
  res.json({ message: 'Vendor routes are working!' });
});

// Get vendor profile
router.get('/:vendorId/profile', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    console.log('📋 Profile Route - Vendor ID from request:', userId);

    // Validate input
    if (!userId || userId.trim() === '') {
      console.error('❌ Profile Route Error: Missing vendorId parameter');
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
        error: 'Missing vendorId parameter'
      });
    }

    let vendor;
    try {
      const { data, error } = await supabase
        .from('vendor')
        .select(`
          *,
          user:users!user_id (
            id, first_name, last_name, email, phone
          ),
          services (
            id, name, price, duration, is_active
          ),
          bookings (
            id, status, total,
            customer:users!bookings_customer_id_fkey (
              id, first_name, last_name, email
            ),
            items:booking_items (
              service:services (
                id, name, price
              )
            )
          ),
          reviews (
            id, rating, comment
          )
        `)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "no rows returned"
      vendor = data;

      console.log('✅ Profile Route - Vendor found:', vendor ? `Yes (${vendor.id})` : 'No');
    } catch (vendorError: any) {
      console.error('❌ Profile Route Error - Failed to fetch vendor:', vendorError);
      throw vendorError;
    }

    if (!vendor) {
      console.warn('⚠️ Profile Route - Vendor not found for userId:', userId);
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
        error: 'Vendor not found for the provided user ID'
      });
    }

    // Safe calculations
    const bookings = vendor.bookings || [];
    const totalBookings = bookings.length || 0;
    const completedBookings = bookings.filter((b: any) => b?.status === 'COMPLETED').length || 0;
    const totalRevenue = bookings
      .filter((b: any) => b?.status === 'COMPLETED')
      .reduce((sum: number, b: any) => {
        const total = b?.total;
        return sum + (typeof total === 'number' ? total : (typeof total === 'string' ? parseFloat(total) || 0 : 0));
      }, 0);

    // Safe average rating calculation
    const reviews = vendor.reviews || [];
    const totalReviews = reviews.length || 0;
    const averageRating = totalReviews > 0
      ? reviews.reduce((sum: number, r: any) => {
        const rating = r?.rating;
        return sum + (typeof rating === 'number' ? rating : (typeof rating === 'string' ? parseFloat(rating) || 0 : 0));
      }, 0) / totalReviews
      : 0;

    const profile = {
      id: String(vendor.id || ''),
      shopName: String(vendor.shopName || ''),
      description: vendor.description || null,
      address: String(vendor.address || ''),
      city: String(vendor.city || ''),
      state: String(vendor.state || ''),
      zipCode: String(vendor.zipCode || ''),
      status: String(vendor.status || 'PENDING'),
      emailVerified: Boolean(vendor.emailVerified),
      rejectionReason: vendor.rejectionReason || null,
      createdAt: vendor.created_at,
      updatedAt: vendor.updated_at,
      user: vendor.user ? {
        id: vendor.user.id,
        firstName: vendor.user.first_name,
        lastName: vendor.user.last_name,
        email: vendor.user.email,
        phone: vendor.user.phone
      } : null,
      services: (vendor.services || []).map((s: any) => ({
        id: String(s.id || ''),
        name: String(s.name || ''),
        price: typeof s.price === 'number' ? Number(s.price) : (typeof s.price === 'string' ? parseFloat(s.price) || 0 : 0),
        duration: typeof s.duration === 'number' ? Number(s.duration) : (typeof s.duration === 'string' ? parseInt(s.duration) || 0 : 0),
        isActive: Boolean(s.is_active !== undefined ? s.is_active : true)
      })),
      stats: {
        totalBookings: Number(totalBookings) || 0,
        completedBookings: Number(completedBookings) || 0,
        totalRevenue: Number(totalRevenue) || 0,
        averageRating: Number(averageRating) || 0,
        totalReviews: Number(totalReviews) || 0
      }
    };

    console.log('✅ Profile Route - Profile data prepared for userId:', userId, 'Status:', vendor.status);
    res.json({
      success: true,
      ...profile
    });
  } catch (error: any) {
    console.error('❌ Profile Route Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error?.message || 'Unknown error') : 'Internal server error'
    });
  }
});

// Update vendor profile
router.put('/:vendorId/profile', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    const updateData = req.body;

    // Find the vendor record first
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Update user data
    if (updateData.firstName || updateData.lastName || updateData.email || updateData.phone) {
      await supabase
        .from('users')
        .update({
          first_name: updateData.firstName,
          last_name: updateData.lastName,
          email: updateData.email,
          phone: updateData.phone
        })
        .eq('id', userId);
    }

    // Update vendor data
    const vendorUpdateData: any = {};
    if (updateData.shopName) vendorUpdateData.shopName = updateData.shopName;
    if (updateData.description) vendorUpdateData.description = updateData.description;
    if (updateData.address) vendorUpdateData.address = updateData.address;
    if (updateData.city) vendorUpdateData.city = updateData.city;
    if (updateData.state) vendorUpdateData.state = updateData.state;
    if (updateData.zipCode) vendorUpdateData.zipCode = updateData.zipCode;
    if (updateData.businessType) vendorUpdateData.businessType = updateData.businessType;
    if (updateData.yearsInBusiness) vendorUpdateData.yearsInBusiness = updateData.yearsInBusiness;
    if (updateData.numberOfEmployees) vendorUpdateData.numberOfEmployees = updateData.numberOfEmployees;

    if (Object.keys(vendorUpdateData).length > 0) {
      await supabase
        .from('vendor')
        .update(vendorUpdateData)
        .eq('id', vendor.id);
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get vendor services
router.get('/:vendorId/services', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    console.log(`📥 GET /api/vendor/${userId}/services - Fetching vendor services`);

    // Find the vendor record for this user
    let { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    console.log(`Vendor found:`, vendor ? `Yes (${vendor?.id})` : 'No');

    // Auto-create vendor record if it doesn't exist
    if (!vendor) {
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (!user || user.role !== 'VENDOR') {
        return res.status(404).json({ message: 'Vendor user not found' });
      }

      console.log(`Auto-creating vendor record for user ${user.email}`);
      const { data: newVendor, error: createError } = await supabase
        .from('vendor')
        .insert({
          user_id: user.id,
          shopName: `${user.first_name} ${user.last_name}'s Shop`,
          description: 'Please update your shop description',
          address: '123 Main Street',
          city: 'City',
          state: 'State',
          zipCode: '00000',
          latitude: 0,
          longitude: 0,
          status: 'PENDING'
        })
        .select()
        .single();

      if (createError) throw createError;
      vendor = newVendor;
    }

    if (!vendor) {
      throw new Error('Failed to find or create vendor profile');
    }

    // Fetch services
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select(`
        *,
        categories:service_category_map (
          category:service_categories (id, name)
        )
      `)
      .eq('vendor_id', vendor.id);

    if (servicesError) throw servicesError;

    // Transform services to include category name for frontend compatibility
    const servicesWithCategory = (services || []).map((service: any) => ({
      ...service,
      isActive: service.is_active,
      vendorId: service.vendor_id,
      category: service.categories && service.categories.length > 0
        ? service.categories[0].category.name
        : 'Other'
    }));

    // Fetch categories
    const { data: categories, error: categoriesError } = await supabase
      .from('service_categories')
      .select('*')
      .eq('is_active', true);

    if (categoriesError) throw categoriesError;

    const transformedCategories = (categories || []).map((c: any) => ({
      ...c,
      isActive: c.is_active
    }));

    res.json({
      services: servicesWithCategory,
      categories: transformedCategories
    });
  } catch (error) {
    console.error('Error fetching vendor services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new service
router.post('/:vendorId/services', authenticate, checkVendorApproved, async (req, res) => {
  try {
    const { vendorId: userId } = req.params; // This is actually the user ID
    const { name, description, price, duration, categoryId } = req.body;
    console.log(`📥 POST /api/vendor/${userId}/services - Creating service`);

    // Validate required fields
    if (!name || !description || !price || !categoryId) {
      return res.status(400).json({ message: 'Missing required fields: name, description, price, categoryId' });
    }

    // Find the vendor record for this user
    let { data: vendor } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    console.log(`Vendor found:`, vendor ? `Yes (${vendor?.id})` : 'No');

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Verify category exists
    const { data: category, error: categoryError } = await supabase
      .from('service_categories')
      .select('id, name')
      .eq('id', categoryId)
      .single();

    if (categoryError || !category) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    console.log(`Creating service for vendor ${vendor.id} in category ${category.name}`);
    const { data: service, error: createError } = await supabase
      .from('services')
      .insert({
        name,
        description,
        price: parseFloat(price),
        duration: parseInt(duration),
        vendor_id: vendor.id,
        is_active: true
      })
      .select()
      .single();

    if (createError) throw createError;

    // Link service to category
    const { error: linkError } = await supabase
      .from('service_category_map')
      .insert({
        service_id: service.id,
        category_id: category.id
      });

    if (linkError) {
      console.error('Error linking service to category:', linkError);
    }

    console.log(`✅ Service created: ${service.id} with category: ${category.name}`);
    res.status(201).json({
      service: {
        ...service,
        isActive: service.is_active,
        vendorId: service.vendor_id,
        category: category.name
      }
    });
  } catch (error) {
    console.error('❌ Error creating service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update service
router.put('/:vendorId/services/:serviceId', authenticate, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { name, description, price, duration, categoryId, isActive } = req.body;

    const { data: service, error: updateError } = await supabase
      .from('services')
      .update({
        name,
        description,
        price: parseFloat(price),
        duration: parseInt(duration),
        is_active: isActive !== undefined ? isActive : true
      })
      .eq('id', serviceId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update category if provided
    if (categoryId) {
      // First delete existing mapping
      await supabase
        .from('service_category_map')
        .delete()
        .eq('service_id', serviceId);

      // Create new mapping
      await supabase
        .from('service_category_map')
        .insert({
          service_id: serviceId,
          category_id: categoryId
        });
    }

    res.json({
      service: {
        ...service,
        isActive: service.is_active,
        vendorId: service.vendor_id
      }
    });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete service
router.delete('/:vendorId/services/:serviceId', authenticate, async (req, res) => {
  try {
    const { serviceId } = req.params;

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', serviceId);

    if (error) throw error;

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get vendor appointments
router.get('/:vendorId/appointments', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    const { status, limit = 50 } = req.query;

    console.log('📅 Appointments Route - Vendor ID from request:', userId);

    // Validate input
    if (!userId || userId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
        error: 'Missing vendorId parameter'
      });
    }

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
        error: 'Vendor not found for the provided user ID'
      });
    }

    // Build query safely from vendor_orders using strict user requirements
    // We reuse the existing logic but change the table and mapping

    // 1. Query vendor_orders using vendor.id
    let query = supabase
      .from('vendor_orders') // Correct table
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 50);

    // Apply status filter if present
    if (status && status !== 'all' && typeof status === 'string') {
      // Map frontend status to DB status if needed, or assume exact match
      // vendor_orders uses 'booking_status'
      query = query.eq('booking_status', status.toUpperCase());
    }

    const { data: appointments, error: appointmentsError } = await query;

    if (appointmentsError) throw appointmentsError;

    // 2. Map response to exact frontend shape
    const transformedAppointments = (appointments || []).map((appointment: any) => {
      try {
        // Parse services JSONB
        // DB stores 'services' as an array of objects
        let items: any[] = [];
        const rawServices = appointment.services;

        if (Array.isArray(rawServices)) {
          items = rawServices.map((s: any) => ({
            service: {
              name: s.name || 'Unknown Service',
              // Map other legacy Service fields if present in JSONB, defaulting safely
              price: Number(s.price || 0),
              duration: Number(s.duration || 0)
            }
          }));
        }

        return {
          id: String(appointment.id || ''),
          status: String(appointment.booking_status || 'PENDING'), // Map booking_status -> status
          scheduledDate: appointment.appointment_date, // Map appointment_date -> scheduledDate
          scheduledTime: String(appointment.appointment_time || '00:00'), // Map appointment_time -> scheduledTime
          total: Number(appointment.total_amount || 0), // Map total_amount -> total

          // Map customer fields
          customer: {
            firstName: String(appointment.customer_name || 'Guest').split(' ')[0],
            lastName: String(appointment.customer_name || '').split(' ').slice(1).join(' '),
            email: String(appointment.customer_email || ''),
            // Phone might not be in vendor_orders based on inspection, but if it is:
            phone: String(appointment.customer_phone || '')
          },

          items: items // Map services(jsonb) -> items
        };
      } catch (appointmentError: any) {
        console.error(`⚠️ Appointments Route - Error processing appointment ${appointment?.id}:`, appointmentError?.message || appointmentError);
        return null;
      }
    }).filter((appointment: any) => appointment !== null);

    res.json({
      success: true,
      appointments: transformedAppointments,
      count: transformedAppointments.length
    });
  } catch (error: any) {
    console.error('❌ Appointments Route Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error?.message || 'Unknown error') : 'Internal server error',
      appointments: [],
      count: 0
    });
  }
});

// Get vendor revenue stats
router.get('/:vendorId/revenue', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    const { range = 'month' } = req.query;

    console.log('💰 Revenue Route - Vendor ID from request:', userId);

    // Validate input
    if (!userId || userId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
        error: 'Missing vendorId parameter'
      });
    }

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
        error: 'Vendor not found for the provided user ID'
      });
    }

    // Calculate date range safely
    const now = new Date();
    let startDate: Date;

    const rangeStr = String(range || 'month').toLowerCase();
    switch (rangeStr) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default: // month
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get completed bookings in date range safely
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        *,
        items:booking_items (
          service:services (
            id, name, price
          ),
          quantity, price
        ),
        customer:users!bookings_customer_id_fkey (
          id, first_name, last_name
        )
      `)
      .eq('vendor_id', vendor.id)
      .eq('status', 'COMPLETED')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', now.toISOString());

    if (bookingsError) throw bookingsError;

    // Calculate stats safely
    const totalRevenue = (bookings || []).reduce((sum: number, b: any) => {
      const total = b?.total;
      return sum + (typeof total === 'number' ? total : (typeof total === 'string' ? parseFloat(total) || 0 : 0));
    }, 0);
    const totalBookings = bookings?.length || 0;
    const averageBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

    // Get all-time stats for comparison safely
    const { data: allTimeBookings } = await supabase
      .from('bookings')
      .select('total')
      .eq('vendor_id', vendor.id)
      .eq('status', 'COMPLETED');

    const allTimeRevenue = (allTimeBookings || []).reduce((sum: number, b: any) => {
      const total = b?.total;
      return sum + (typeof total === 'number' ? total : (typeof total === 'string' ? parseFloat(total) || 0 : 0));
    }, 0);
    const previousPeriodRevenue = allTimeRevenue - totalRevenue;
    const revenueGrowth = previousPeriodRevenue > 0
      ? ((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100
      : 0;

    // Get top services safely
    const serviceStats = new Map();
    (bookings || []).forEach((booking: any) => {
      const items = booking.items || [];
      items.forEach((item: any) => {
        const service = item?.service;
        if (!service || !service.name) return;

        const serviceName = String(service.name);
        const itemPrice = typeof service.price === 'number' ? Number(service.price) : (typeof service.price === 'string' ? parseFloat(service.price) || 0 : 0);
        const quantity = typeof item.quantity === 'number' ? Number(item.quantity) : (typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : 1);
        const itemRevenue = itemPrice * quantity;

        if (serviceStats.has(serviceName)) {
          const current = serviceStats.get(serviceName);
          serviceStats.set(serviceName, {
            revenue: (current.revenue || 0) + itemRevenue,
            bookings: (current.bookings || 0) + 1
          });
        } else {
          serviceStats.set(serviceName, {
            revenue: itemRevenue,
            bookings: 1
          });
        }
      });
    });

    const topServices = Array.from(serviceStats.entries())
      .map(([name, stats]: [string, any]) => ({
        name: String(name),
        revenue: Number(stats.revenue || 0),
        bookings: Number(stats.bookings || 0)
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Mock monthly data for chart (or calculate real if needed)
    const monthlyData = [
      { month: 'Jan', revenue: 2800, bookings: 32 },
      { month: 'Feb', revenue: 3100, bookings: 35 },
      { month: 'Mar', revenue: 4200, bookings: 45 },
      { month: 'Apr', revenue: 3800, bookings: 40 },
      { month: 'May', revenue: 5100, bookings: 55 },
      { month: 'Jun', revenue: 4800, bookings: 50 }
    ];

    res.json({
      success: true,
      totalRevenue,
      totalBookings,
      averageBookingValue,
      revenueGrowth,
      topServices,
      monthlyData
    });
  } catch (error: any) {
    console.error('❌ Revenue Route Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error?.message || 'Unknown error') : 'Internal server error'
    });
  }
});


// Get specific appointment details
router.get('/:vendorId/appointments/:appointmentId', authenticate, async (req, res) => {
  try {
    const { vendorId: userId, appointmentId } = req.params;

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('vendor_orders')
      .select('*')
      .eq('id', appointmentId)
      .eq('vendor_id', vendor.id)
      .single();

    if (appointmentError || !appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Security check: only the owner can view
    // (Already handled by .eq('vendor_id', vendor.id) in query)

    res.json({
      success: true,
      data: appointment
    });
  } catch (error: any) {
    console.error('❌ Get Appointment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Start an appointment
router.patch('/:vendorId/appointments/:appointmentId/start', authenticate, async (req, res) => {
  try {
    const { vendorId: userId, appointmentId } = req.params;

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Verify ownership and current status
    const { data: appointment, error: fetchError } = await supabase
      .from('vendor_orders')
      .select('id, booking_status')
      .eq('id', appointmentId)
      .eq('vendor_id', vendor.id)
      .single();

    if (fetchError || !appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.booking_status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: 'Only CONFIRMED appointments can be started'
      });
    }

    // Update status to STARTED
    const { data: updatedAppointment, error: updateError } = await supabase
      .from('vendor_orders')
      .update({ booking_status: 'STARTED' })
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Appointment started successfully',
      data: updatedAppointment
    });
  } catch (error: any) {
    console.error('❌ Start Appointment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get vendor financial status (Subscription & Payouts)
router.get('/:vendorId/financial-stats', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    // 1. Get Vendor
    const { data: vendor, error: vErr } = await supabase
      .from('vendor')
      .select('id, subscription_status, subscription_due_date, last_subscription_payment')
      .eq('user_id', userId)
      .single();

    if (vErr || !vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // 2. Get Subscription Info
    const subscription = {
      status: vendor.subscription_status || 'ACTIVE',
      amount: 10.00,
      dueDate: vendor.subscription_due_date || new Date().toISOString(),
      isOverdue: vendor.subscription_due_date && new Date(vendor.subscription_due_date) < new Date() && vendor.subscription_status !== 'PAID'
    };

    // 3. Get Payouts (Income received from Admin)
    const { data: payouts } = await supabase
      .from('payout_transactions')
      .select('net_paid, month, transaction_date')
      .eq('entity_id', vendor.id)
      .eq('entity_type', 'VENDOR')
      .order('transaction_date', { ascending: false });

    const totalReceived = payouts?.reduce((sum, p) => sum + (Number(p.net_paid) || 0), 0) || 0;
    const receivedThisMonth = payouts
      ?.filter(p => p.month === currentMonth)
      .reduce((sum, p) => sum + (Number(p.net_paid) || 0), 0) || 0;

    // 4. Calculate Pending Balance (Approximate for Vendor View)
    const startDate = `${currentMonth}-01`;
    const { data: orders } = await supabase
      .from('vendor_orders')
      .select('total_amount')
      .eq('vendor_id', vendor.id)
      .in('booking_status', ['CONFIRMED', 'PAID', 'COMPLETED'])
      .gte('created_at', startDate);

    const gross = orders?.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) || 0;
    const commission = gross * 0.15;
    const netPayable = gross - commission;
    const pending = netPayable - receivedThisMonth;

    res.json({
      success: true,
      data: {
        subscription,
        income: {
          total_received: totalReceived,
          this_month: receivedThisMonth,
          pending_balance: pending > 0 ? pending : 0
        },
        recent_payouts: payouts?.slice(0, 5) || []
      }
    });

  } catch (error: any) {
    console.error('Financial Stats Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
