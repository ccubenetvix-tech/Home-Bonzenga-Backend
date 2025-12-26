import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import bcrypt from 'bcryptjs';

import { supabase } from '../lib/supabase';

const router = express.Router();

// Use proper JWT authentication middleware
const protect = authenticate;

// Get admin dashboard data
router.get('/dashboard', protect, async (req, res) => {
  try {
    console.log('📊 Fetching admin dashboard data...');
    // Get comprehensive stats - fetch all data in parallel
    const [
      usersResult,
      vendorsResult,
      managersResult,
      pendingApprovalsResult,
      bookingsResult,
      completedBookingsResult,
      activeUsersResult,
      suspendedUsersResult,
      activeVendorsResult,
      pendingVendorsResult,
      employeesResult,
      paymentsResult,
      reviewsResult,
      servicesCatalogResult,
      productsCatalogResult
    ] = await Promise.all([
      supabase.from('users').select('id, role, status', { count: 'exact' }),
      supabase.from('vendor').select('id, status, shopname', { count: 'exact' }),
      supabase.from('system_credentials').select('id', { count: 'exact', head: true }).eq('role', 'MANAGER'),
      supabase.from('vendor').select('id', { count: 'exact', head: true }).in('status', ['PENDING', 'PENDING_APPROVAL']),
      supabase.from('bookings').select('id, status, total, booking_type, created_at', { count: 'exact' }),
      supabase.from('bookings').select('id, total, created_at', { count: 'exact' }).eq('status', 'COMPLETED'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'SUSPENDED'),
      supabase.from('vendor').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      supabase.from('vendor').select('id', { count: 'exact', head: true }).in('status', ['PENDING', 'PENDING_APPROVAL']),
      supabase.from('vendor_employees').select('id, role, is_active', { count: 'exact' }),
      supabase.from('payments').select('id, amount, status, refund_amount, created_at', { count: 'exact' }),
      supabase.from('reviews').select('id, rating', { count: 'exact' }),
      supabase.from('service_catalog').select('id, is_active', { count: 'exact' }),
      supabase.from('product_catalog').select('id, is_active', { count: 'exact' })
    ]);

    // Extract counts and data (handle errors gracefully for optional tables)
    const totalUsers = usersResult.count ?? usersResult.data?.length ?? 0;
    const totalVendors = vendorsResult.count ?? vendorsResult.data?.length ?? 0;
    const totalManagers = managersResult.count ?? 0;
    const pendingApprovals = pendingApprovalsResult.count ?? 0;
    const totalBookings = bookingsResult.count ?? bookingsResult.data?.length ?? 0;
    const completedBookings = completedBookingsResult.count ?? completedBookingsResult.data?.length ?? 0;
    const activeUsers = activeUsersResult.count ?? 0;
    const suspendedUsers = suspendedUsersResult.count ?? 0;
    const activeVendors = activeVendorsResult.count ?? 0;
    const pendingVendors = pendingVendorsResult.count ?? 0;
    // Handle optional tables that might not exist
    const totalEmployees = employeesResult.error ? 0 : (employeesResult.count ?? employeesResult.data?.length ?? 0);
    const totalPayments = paymentsResult.error ? 0 : (paymentsResult.count ?? paymentsResult.data?.length ?? 0);
    const totalReviews = reviewsResult.error ? 0 : (reviewsResult.count ?? reviewsResult.data?.length ?? 0);
    const totalCatalogServices = servicesCatalogResult.error ? 0 : (servicesCatalogResult.count ?? servicesCatalogResult.data?.length ?? 0);
    const totalCatalogProducts = productsCatalogResult.error ? 0 : (productsCatalogResult.count ?? productsCatalogResult.data?.length ?? 0);

    // Process bookings data
    const bookings = bookingsResult.data || [];
    const atHomeBookings = bookings.filter(b => b?.booking_type === 'AT_HOME' || (!b?.booking_type && b?.status)).length;
    const salonBookings = bookings.filter(b => b?.booking_type === 'SALON_VISIT').length;

    // Calculate revenue from completed bookings
    const completedBookingsData = completedBookingsResult.data || [];
    const totalRevenue = completedBookingsData.reduce((sum, b) => sum + (Number(b?.total) || 0), 0);

    // Monthly revenue (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthlyRevenue = completedBookingsData
      .filter(b => {
        if (b?.created_at) {
          try {
            const bookingDate = new Date(b.created_at);
            return bookingDate >= thirtyDaysAgo;
          } catch {
            return false;
          }
        }
        return false;
      })
      .reduce((sum, b) => sum + (Number(b?.total) || 0), 0);

    // Process payments for pending payouts and refunds (handle missing table)
    const payments = paymentsResult.error ? [] : (paymentsResult.data || []);
    const pendingPayouts = payments
      .filter(p => p?.status === 'PENDING')
      .reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
    const refundRequests = payments.filter(p => p?.refund_amount && Number(p.refund_amount) > 0).length;

    // Calculate average rating (handle missing table)
    const reviews = reviewsResult.error ? [] : (reviewsResult.data || []);
    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (Number(r?.rating) || 0), 0) / reviews.length
      : 0;

    // Process catalog stats (handle missing tables)
    const servicesCatalog = servicesCatalogResult.error ? [] : (servicesCatalogResult.data || []);
    const activeCatalogServices = servicesCatalog.filter(s => s?.is_active === true).length;
    const productsCatalog = productsCatalogResult.error ? [] : (productsCatalogResult.data || []);
    const activeCatalogProducts = productsCatalog.filter(p => p?.is_active === true).length;

    const stats = {
      totalUsers,
      totalVendors,
      totalManagers,
      pendingApprovals,
      totalRevenue,
      monthlyRevenue,
      pendingPayouts,
      refundRequests,
      activeUsers,
      suspendedUsers,
      activeVendors,
      pendingVendors,
      totalBookings,
      completedBookings,
      atHomeBookings,
      salonBookings,
      totalCommissions: totalRevenue * 0.15, // 15% commission
      pendingDisputes: 0, // Mock data - add disputes table later
      averageRating,
      totalCatalogServices,
      activeCatalogServices,
      totalCatalogProducts,
      activeCatalogProducts
    };

    // Get pending vendors with user details
    const pendingVendorIds = (vendorsResult.data || [])
      .filter(v => v.status === 'PENDING' || v.status === 'PENDING_APPROVAL')
      .map(v => v.id);
    let pendingVendorsList: any[] = [];
    if (pendingVendorIds.length > 0) {
      const { data: vendorsWithUsers } = await supabase
        .from('vendor')
        .select(`
          id,
          shopname,
          status,
          created_at,
          user_id,
          users!vendor_user_id_fkey (
            first_name,
            last_name,
            email,
            phone
          )
        `)
        .in('id', pendingVendorIds)
        .limit(10);

      if (vendorsWithUsers) {
        pendingVendorsList = vendorsWithUsers.map((v: any) => ({
          id: v.id,
          shopname: v.shopname || 'Unknown',
          status: v.status || 'PENDING',
          created_at: v.created_at || new Date().toISOString(),
          user: v.users ? {
            first_name: v.users.first_name || 'Unknown',
            last_name: v.users.last_name || '',
            email: v.users.email || '',
            phone: v.users.phone || ''
          } : {
            first_name: 'Unknown',
            last_name: '',
            email: '',
            phone: ''
          }
        }));
      }
    }

    // Get top vendors by revenue (only approved vendors)
    const { data: topVendorsData } = await supabase
      .from('vendor')
      .select(`
        id, shopname, status,
        user_id,
        users!vendor_user_id_fkey (first_name, last_name, email),
        bookings (total, status)
      `)
      .eq('status', 'APPROVED')
      .limit(20);

    const topVendorsWithStats = (topVendorsData || [])
      .map((vendor: any) => {
        const completedBookings = vendor.bookings?.filter((b: any) => b.status === 'COMPLETED') || [];
        const totalRevenue = completedBookings.reduce((sum: number, booking: any) => sum + (Number(booking.total) || 0), 0);

        return {
          id: vendor.id,
          shopName: vendor.shopname,
          shopname: vendor.shopname, // Support both formats
          totalBookings: completedBookings.length,
          totalRevenue: totalRevenue,
          averageRating: 4.5, // Will be calculated from reviews later
          status: vendor.status,
          owner: vendor.users ? `${vendor.users.first_name} ${vendor.users.last_name}` : 'Unknown'
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    // Get recent bookings for activity
    const recentBookings = bookings
      .filter(b => b.created_at)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

    const activities = recentBookings.map((booking: any) => ({
      id: booking.id,
      type: booking.status === 'COMPLETED' ? 'booking_completed' :
        booking.status === 'CANCELLED' ? 'booking_cancelled' : 'payment_processed',
      description: `Booking ${(booking.status || 'PENDING').toLowerCase()}`,
      timestamp: booking.created_at || new Date().toISOString(),
      bookingType: booking.booking_type || 'AT_HOME',
      status: booking.status === 'COMPLETED' ? 'success' :
        booking.status === 'CANCELLED' ? 'cancelled' : 'pending'
    }));

    console.log('✅ Admin dashboard data fetched successfully');
    res.json({
      success: true,
      stats,
      recentActivity: activities,
      topVendors: topVendorsWithStats,
      pendingVendors: pendingVendorsList
    });
  } catch (error: any) {
    console.error('Error fetching admin dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all users
router.get('/users', protect, async (req, res) => {
  try {
    console.log('📋 Fetching all users for admin...');

    // Fetch users first
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (usersError) throw usersError;

    console.log(`✅ Found ${users?.length || 0} users`);

    // Fetch bookings separately to avoid relationship ambiguity
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('customer_id, total, status');

    if (bookingsError) {
      console.warn('Warning: Could not fetch bookings:', bookingsError.message);
    }

    // Group bookings by customer_id
    const bookingsByCustomer = new Map<string, { total: number; count: number }>();
    (bookings || []).forEach((booking: any) => {
      const customerId = booking.customer_id;
      if (!bookingsByCustomer.has(customerId)) {
        bookingsByCustomer.set(customerId, { total: 0, count: 0 });
      }
      const stats = bookingsByCustomer.get(customerId)!;
      stats.count += 1;
      if (booking.status === 'COMPLETED') {
        stats.total += Number(booking.total) || 0;
      }
    });

    const usersWithStats = (users || []).map((user: any) => {
      const bookingStats = bookingsByCustomer.get(user.id) || { total: 0, count: 0 };
      return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone || null,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: null, // Not available in current schema
        totalBookings: bookingStats.count,
        totalSpent: bookingStats.total,
        isVerified: user.status === 'ACTIVE' // Consider active users as verified
      };
    });

    res.json({
      success: true,
      users: usersWithStats
    });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update user status
router.patch('/users/:userId/status', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .update({ status })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'User status updated successfully',
      user: {
        ...user,
        firstName: user.first_name,
        lastName: user.last_name
      }
    });
  } catch (error: any) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all vendors with comprehensive data
router.get('/vendors', protect, async (req, res) => {
  try {
    console.log('📋 Fetching all vendors for admin...');

    // Fetch vendors first without relationship to avoid foreign key issues
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendor')
      .select('*')
      .order('created_at', { ascending: false });

    if (vendorsError) {
      console.error('❌ Error fetching vendors:', vendorsError);
      throw vendorsError;
    }

    console.log(`✅ Found ${vendors?.length || 0} vendors`);

    // Fetch bookings separately
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('vendor_id, total, status');

    if (bookingsError) {
      console.warn('Warning: Could not fetch bookings:', bookingsError.message);
    }

    // Fetch user details for all vendors
    const vendorUserIds = (vendors || []).map((v: any) => v.user_id).filter(Boolean);
    let usersMap = new Map();
    if (vendorUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, phone')
        .in('id', vendorUserIds);
      if (!usersError && users) {
        users.forEach((u: any) => {
          usersMap.set(u.id, {
            firstName: u.first_name || '',
            lastName: u.last_name || '',
            email: u.email || '',
            phone: u.phone || ''
          });
        });
      }
    }

    // Fetch services, products, employees separately for each vendor
    const vendorsWithStats = await Promise.all(
      (vendors || []).map(async (vendor: any) => {
        // Get bookings for this vendor
        const vendorBookings = (bookings || []).filter((b: any) => b.vendor_id === vendor.id);
        const completedBookings = vendorBookings.filter((b: any) => b.status === 'COMPLETED');
        const totalRevenue = completedBookings.reduce((sum: number, booking: any) => sum + (Number(booking.total) || 0), 0);

        // Get user info from map
        const userInfo = usersMap.get(vendor.user_id) || {
          firstName: '',
          lastName: '',
          email: '',
          phone: ''
        };

        // Try to fetch services, products, employees (handle errors gracefully)
        let servicesCount = 0;
        let productsCount = 0;
        let employeesCount = 0;

        try {
          const { count: services } = await supabase
            .from('vendor_services')
            .select('*', { count: 'exact', head: true })
            .eq('vendor_id', vendor.id);
          servicesCount = services || 0;
        } catch (e) {
          // Services table might not exist or have different structure
        }

        try {
          const { count: products } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('vendor_id', vendor.id);
          productsCount = products || 0;
        } catch (e) {
          // Products table might not exist or have different structure
        }

        try {
          const { count: employees } = await supabase
            .from('vendor_employees')
            .select('*', { count: 'exact', head: true })
            .eq('vendor_id', vendor.id);
          employeesCount = employees || 0;
        } catch (e) {
          // Employees table might not exist or have different structure
        }

        return {
          id: vendor.id,
          shopname: vendor.shopname || vendor.shopName || '',
          shopName: vendor.shopname || vendor.shopName || '', // Support both formats
          description: vendor.description || '',
          businessType: vendor.business_type || 'salon', // Use actual business type if available
          address: vendor.address || '',
          city: vendor.city || '',
          state: vendor.state || '',
          zipCode: vendor.zip_code || vendor.zipCode || '',
          status: vendor.status,
          isVerified: vendor.status === 'APPROVED',
          user: userInfo,
          createdAt: vendor.created_at,
          approvedAt: vendor.status === 'APPROVED' ? vendor.updated_at : null,
          services: [],
          products: [],
          employees: [],
          stats: {
            totalServices: servicesCount,
            totalProducts: productsCount,
            totalEmployees: employeesCount,
            totalBookings: vendorBookings.length,
            completedBookings: completedBookings.length,
            totalRevenue: totalRevenue,
            averageRating: 4.5, // Will be calculated from reviews later
            totalReviews: Math.floor(completedBookings.length * 0.8)
          }
        };
      })
    );

    res.json({
      success: true,
      vendors: vendorsWithStats
    });
  } catch (error: any) {
    console.error('❌ Error fetching vendors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update vendor status
router.patch('/vendors/:vendorId/status', protect, async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status, reason } = req.body;

    // Get vendor with user details before updating
    const { data: vendorBefore, error: fetchError } = await supabase
      .from('vendor')
      .select(`
        *,
        user:users!vendor_user_id_fkey (email, first_name, last_name)
      `)
      .eq('id', vendorId)
      .single();

    if (fetchError || !vendorBefore) {
      // Try alternate foreign key if the first one fails
      const { data: vendorBeforeAlt, error: fetchErrorAlt } = await supabase
        .from('vendor')
        .select(`
            *,
            user:users!user_id (email, first_name, last_name)
        `)
        .eq('id', vendorId)
        .single();

      if (fetchErrorAlt || !vendorBeforeAlt) {
        return res.status(404).json({ message: 'Vendor not found' });
      }
      // Use the alternate result
      // @ts-ignore
      vendorBefore = vendorBeforeAlt;
    }

    // Update vendor status
    const { data: vendor, error: updateError } = await supabase
      .from('vendor')
      .update({ status })
      .eq('id', vendorId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Send email notification based on status change
    if (status === 'APPROVED' && vendorBefore.status !== 'APPROVED') {
      // Send approval email
      /*
      sendVendorApprovalNotification({
        email: vendorBefore.user.email,
        shopName: vendorBefore.shopname || vendorBefore.shopName || 'Unknown',
        ownerName: `${vendorBefore.user.first_name} ${vendorBefore.user.last_name}`
      }).catch((err: any) => {
        console.error('Failed to send approval notification email:', err);
      });
      */
    } else if (status === 'REJECTED' && vendorBefore.status !== 'REJECTED') {
      // Send rejection email
      /*
      sendVendorRejectionNotification({
        email: vendorBefore.user.email,
        shopName: vendorBefore.shopname || vendorBefore.shopName || 'Unknown',
        ownerName: `${vendorBefore.user.first_name} ${vendorBefore.user.last_name}`,
        reason: reason || 'Your application did not meet our requirements at this time.'
      }).catch((err: any) => {
        console.error('Failed to send rejection notification email:', err);
      });
      */
    }

    res.json({
      success: true,
      message: 'Vendor status updated successfully',
      vendor
    });
  } catch (error: any) {
    console.error('Error updating vendor status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get vendor details by ID
router.get('/vendors/:vendorId', protect, async (req, res) => {
  try {
    const { vendorId } = req.params;

    // Fetch vendor details with user
    // Try primary FK
    let { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select(`
        *,
        user:users!vendor_user_id_fkey (first_name, last_name, email, phone)
      `)
      .eq('id', vendorId)
      .single();

    if (vendorError) {
      // Fallback to user_id FK
      const { data: vendorAlt, error: vendorErrorAlt } = await supabase
        .from('vendor')
        .select(`
            *,
            user:users!user_id (first_name, last_name, email, phone)
        `)
        .eq('id', vendorId)
        .single();

      if (vendorErrorAlt || !vendorAlt) {
        return res.status(404).json({ message: 'Vendor not found' });
      }
      vendor = vendorAlt;
    }

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Fetch comprehensive data in parallel
    const [servicesRes, productsRes, employeesRes, bookingsRes, completedBookingsRes] = await Promise.all([
      // Try 'services' table first (primary source)
      supabase
        .from('services')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false }),

      supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false }),

      supabase
        .from('vendor_employees')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false }),

      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', vendorId),

      supabase
        .from('bookings')
        .select('total')
        .eq('vendor_id', vendorId)
        .eq('status', 'COMPLETED')
    ]);

    const totalRevenue = (completedBookingsRes.data || []).reduce((sum, b) => sum + (Number(b.total) || 0), 0);

    // Debug: Log services query results
    if (servicesRes.error) {
      console.error(`❌ Error fetching services for vendor ${vendorId} from 'services' table:`, servicesRes.error);
    }
    console.log(`🔍 Services query for vendor ${vendorId}:`, {
      hasError: !!servicesRes.error,
      error: servicesRes.error?.message,
      dataCount: servicesRes.data?.length || 0,
      vendorId: vendorId
    });

    // Handle service data and fallback
    let servicesData = servicesRes.data || [];

    // Fallback: If 'services' table returned no data (or error), check 'vendor_services'
    if (servicesData.length === 0) {
      console.log(`⚠️ No services found in 'services' table, trying 'vendor_services' (legacy)...`);
      const { data: servicesFallback, error: servicesFallbackError } = await supabase
        .from('vendor_services')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('updated_at', { ascending: false });

      if (!servicesFallbackError && servicesFallback && servicesFallback.length > 0) {
        console.log(`✅ Found ${servicesFallback.length} services in 'vendor_services' table`);
        servicesData = servicesFallback.map((s: any) => ({
          ...s,
          // Map legacy fields to match 'services' schema if needed
          duration: s.duration_minutes || s.duration,
          isActive: s.is_active,
          category: s.category || 'General'
        }));
      } else if (servicesFallbackError) {
        console.warn(`⚠️ Failed to fetch from 'vendor_services':`, servicesFallbackError.message);
      }
    }

    // Format services - handle both vendor_services and services table schemas
    const services = servicesData.map((service: any) => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      price: service.price,
      // Handle both duration_minutes (vendor_services) and duration (services)
      duration: service.duration_minutes || service.duration || 60,
      category: service.category || service.category_id || 'general',
      isActive: service.is_active !== undefined ? service.is_active : (service.isActive !== undefined ? service.isActive : true),
      // Handle both image_url (vendor_services) and image (services)
      imageUrl: service.image_url || service.image || null,
      createdAt: service.created_at || service.createdAt
    }));

    // Format products
    const products = (productsRes.data || []).map((product: any) => ({
      id: product.id,
      name: product.product_name,
      category: product.category_id,
      price: product.price_cdf,
      stock: product.stock_quantity,
      description: product.description,
      imageUrl: product.image_url,
      isActive: product.is_active,
      createdAt: product.created_at
    }));

    // Format employees
    const employees = (employeesRes.data || []).map((emp: any) => ({
      id: emp.id,
      name: emp.name,
      role: emp.role,
      phone: emp.phone,
      experienceYears: emp.experience_years,
      specialization: emp.specialization,
      is_active: emp.is_active,
      createdAt: emp.created_at
    }));

    const vendorDetails = {
      id: vendor.id,
      shopName: vendor.shopname || vendor.shopName || '',
      description: vendor.description || '',
      address: vendor.address || '',
      city: vendor.city || '',
      state: vendor.state || '',
      zipCode: vendor.zip_code || vendor.zipCode || '',
      status: vendor.status,
      isVerified: vendor.status === 'APPROVED',
      createdAt: vendor.created_at,
      approvedAt: vendor.status === 'APPROVED' ? vendor.updated_at : null,
      user: {
        firstName: vendor.user?.first_name || '',
        lastName: vendor.user?.last_name || '',
        email: vendor.user?.email || '',
        phone: vendor.user?.phone || ''
      },
      stats: {
        totalServices: services.length,
        totalProducts: products.length,
        totalEmployees: employees.length,
        totalBookings: bookingsRes.count || 0,
        completedBookings: completedBookingsRes.data?.length || 0,
        totalRevenue,
        averageRating: 4.5, // Mock for now
        totalReviews: 0 // Mock for now
      },
      businessType: vendor.business_type || 'salon'
    };

    res.json({
      success: true,
      vendor: vendorDetails,
      services,
      products,
      employees
    });
  } catch (error: any) {
    console.error('Error fetching vendor details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Delete vendor
router.delete('/vendors/:vendorId', protect, async (req, res) => {
  try {
    const { vendorId } = req.params;

    const { error } = await supabase
      .from('vendor')
      .delete()
      .eq('id', vendorId);

    if (error) throw error;

    res.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get all managers
router.get('/managers', protect, async (req, res) => {
  try {
    console.log('📋 Fetching all managers for admin...');

    const { data: managers, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'MANAGER')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`✅ Found ${managers?.length || 0} managers`);

    // Calculate real stats for each manager
    const managersWithStats = await Promise.all(
      (managers || []).map(async (manager: any) => {
        let vendorsApproved = 0;
        let vendorsRejected = 0;
        let appointmentsManaged = 0;

        try {
          // Count vendors approved/rejected (total counts, not per manager - can be enhanced later)
          const approvedResult = await supabase
            .from('vendor')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'APPROVED');
          vendorsApproved = approvedResult.count || 0;
        } catch (error) {
          console.warn('Error counting approved vendors:', error);
          vendorsApproved = 0;
        }

        try {
          const rejectedResult = await supabase
            .from('vendor')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'REJECTED');
          vendorsRejected = rejectedResult.count || 0;
        } catch (error) {
          console.warn('Error counting rejected vendors:', error);
          vendorsRejected = 0;
        }

        try {
          // Count bookings managed by this manager
          const bookingsResult = await supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('manager_id', manager.id);
          appointmentsManaged = bookingsResult.count || 0;
        } catch (error) {
          console.warn('Error counting manager bookings:', error);
          appointmentsManaged = 0;
        }

        return {
          id: manager.id,
          firstName: manager.first_name,
          lastName: manager.last_name,
          email: manager.email,
          phone: manager.phone || null,
          status: manager.status,
          createdAt: manager.created_at,
          lastLoginAt: null, // Not available in current schema
          isVerified: manager.status === 'ACTIVE',
          stats: {
            vendorsApproved: vendorsApproved,
            vendorsRejected: vendorsRejected,
            appointmentsManaged: appointmentsManaged,
            totalActions: vendorsApproved + vendorsRejected + appointmentsManaged
          }
        };
      })
    );

    res.json({
      success: true,
      managers: managersWithStats
    });
  } catch (error: any) {
    console.error('Error fetching managers:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update manager status
router.patch('/managers/:managerId/status', protect, async (req, res) => {
  try {
    const { managerId } = req.params;
    const { status } = req.body;

    const { data: manager, error } = await supabase
      .from('users')
      .update({ status })
      .eq('id', managerId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Manager status updated successfully',
      manager: {
        ...manager,
        firstName: manager.first_name,
        lastName: manager.last_name
      }
    });
  } catch (error) {
    console.error('Error updating manager status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get settings
router.get('/settings', protect, async (req, res) => {
  try {
    // Mock settings data
    const settings = {
      platformName: 'Home Bonzenga',
      platformDescription: 'Premium Beauty Services Platform',
      supportEmail: 'support@homebonzenga.com',
      supportPhone: '+243 123 456 789',
      platformAddress: 'Kinshasa, DR Congo',
      timezone: 'Africa/Kinshasa',
      defaultCommissionRate: 15,
      minimumPayoutAmount: 50,
      maximumPayoutAmount: 10000,
      payoutProcessingDays: 7,
      allowUserRegistration: true,
      requireEmailVerification: true,
      allowVendorRegistration: true,
      requireVendorApproval: true,
      emailNotifications: true,
      smsNotifications: false,
      pushNotifications: true,
      maintenanceMode: false,
      debugMode: false,
      autoBackup: true,
      backupFrequency: 'daily'
    };

    res.json({ settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update settings
router.put('/settings', protect, async (req, res) => {
  try {
    const { settings } = req.body;

    // Mock update
    res.json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get admin profile
router.get('/profile', protect, async (req, res) => {
  try {
    // For demo purposes, return mock profile data
    // In production, fetch from database using req.user.id
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: totalVendors } = await supabase.from('vendor').select('*', { count: 'exact', head: true });
    const { count: totalManagers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'MANAGER');
    const { count: totalBookings } = await supabase.from('bookings').select('*', { count: 'exact', head: true });

    const adminProfile = {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@homebonzenga.com',
      role: 'ADMIN',
      totalUsers: totalUsers || 0,
      totalVendors: totalVendors || 0,
      totalManagers: totalManagers || 0,
      totalBookings: totalBookings || 0,
      createdAt: new Date()
    };

    res.json(adminProfile);
  } catch (error) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update admin profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;

    // In production, update database using req.user.id
    // For demo, just return success
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get access logs with filtering
router.get('/access-logs', protect, async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      role,
      success,
      method,
      email,
      page = '1',
      limit = '50'
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    let query = supabase
      .from('access_log')
      .select(`
        *,
        user:users!user_id (
          id, email, first_name, last_name, role
        )
      `, { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(skip, skip + limitNum - 1);

    if (startDate) query = query.gte('timestamp', new Date(startDate as string).toISOString());
    if (endDate) query = query.lte('timestamp', new Date(endDate as string).toISOString());
    if (role) query = query.eq('role_attempted', role);
    if (success !== undefined) query = query.eq('success', success === 'true');
    if (method) query = query.eq('method', method);
    if (email) query = query.ilike('email_attempted', `%${email}%`);

    const { data: logs, count, error } = await query;

    if (error) throw error;

    const transformedLogs = (logs || []).map((log: any) => ({
      ...log,
      user: log.user ? {
        id: log.user.id,
        email: log.user.email,
        firstName: log.user.first_name,
        lastName: log.user.last_name,
        role: log.user.role
      } : null,
      emailAttempted: log.email_attempted,
      roleAttempted: log.role_attempted,
      ipAddress: log.ip_address,
      userAgent: log.user_agent
    }));

    res.json({
      logs: transformedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error('Error fetching access logs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== SERVICE MANAGEMENT (PLATFORM CATALOG) ====================

// Helper for slug generation
const ensureSlug = (value: string | undefined | null) => {
  if (value && value.trim().length > 0) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  return `service-${randomSuffix}`;
};

// Get all platform services (Admin)
router.get('/services', protect, async (req, res) => {
  try {
    const { data: services, error } = await supabase
      .from('service_catalog')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    // Transform to match frontend expectations
    const transformedServices = (services || []).map((service: any) => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      price: service.customer_price, // Frontend expects price
      vendorPayout: service.vendor_payout,
      duration: service.duration,
      duration_minutes: service.duration, // Backward compatibility
      category: service.category,
      isActive: service.is_active,
      imageUrl: service.icon, // Frontend expects imageUrl
      allowsProducts: service.allows_products
    }));

    res.json({
      success: true,
      services: transformedServices
    });
  } catch (error: any) {
    console.error('Error fetching admin services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch services' });
  }
});

// Create new service (Admin)
router.post('/services', protect, async (req, res) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }

    const { name, description, price, duration, category, isActive, imageUrl, vendorPayout, allowsProducts } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Name and price are required' });
    }

    // Default vendor payout to 85% if not specified
    const computedVendorPayout = vendorPayout !== undefined ? parseFloat(vendorPayout) : (parseFloat(price) * 0.85);

    const { data: service, error } = await supabase
      .from('service_catalog')
      .insert({
        name,
        slug: ensureSlug(name),
        description,
        customer_price: parseFloat(price),
        vendor_payout: computedVendorPayout,
        duration: parseInt(duration) || 60,
        category,
        is_active: isActive !== undefined ? isActive : true,
        icon: imageUrl,
        allows_products: allowsProducts || false
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      service
    });
  } catch (error: any) {
    console.error('Error creating service:', error);
    res.status(500).json({ success: false, message: 'Failed to create service' });
  }
});

// Update service details (Admin)
router.put('/services/:serviceId', protect, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { name, description, price, duration, category, isActive, imageUrl, vendorPayout, allowsProducts } = req.body;

    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }

    console.log(`✏️ Admin updating catalog service: ${serviceId}`);

    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description;
    if (price !== undefined) updatePayload.customer_price = parseFloat(price);
    if (vendorPayout !== undefined) updatePayload.vendor_payout = parseFloat(vendorPayout);
    if (duration !== undefined) updatePayload.duration = parseInt(duration);
    if (category !== undefined) updatePayload.category = category;
    if (isActive !== undefined) updatePayload.is_active = isActive;
    if (imageUrl !== undefined) updatePayload.icon = imageUrl;
    if (allowsProducts !== undefined) updatePayload.allows_products = allowsProducts;

    const { data: service, error } = await supabase
      .from('service_catalog')
      .update(updatePayload)
      .eq('id', serviceId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Service updated successfully',
      service
    });
  } catch (error: any) {
    console.error('Error updating service:', error);
    res.status(500).json({ success: false, message: 'Failed to update service' });
  }
});

// Toggle service status (Admin)
router.patch('/services/:serviceId/toggle', protect, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { isActive } = req.body; // Expecting boolean

    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }

    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive status required' });
    }

    console.log(`🔄 Admin toggling catalog service ${serviceId} to ${isActive}`);

    const { data: service, error } = await supabase
      .from('service_catalog')
      .update({ is_active: isActive })
      .eq('id', serviceId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: `Service ${isActive ? 'activated' : 'deactivated'} successfully`,
      service
    });
  } catch (error: any) {
    console.error('Error toggling service:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle service status' });
  }
});

// Delete service (Admin)
router.delete('/services/:serviceId', protect, async (req, res) => {
  try {
    const { serviceId } = req.params;

    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }

    console.log(`🗑️ Admin deleting catalog service: ${serviceId}`);

    // Clean up relations first if needed (should cascade but being safe matching existing patterns)
    // For service_catalog, we might have service_catalog_products
    await supabase.from('service_catalog_products').delete().eq('service_catalog_id', serviceId);

    const { error } = await supabase
      .from('service_catalog')
      .delete()
      .eq('id', serviceId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting service:', error);
    res.status(500).json({ success: false, message: 'Failed to delete service' });
  }
});





// ==================== AT-HOME SERVICES – PHASE 1 (ADMIN) ====================

/**
 * @api {get} /api/admin/vendor-catalog/services Get Vendor Services Reference
 * @apiDescription Admin must: 1. See all vendor services (read-only reference)
 */
router.get('/vendor-catalog/services', protect, async (req, res) => {
  try {
    console.log('🔍 Fetching all vendor services as reference...');

    // Joint logic: FROM vendor_services JOIN vendors ONLY to get vendor.shop_name
    const { data: services, error } = await supabase
      .from('vendor_services')
      .select(`
        name,
        category,
        price,
        duration_minutes,
        vendor:vendor!vendor_id (shopname)
      `);

    if (error) {
      console.error('❌ Supabase error fetching vendor services:', error);
      throw error;
    }

    // Response structure as requested: [{ name, category, price, duration_minutes, vendor_name }]
    const response = (services || []).map((s: any) => ({
      name: s.name,
      category: s.category,
      price: s.price,
      duration_minutes: s.duration_minutes,
      vendor_name: s.vendor?.shopname || 'Unknown Vendor'
    }));

    res.json(response);
  } catch (error: any) {
    console.error('SERVER ERROR (Vendor Catalog Services):', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor services catalog',
      error: error.message
    });
  }
});

/**
 * @api {get} /api/admin/vendor-catalog/products Get Vendor Products Reference
 * @apiDescription Admin must: 2. See all vendor products (read-only reference)
 */
router.get('/vendor-catalog/products', protect, async (req, res) => {
  try {
    console.log('🔍 Fetching all vendor products as reference...');

    // Logic: FROM products JOIN vendors to get shop_name
    // Using mapping for product name/price based on existing schema observed in admin.ts
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        product_name,
        price_cdf,
        vendor:vendor!vendor_id (shopname)
      `);

    if (error) {
      console.error('❌ Supabase error fetching vendor products:', error);
      throw error;
    }

    // SELECT: product name, price, vendor.shop_name
    const response = (products || []).map((p: any) => ({
      name: p.product_name || 'Unnamed Product',
      price: p.price_cdf || 0,
      vendor_name: p.vendor?.shopname || 'Unknown Vendor'
    }));

    res.json(response);
  } catch (error: any) {
    console.error('SERVER ERROR (Vendor Catalog Products):', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor products catalog',
      error: error.message
    });
  }
});

/**
 * @api {get} /api/admin/athome/services Get Admin's Master Catalog of Services
 */
router.get('/athome/services', protect, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_services')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching master services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch master service catalog' });
  }
});

/**
 * @api {post} /api/admin/athome/services Add new Master At-Home Service
 */
router.post('/athome/services', protect, async (req, res) => {
  try {
    const { name, description, category, price, duration_minutes, image_url, is_active } = req.body;

    // Insert ONLY into admin_services
    // NEVER reference vendor tables
    const { data, error } = await supabase
      .from('admin_services')
      .insert([{
        name,
        description,
        category,
        price: Number(price),
        duration_minutes: Number(duration_minutes),
        image_url,
        is_active: is_active ?? true
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    console.error('Error creating master service:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create service in master catalog',
      error: error.message
    });
  }
});

/**
 * @api {get} /api/admin/athome/products Get Admin's Master Catalog of Products
 */
router.get('/athome/products', protect, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching master products:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch master product catalog' });
  }
});

/**
 * @api {post} /api/admin/athome/products Add new Master At-Home Product
 */
router.post('/athome/products', protect, async (req, res) => {
  try {
    const { name, description, price, image_url, is_active } = req.body;

    // Insert ONLY into admin_products
    const { data, error } = await supabase
      .from('admin_products')
      .insert([{
        name,
        description,
        price: Number(price),
        image_url,
        is_active: is_active ?? true
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    console.error('Error creating master product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product in master catalog',
      error: error.message
    });
  }
});

// ==========================================
// MANAGER SYSTEM ACCESS (Admin Controlled)
// ==========================================

// Get current manager info (masked)
router.get('/manager-settings', protect, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('system_credentials')
      .select('email, updated_at, is_active')
      .eq('role', 'MANAGER')
      .maybeSingle();

    if (error) throw error;

    res.json({
      success: true,
      manager: data || null
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update/Create/Replace Manager
router.post('/manager-settings', protect, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const hashedPassword = await bcrypt.hash(password, 12);

    // Strategy: Delete old manager row and insert new one to invalidate old IDs instantly
    // This ensures old JWTs (referencing old ID) become invalid immediately.

    // 1. Delete existing
    await supabase.from('system_credentials').delete().eq('role', 'MANAGER');

    // 2. Insert new
    const { data, error } = await supabase.from('system_credentials').insert({
      role: 'MANAGER',
      email: email.toLowerCase(),
      password_hash: hashedPassword,
      is_active: true
    }).select().single();

    if (error) throw error;

    res.json({ success: true, message: 'Manager updated. Old sessions invalidated.', manager: { email: data.email } });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});


export default router;
