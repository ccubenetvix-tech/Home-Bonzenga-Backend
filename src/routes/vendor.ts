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

    // Build query safely
    let query = supabase
      .from('bookings')
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (
          id, first_name, last_name, email, phone
        ),
        items:booking_items (
          *,
          service:services (
            id, name, price, duration
          )
        )
      `)
      .eq('vendor_id', vendor.id)
      .order('scheduled_date', { ascending: false })
      .limit(Number(limit) || 50);

    if (status && status !== 'all' && typeof status === 'string') {
      query = query.eq('status', status.toUpperCase());
    }

    const { data: appointments, error: appointmentsError } = await query;

    if (appointmentsError) throw appointmentsError;

    // Safe transformation of appointments
    const transformedAppointments = (appointments || []).map((appointment: any) => {
      try {
        return {
          id: String(appointment.id || ''),
          customer: appointment.customer ? {
            id: String(appointment.customer.id || ''),
            firstName: String(appointment.customer.first_name || 'Unknown'),
            lastName: String(appointment.customer.last_name || ''),
            email: String(appointment.customer.email || ''),
            phone: String(appointment.customer.phone || '')
          } : {
            id: '',
            firstName: 'Unknown',
            lastName: '',
            email: '',
            phone: ''
          },
          items: (appointment.items || []).map((item: any) => ({
            id: String(item.id || ''),
            service: item.service ? {
              id: String(item.service.id || ''),
              name: String(item.service.name || 'Service'),
              price: typeof item.service.price === 'number' ? Number(item.service.price) : (typeof item.service.price === 'string' ? parseFloat(item.service.price) || 0 : 0),
              duration: typeof item.service.duration === 'number' ? Number(item.service.duration) : (typeof item.service.duration === 'string' ? parseInt(item.service.duration) || 0 : 0)
            } : null,
            quantity: typeof item.quantity === 'number' ? Number(item.quantity) : (typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : 1),
            price: typeof item.price === 'number' ? Number(item.price) : (typeof item.price === 'string' ? parseFloat(item.price) || 0 : 0)
          })),
          scheduledDate: appointment.scheduled_date,
          scheduledTime: String(appointment.scheduled_time || '10:00 AM'),
          status: String(appointment.status || 'PENDING'),
          total: typeof appointment.total === 'number' ? Number(appointment.total) : (typeof appointment.total === 'string' ? parseFloat(appointment.total) || 0 : 0),
          notes: appointment.notes || null,
          createdAt: appointment.created_at
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

export default router;