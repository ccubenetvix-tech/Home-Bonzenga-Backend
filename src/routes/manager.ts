import express from 'express';
import { authenticateManager } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import { sendVendorApprovalNotification, sendVendorRejectionNotification } from '../lib/emailService';
import { supabase } from '../lib/supabase';

const router = express.Router();

// Middleware to protect routes - use proper JWT authentication
const protect = authenticateManager;

// Get manager dashboard data with comprehensive stats
router.get('/dashboard', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('📊 Fetching manager dashboard data from Supabase...');

    // Get vendor counts
    const [pendingVendorsRes, approvedVendorsRes, totalVendorsRes, rejectedVendorsRes, pendingVendorListRes] = await Promise.all([
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      supabase.from('vendor').select('*', { count: 'exact', head: true }),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'REJECTED'),
      supabase.from('vendor')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (pendingVendorsRes.error) throw pendingVendorsRes.error;
    if (approvedVendorsRes.error) throw approvedVendorsRes.error;
    if (totalVendorsRes.error) throw totalVendorsRes.error;
    if (rejectedVendorsRes.error) throw rejectedVendorsRes.error;
    if (pendingVendorListRes.error) throw pendingVendorListRes.error;

    const pendingVendorCount = pendingVendorsRes.count || 0;
    const approvedVendorCount = approvedVendorsRes.count || 0;
    const totalVendorCount = totalVendorsRes.count || 0;
    const rejectedVendorCount = rejectedVendorsRes.count || 0;
    const pendingVendorList = pendingVendorListRes.data || [];

    // Get appointment counts and recent appointments
    const [totalAppointmentsRes, completedAppointmentsRes, recentAppointmentsRes] = await Promise.all([
      supabase.from('bookings').select('*', { count: 'exact', head: true }),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED'),
      supabase.from('bookings')
        .select(`
          *,
          customer:users!bookings_customer_id_fkey (
            first_name,
            last_name
          ),
          vendor:vendor!bookings_vendor_id_fkey (
            shopname
          )
        `)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (totalAppointmentsRes.error) throw totalAppointmentsRes.error;
    if (completedAppointmentsRes.error) throw completedAppointmentsRes.error;
    if (recentAppointmentsRes.error) throw recentAppointmentsRes.error;

    const totalAppointments = totalAppointmentsRes.count || 0;
    const completedAppointments = completedAppointmentsRes.count || 0;
    const recentAppointmentsRaw = recentAppointmentsRes.data || [];

    const vendorStats = {
      pending: pendingVendorCount,
      approved: approvedVendorCount,
      total: totalVendorCount,
      rejected: rejectedVendorCount,
    };

    const appointmentStats = {
      total: totalAppointments,
      completed: completedAppointments,
    };

    const pendingVendors = pendingVendorList.map((vendor: any) => ({
      id: vendor.id,
      shopName: vendor.shopname || vendor.shopName,
      description: vendor.description || null,
      address: vendor.address || null,
      city: vendor.city || null,
      state: vendor.state || null,
      zipCode: vendor.zip_code || vendor.zipCode || null,
      email: vendor.user?.email || null,
      phone: vendor.user?.phone || null,
      ownerName: `${vendor.user?.first_name || vendor.user?.firstName || ''} ${vendor.user?.last_name || vendor.user?.lastName || ''}`.trim(),
      serviceCount: 0, // Will need separate query if needed
      productCount: 0, // Will need separate query if needed
      employeeCount: 0, // Will need separate query if needed
      status: vendor.status,
      createdAt: vendor.created_at || vendor.createdAt,
    }));

    const recentAppointments = recentAppointmentsRaw.map((appointment: any) => ({
      id: appointment.id,
      customerName: `${appointment.customer?.first_name || appointment.customer?.firstName || 'Unknown'} ${appointment.customer?.last_name || appointment.customer?.lastName || ''}`.trim(),
      vendorName: appointment.vendor?.shopname || appointment.vendor?.shopName || 'Unknown vendor',
      serviceName: 'Service', // Will need to join with booking_items if needed
      scheduledDate: appointment.scheduled_date || appointment.scheduledDate,
      scheduledTime: appointment.scheduled_time || appointment.scheduledTime,
      status: appointment.status,
    }));

    res.json({
      success: true,
      data: {
        vendorStats,
        appointmentStats,
        pendingVendors,
        recentAppointments,
      },
    });
  } catch (error: any) {
    console.error('❌ Error fetching manager dashboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch manager dashboard data', error: error.message });
  }
});

// Get pending vendors with full details
router.get('/vendors/pending', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('📋 Fetching pending vendors from Supabase...');

    // First, check if there are any vendors at all
    const allVendorsRes = await supabase.from('vendor').select('*', { count: 'exact', head: true });
    const allVendorsCount = allVendorsRes.count || 0;
    console.log(`📊 Total vendors in database: ${allVendorsCount}`);

    // Check vendors by status
    const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'REJECTED'),
    ]);

    const pendingCount = pendingRes.count || 0;
    const approvedCount = approvedRes.count || 0;
    const rejectedCount = rejectedRes.count || 0;
    console.log(`📊 Vendors by status - PENDING: ${pendingCount}, APPROVED: ${approvedCount}, REJECTED: ${rejectedCount}`);

    const vendorsRes = await supabase
      .from('vendor')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (vendorsRes.error) throw vendorsRes.error;
    const vendors = vendorsRes.data || [];

    console.log(`✅ Found ${vendors.length} pending vendors`);

    // Log details of each vendor
    vendors.forEach((vendor, index) => {
      console.log(`   Vendor ${index + 1}: ${vendor.shopName} (${vendor.id})`);
      console.log(`      User: ${vendor.user?.firstName} ${vendor.user?.lastName} (${vendor.user?.email})`);
      console.log(`      Services: ${vendor.services?.length || 0}, Products: ${vendor.products?.length || 0}, Employees: ${vendor.employees?.length || 0}`);
    });

    // Add stats to each pending vendor (with safe type conversions)
    const vendorsWithInfo = vendors.map((vendor: any) => {
      try {
        const createdAt = vendor.created_at || vendor.createdAt;
        const createdAtStr = createdAt instanceof Date
          ? createdAt.toISOString()
          : (typeof createdAt === 'string' ? createdAt : new Date().toISOString());
        const updatedAt = vendor.updated_at || vendor.updatedAt;
        const updatedAtStr = updatedAt instanceof Date
          ? updatedAt.toISOString()
          : (typeof updatedAt === 'string' ? updatedAt : new Date().toISOString());

        return {
          id: String(vendor.id || ''),
          shopName: String(vendor.shopname || vendor.shopName || 'Unknown'),
          description: vendor.description || null,
          address: String(vendor.address || ''),
          city: String(vendor.city || ''),
          state: String(vendor.state || ''),
          zipCode: String(vendor.zip_code || vendor.zipCode || ''),
          status: String(vendor.status || 'PENDING'),
          createdAt: createdAtStr,
          updatedAt: updatedAtStr,
          user: vendor.user ? {
            id: String(vendor.user.id || ''),
            firstName: String(vendor.user.first_name || vendor.user.firstName || ''),
            lastName: String(vendor.user.last_name || vendor.user.lastName || ''),
            email: String(vendor.user.email || ''),
            phone: String(vendor.user.phone || '')
          } : null,
          services: [], // Services would need separate query
          products: [], // Products would need separate query
          employees: [], // Employees would need separate query
          serviceCount: 0,
          productCount: 0,
          employeeCount: 0
        };
      } catch (error: any) {
        console.error(`⚠️ Error processing pending vendor ${vendor?.id}:`, error?.message || error);
        return {
          id: String(vendor?.id || 'unknown'),
          shopName: String(vendor?.shopname || vendor?.shopName || 'Unknown'),
          description: null,
          address: '',
          city: '',
          state: '',
          zipCode: '',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: null,
          services: [],
          products: [],
          employees: [],
          serviceCount: 0,
          productCount: 0,
          employeeCount: 0
        };
      }
    });

    res.json({
      success: true,
      vendors: vendorsWithInfo,
      count: vendorsWithInfo.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching pending vendors:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending vendors',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all vendors with comprehensive data (for manager)
router.get('/vendors', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('📋 Fetching all vendors for manager...');
    console.log('🔐 Authenticated user:', req.user?.email, 'Role:', req.user?.role);

    const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
    const normalizedStatus = statusParam ? statusParam.toUpperCase() : undefined;
    const whereClause: any = {};
    if (normalizedStatus && normalizedStatus !== 'ALL') {
      whereClause.status = normalizedStatus;
    }

    // Fetch vendors with user info from Supabase
    let vendorsQuery = supabase
      .from('vendor')
      .select('*')
      .order('created_at', { ascending: false });

    if (normalizedStatus && normalizedStatus !== 'ALL') {
      vendorsQuery = vendorsQuery.eq('status', normalizedStatus);
    }

    const vendorsRes = await vendorsQuery;
    if (vendorsRes.error) throw vendorsRes.error;
    const vendors = (vendorsRes.data || []).map((v: any) => ({
      ...v,
      shopName: v.shopname || v.shopName,
      createdAt: v.created_at || v.createdAt,
      updatedAt: v.updated_at || v.updatedAt,
      user: Array.isArray(v.user) ? v.user[0] : v.user,
      services: [], // Would need separate query
      products: [], // Would need separate query
      employees: [], // Would need separate query
      bookings: [] // Would need separate query
    }));

    console.log(`✅ Found ${vendors.length} vendors`);

    const vendorsWithStats = vendors.map((vendor: any) => {
      try {
        const completedBookings = vendor.bookings || [];
        const totalRevenue = completedBookings.reduce((sum: number, booking: any) => {
          const total = booking.total;
          return sum + (typeof total === 'number' ? total : (typeof total === 'string' ? parseFloat(total) || 0 : 0));
        }, 0);

        const createdAt = vendor.createdAt instanceof Date
          ? vendor.createdAt.toISOString()
          : (typeof vendor.createdAt === 'string' ? vendor.createdAt : new Date().toISOString());
        const updatedAt = vendor.updatedAt instanceof Date
          ? vendor.updatedAt.toISOString()
          : (typeof vendor.updatedAt === 'string' ? vendor.updatedAt : new Date().toISOString());

        return {
          id: String(vendor.id || ''),
          shopName: String(vendor.shopName || 'Unknown'),
          description: vendor.description || null,
          address: String(vendor.address || ''),
          city: String(vendor.city || ''),
          state: String(vendor.state || ''),
          zipCode: String(vendor.zipCode || ''),
          status: String(vendor.status || 'PENDING'),
          createdAt: createdAt,
          updatedAt: updatedAt,
          user: vendor.user ? {
            id: String(vendor.user.id || ''),
            firstName: String(vendor.user.firstName || ''),
            lastName: String(vendor.user.lastName || ''),
            email: String(vendor.user.email || ''),
            phone: String(vendor.user.phone || '')
          } : null,
          services: Array.isArray(vendor.services) ? vendor.services.map((s: any) => ({
            id: String(s.id || ''),
            name: String(s.name || ''),
            price: typeof s.price === 'number' ? Number(s.price) : (typeof s.price === 'string' ? parseFloat(s.price) || 0 : 0),
            duration: typeof s.duration === 'number' ? Number(s.duration) : (typeof s.duration === 'string' ? parseInt(s.duration) || 0 : 0),
            isActive: Boolean(s.isActive !== undefined ? s.isActive : true)
          })) : [],
          products: Array.isArray(vendor.products) ? vendor.products.map((p: any) => ({
            id: String(p.id || ''),
            name: String(p.name || ''),
            price: typeof p.price === 'number' ? Number(p.price) : (typeof p.price === 'string' ? parseFloat(p.price) || 0 : 0),
            category: String(p.category || ''),
            stock: typeof p.stock === 'number' ? Number(p.stock) : (typeof p.stock === 'string' ? parseInt(p.stock) || 0 : 0),
            isActive: Boolean(p.isActive !== undefined ? p.isActive : true)
          })) : [],
          employees: Array.isArray(vendor.employees) ? vendor.employees.map((e: any) => ({
            id: String(e.id || ''),
            name: String(e.name || ''),
            role: String(e.role || ''),
            email: String(e.email || ''),
            phone: String(e.phone || ''),
            specialization: e.specialization ? String(e.specialization) : null,
            experience: typeof e.experience === 'number' ? Number(e.experience) : (typeof e.experience === 'string' ? parseInt(e.experience) || 0 : 0),
            status: String(e.status || 'ACTIVE')
          })) : [],
          stats: {
            totalServices: Number(vendor.services?.length || 0),
            totalProducts: Number(vendor.products?.length || 0),
            totalEmployees: Number(vendor.employees?.length || 0),
            totalBookings: Number(completedBookings.length),
            completedBookings: Number(completedBookings.length),
            totalRevenue: Number(totalRevenue)
          }
        };
      } catch (error: any) {
        console.error(`⚠️ Error processing vendor ${vendor?.id}:`, error?.message || error);
        return {
          id: String(vendor?.id || 'unknown'),
          shopName: String(vendor?.shopName || 'Unknown'),
          description: null,
          address: '',
          city: '',
          state: '',
          zipCode: '',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: null,
          services: [],
          products: [],
          employees: [],
          stats: {
            totalServices: 0,
            totalProducts: 0,
            totalEmployees: 0,
            totalBookings: 0,
            completedBookings: 0,
            totalRevenue: 0
          }
        };
      }
    });

    res.json({
      success: true,
      vendors: vendorsWithStats,
      count: vendorsWithStats.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching all vendors:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all vendors with comprehensive data (legacy endpoint)
router.get('/vendors/all', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('📋 Fetching all vendors...');

    // Fetch vendors with user info from Supabase
    const vendorsRes = await supabase
      .from('vendor')
      .select('*')
      .order('created_at', { ascending: false });

    if (vendorsRes.error) throw vendorsRes.error;
    const vendors = (vendorsRes.data || []).map((v: any) => ({
      ...v,
      shopName: v.shopname || v.shopName,
      createdAt: v.created_at || v.createdAt,
      updatedAt: v.updated_at || v.updatedAt,
      user: Array.isArray(v.user) ? v.user[0] : v.user,
      services: [],
      products: [],
      employees: [],
      bookings: []
    }));

    console.log(`✅ Found ${vendors.length} vendors`);

    // Fetch reviews separately to avoid potential issues
    const vendorIds = vendors.map((v: any) => v.id);
    const reviewsMap = new Map();

    try {
      if (vendorIds.length > 0) {
        const reviewsRes = await supabase
          .from('reviews')
          .select(`
            *,
            customer:users!reviews_customer_id_fkey (
              first_name,
              last_name
            )
          `)
          .in('vendor_id', vendorIds);

        if (!reviewsRes.error && reviewsRes.data) {
          // Group reviews by vendorId
          reviewsRes.data.forEach((review: any) => {
            const vendorId = review.vendor_id || review.vendorId;
            if (!reviewsMap.has(vendorId)) {
              reviewsMap.set(vendorId, []);
            }
            reviewsMap.get(vendorId).push({
              ...review,
              vendorId: vendorId,
              customer: Array.isArray(review.customer) ? review.customer[0] : review.customer
            });
          });
        }
      }
    } catch (reviewError) {
      console.warn('⚠️ Could not fetch reviews:', reviewError);
      // Continue without reviews
    }

    // Calculate comprehensive stats for each vendor
    const vendorsWithStats = vendors.map(vendor => {
      try {
        const allBookings = vendor.bookings || [];
        const completedBookings = allBookings.filter((b: any) => b.status === 'COMPLETED');
        const totalRevenue = completedBookings.reduce((sum: number, booking: any) => {
          const total = booking.total || 0;
          return sum + (typeof total === 'number' ? total : Number(total) || 0);
        }, 0);

        const vendorReviews = reviewsMap.get(vendor.id) || [];
        const averageRating = vendorReviews.length > 0
          ? vendorReviews.reduce((sum: number, review: any) => {
            const rating = review.rating || 0;
            return sum + (typeof rating === 'number' ? rating : Number(rating) || 0);
          }, 0) / vendorReviews.length
          : 0;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        return {
          id: vendor.id,
          shopName: vendor.shopName,
          description: vendor.description || null,
          address: vendor.address || '',
          city: vendor.city || '',
          state: vendor.state || '',
          zipCode: vendor.zipCode || '',
          status: vendor.status,
          createdAt: vendor.createdAt,
          updatedAt: vendor.updatedAt,
          user: vendor.user ? {
            id: vendor.user.id,
            firstName: vendor.user.firstName || '',
            lastName: vendor.user.lastName || '',
            email: vendor.user.email || '',
            phone: vendor.user.phone || null
          } : null,
          services: (vendor.services || []).map((service: any) => ({
            id: service.id,
            name: service.name || '',
            description: service.description || null,
            price: typeof service.price === 'number' ? service.price : Number(service.price) || 0,
            duration: service.duration || 0,
            isActive: service.isActive !== undefined ? service.isActive : true,
            category: service.categories && service.categories.length > 0 && service.categories[0].category
              ? service.categories[0].category.name
              : 'Other'
          })),
          products: (vendor.products || []).map((product: any) => ({
            id: product.id,
            name: product.name || '',
            category: product.category || '',
            price: typeof product.price === 'number' ? product.price : Number(product.price) || 0,
            stock: product.stock || 0,
            isActive: product.isActive !== undefined ? product.isActive : true,
            description: product.description || null
          })),
          employees: (vendor.employees || []).map((employee: any) => ({
            id: employee.id,
            name: employee.name || '',
            role: employee.role || '',
            email: employee.email || '',
            phone: employee.phone || '',
            status: employee.status || 'ACTIVE',
            experience: employee.experience || 0
          })),
          stats: {
            totalBookings: allBookings.length,
            completedBookings: completedBookings.length,
            pendingBookings: allBookings.filter((b: any) => b.status === 'PENDING').length,
            totalRevenue: totalRevenue,
            monthlyRevenue: completedBookings
              .filter((b: any) => {
                try {
                  const bookingDate = new Date(b.createdAt);
                  return bookingDate.getMonth() === currentMonth &&
                    bookingDate.getFullYear() === currentYear;
                } catch {
                  return false;
                }
              })
              .reduce((sum: number, booking: any) => {
                const total = booking.total || 0;
                return sum + (typeof total === 'number' ? total : Number(total) || 0);
              }, 0),
            averageRating: Math.round(averageRating * 10) / 10,
            totalReviews: vendorReviews.length,
            totalServices: vendor.services?.length || 0,
            totalProducts: vendor.products?.length || 0,
            totalEmployees: vendor.employees?.length || 0,
            activeServices: vendor.services?.filter((s: any) => s.isActive).length || 0
          }
        };
      } catch (vendorError) {
        console.error(`❌ Error processing vendor ${vendor.id}:`, vendorError);
        // Return basic vendor info even if stats calculation fails
        return {
          id: vendor.id,
          shopName: vendor.shopName || '',
          description: vendor.description || null,
          address: vendor.address || '',
          city: vendor.city || '',
          state: vendor.state || '',
          zipCode: vendor.zipCode || '',
          status: vendor.status,
          createdAt: vendor.createdAt,
          updatedAt: vendor.updatedAt,
          user: vendor.user || null,
          services: [],
          products: [],
          employees: [],
          stats: {
            totalBookings: 0,
            completedBookings: 0,
            pendingBookings: 0,
            totalRevenue: 0,
            monthlyRevenue: 0,
            averageRating: 0,
            totalReviews: 0,
            totalServices: 0,
            totalProducts: 0,
            totalEmployees: 0,
            activeServices: 0
          }
        };
      }
    });

    res.json({
      success: true,
      vendors: vendorsWithStats,
      count: vendorsWithStats.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching all vendors:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get approved vendors (vendors approved by this manager)
router.get('/vendors/approved', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('📋 Fetching approved vendors...');

    // Note: In current schema, we don't track which manager approved which vendor
    // So we'll return all approved vendors. If needed, we can add approvedBy field later.
    const vendorsRes = await supabase
      .from('vendor')
      .select('*')
      .eq('status', 'APPROVED')
      .order('updated_at', { ascending: false });

    if (vendorsRes.error) throw vendorsRes.error;
    const vendors = (vendorsRes.data || []).map((v: any) => ({
      ...v,
      shopName: v.shopname || v.shopName,
      updatedAt: v.updated_at || v.updatedAt,
      user: Array.isArray(v.user) ? v.user[0] : v.user,
      services: [],
      products: [],
      employees: []
    }));

    console.log(`✅ Found ${vendors.length} approved vendors`);

    const vendorsWithInfo = vendors.map(vendor => ({
      id: vendor.id,
      shopName: vendor.shopName,
      description: vendor.description || null,
      address: vendor.address || '',
      city: vendor.city || '',
      state: vendor.state || '',
      zipCode: vendor.zipCode || '',
      status: vendor.status,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
      user: vendor.user || null,
      services: vendor.services || [],
      products: vendor.products || [],
      employees: vendor.employees || [],
      serviceCount: vendor.services?.length || 0,
      productCount: vendor.products?.length || 0,
      employeeCount: vendor.employees?.length || 0
    }));

    res.json({
      success: true,
      vendors: vendorsWithInfo,
      count: vendorsWithInfo.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching approved vendors:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved vendors',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get vendor details with comprehensive information
router.get('/vendors/:id/details', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    console.log(`📋 Fetching vendor details for: ${id}`);

    const vendorRes = await supabase
      .from('vendor')
      .select('*')
      .eq('id', id)
      .single();

    if (vendorRes.error || !vendorRes.data) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const vendor = {
      ...vendorRes.data,
      shopName: vendorRes.data.shopname || vendorRes.data.shopName,
      createdAt: vendorRes.data.created_at || vendorRes.data.createdAt,
      updatedAt: vendorRes.data.updated_at || vendorRes.data.updatedAt,
      user: Array.isArray(vendorRes.data.user) ? vendorRes.data.user[0] : vendorRes.data.user,
      services: [],
      products: [],
      employees: [],
      bookings: []
    };

    // Fetch services, products, employees, and bookings in parallel
    const [servicesRes, productsRes, employeesRes, bookingsRes] = await Promise.all([
      // Try 'services' table first (primary source)
      supabase
        .from('services')
        .select(`
          *,
          categories:service_category_map (
            category:service_categories (*)
          )
        `)
        .eq('vendor_id', id)
        .order('created_at', { ascending: false }),

      supabase
        .from('products')
        .select('*')
        .eq('vendor_id', id)
        .order('created_at', { ascending: false }),

      supabase
        .from('vendor_employees')
        .select('*')
        .eq('vendor_id', id)
        .order('created_at', { ascending: false }),

      supabase
        .from('bookings')
        .select('*')
        .eq('vendor_id', id)
    ]);

    // Debug: Log services query results
    if (servicesRes.error) {
      console.error(`❌ Error fetching services for vendor ${id} from 'services' table:`, servicesRes.error);
    }
    console.log(`🔍 Manager - Services query for vendor ${id}:`, {
      hasError: !!servicesRes.error,
      error: servicesRes.error?.message,
      dataCount: servicesRes.data?.length || 0,
      vendorId: id
    });

    // Handle service data and fallback
    let servicesData = servicesRes.data || [];

    // Fallback: If 'services' table returned no data (or error), check 'vendor_services'
    if (servicesData.length === 0) {
      console.log(`⚠️ No services found in 'services' table, trying 'vendor_services' (legacy)...`);
      const { data: servicesFallback, error: servicesFallbackError } = await supabase
        .from('vendor_services')
        .select('*')
        .eq('vendor_id', id)
        .order('updated_at', { ascending: false });

      if (!servicesFallbackError && servicesFallback && servicesFallback.length > 0) {
        console.log(`✅ Found ${servicesFallback.length} services in 'vendor_services' table`);
        servicesData = servicesFallback.map((s: any) => ({
          ...s,
          // Map legacy fields to match 'services' schema if needed
          duration: s.duration_minutes || s.duration,
          isActive: s.is_active,
          category: s.category || 'General' // vendor_services might not have relation map
        }));
      } else if (servicesFallbackError) {
        console.warn(`⚠️ Failed to fetch from 'vendor_services':`, servicesFallbackError.message);
      }
    }

    console.log(`📊 Manager - Final services count: ${servicesData.length}`);
    console.log(`📊 Manager - Products count: ${productsRes.data?.length || 0}`);
    console.log(`📊 Manager - Employees count: ${employeesRes.data?.length || 0}`);

    // Format services
    const services = servicesData.map((service: any) => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      price: service.price,
      duration: service.duration_minutes || service.duration || 60,
      category: service.category || 'general',
      isActive: service.is_active !== undefined ? service.is_active : (service.isActive !== undefined ? service.isActive : true),
      imageUrl: service.image_url || service.image || null,
      createdAt: service.created_at || service.createdAt || service.createdat
    }));

    // Format products
    const products = (productsRes.data || []).map((product: any) => ({
      id: product.id,
      name: product.product_name || product.name,
      category: product.category_id || product.category || '',
      price: product.price_cdf || product.price,
      stock: product.stock_quantity || product.stock || 0,
      description: product.description || null,
      imageUrl: product.image_url || product.image || null,
      isActive: product.is_active !== undefined ? product.is_active : (product.isActive !== undefined ? product.isActive : true),
      createdAt: product.created_at || product.createdAt
    }));

    // Format employees
    const employees = (employeesRes.data || []).map((emp: any) => ({
      id: emp.id,
      name: emp.name,
      role: emp.role,
      phone: emp.phone,
      email: emp.email || '',
      experienceYears: emp.experience_years || emp.experienceYears || 0,
      specialization: emp.specialization || '',
      isActive: emp.is_active !== undefined ? emp.is_active : (emp.isActive !== undefined ? emp.isActive : true),
      status: emp.is_active ? 'ACTIVE' : 'INACTIVE',
      createdAt: emp.created_at || emp.createdAt
    }));


    const allBookings = bookingsRes.data || [];

    // Fetch reviews separately
    let reviews: any[] = [];
    try {
      const reviewsRes = await supabase
        .from('reviews')
        .select(`
          *,
          customer:users!reviews_customer_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq('vendor_id', id)
        .order('created_at', { ascending: false });
      reviews = reviewsRes.data || [];
    } catch (reviewError) {
      console.warn('⚠️ Could not fetch reviews:', reviewError);
    }

    // Calculate comprehensive statistics with error handling
    const completedBookings = allBookings.filter((b: any) => b.status === 'COMPLETED');
    const totalRevenue = completedBookings.reduce((sum: number, booking: any) => {
      const total = booking.total || 0;
      return sum + (typeof total === 'number' ? total : Number(total) || 0);
    }, 0);

    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const monthlyRevenue = completedBookings
      .filter((b: any) => {
        try {
          return new Date(b.createdAt) >= currentMonth;
        } catch {
          return false;
        }
      })
      .reduce((sum: number, booking: any) => {
        const total = booking.total || 0;
        return sum + (typeof total === 'number' ? total : Number(total) || 0);
      }, 0);

    const averageRating = reviews.length > 0
      ? reviews.reduce((sum: number, review: any) => {
        const rating = review.rating || 0;
        return sum + (typeof rating === 'number' ? rating : Number(rating) || 0);
      }, 0) / reviews.length
      : 0;

    const vendorDetails = {
      id: vendor.id,
      shopName: vendor.shopName,
      description: vendor.description || null,
      address: vendor.address || '',
      city: vendor.city || '',
      state: vendor.state || '',
      zipCode: vendor.zipCode || '',
      status: vendor.status,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
      user: vendor.user ? {
        id: vendor.user.id,
        firstName: vendor.user.first_name || vendor.user.firstName || '',
        lastName: vendor.user.last_name || vendor.user.lastName || '',
        email: vendor.user.email || '',
        phone: vendor.user.phone || null
      } : null,
      services: services,
      products: products,
      employees: employees,
      bookings: (allBookings || []).map((booking: any) => ({
        id: booking.id,
        customer: booking.customer || null,
        scheduledDate: booking.scheduled_date || booking.scheduledDate || '',
        scheduledTime: booking.scheduled_time || booking.scheduledTime || '',
        status: booking.status || 'PENDING',
        total: typeof booking.total === 'number' ? booking.total : Number(booking.total) || 0,
        bookingType: booking.booking_type || booking.bookingType || 'SALON',
        items: (booking.items || []).map((item: any) => ({
          service: item.service || null,
          quantity: item.quantity || 1,
          price: typeof item.price === 'number' ? item.price : Number(item.price) || 0
        })),
        createdAt: booking.created_at || booking.createdAt
      })),
      reviews: reviews.map((review: any) => ({
        id: review.id,
        rating: typeof review.rating === 'number' ? review.rating : Number(review.rating) || 0,
        comment: review.comment || null,
        customer: review.customer || null,
        createdAt: review.createdAt
      })),
      stats: {
        totalBookings: allBookings.length,
        completedBookings: completedBookings.length,
        pendingBookings: allBookings.filter((b: any) => b.status === 'PENDING').length,
        cancelledBookings: allBookings.filter((b: any) => b.status === 'CANCELLED').length,
        totalRevenue: totalRevenue,
        monthlyRevenue: monthlyRevenue,
        averageRating: Math.round(averageRating * 10) / 10,
        totalReviews: reviews.length,
        totalServices: services.length,
        activeServices: services.filter((s: any) => s.isActive).length,
        totalProducts: products.length,
        activeProducts: products.filter((p: any) => p.isActive).length,
        totalEmployees: employees.length,
        activeEmployees: employees.filter((e: any) => e.isActive || e.status === 'ACTIVE').length
      }
    };

    res.json({
      success: true,
      vendor: vendorDetails
    });
  } catch (error: any) {
    console.error('❌ Error fetching vendor details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

const approveVendorHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    console.log(`📋 Approving vendor: ${id}`);

    // Get vendor with user info for email notification
    const vendorRes = await supabase
      .from('vendor')
      .select('*')
      .eq('id', id)
      .single();

    if (vendorRes.error || !vendorRes.data) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendor = vendorRes.data;

    // Fetch user data separately since we removed the join
    const userRes = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('id', vendor.user_id)
      .single();

    if (userRes.error || !userRes.data) {
      return res.status(400).json({
        success: false,
        message: 'Vendor user information not found'
      });
    }

    const user = userRes.data;

    // Update vendor status
    const previousStatus = vendor.status;
    const updateRes = await supabase
      .from('vendor')
      .update({
        status: 'APPROVED',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateRes.error) throw updateRes.error;
    const updatedVendor = updateRes.data;

    // Create audit log for vendor approval (non-blocking) - skip if audit_log table doesn't exist
    try {
      await supabase.from('audit_log').insert({
        user_id: user.id,
        action: 'VENDOR_APPROVED',
        resource: 'VENDOR',
        resource_id: vendor.id,
        old_data: JSON.stringify({ status: previousStatus }),
        new_data: JSON.stringify({ status: 'APPROVED' })
      });
    } catch (auditError: any) {
      console.error('⚠️ Failed to create audit log for vendor approval:', auditError?.message || auditError);
      // Don't block approval if audit log fails
    }

    // Send approval email (non-blocking)
    sendVendorApprovalNotification({
      email: user.email,
      shopName: vendor.shopname || vendor.shopName,
      ownerName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    }).catch((emailError: any) => {
      console.error('⚠️ Failed to send approval email:', emailError?.message || emailError);
    });

    console.log(`✅ Vendor ${id} approved successfully`);

    res.json({
      success: true,
      message: 'Vendor approved successfully',
      vendor: updatedVendor
    });
  } catch (error: any) {
    console.error('❌ Error approving vendor:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to approve vendor',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

router.patch('/vendors/:id/approve', protect, approveVendorHandler);
router.patch('/vendor/:id/approve', protect, approveVendorHandler);

const rejectVendorHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    console.log(`📋 Rejecting vendor: ${id}`);

    // Get vendor with user info for email notification
    const vendorRes = await supabase
      .from('vendor')
      .select('*')
      .eq('id', id)
      .single();

    if (vendorRes.error || !vendorRes.data) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const vendor = vendorRes.data;

    // Fetch user data separately since we removed the join
    const userRes = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('id', vendor.user_id)
      .single();

    if (userRes.error || !userRes.data) {
      return res.status(400).json({
        success: false,
        message: 'Vendor user information not found'
      });
    }

    const user = userRes.data;

    // Update vendor status
    const previousStatus = vendor.status;
    const updateRes = await supabase
      .from('vendor')
      .update({
        status: 'REJECTED',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateRes.error) throw updateRes.error;
    const updatedVendor = updateRes.data;

    // Create audit log for vendor rejection (non-blocking) - skip if audit_log table doesn't exist
    try {
      await supabase.from('audit_log').insert({
        user_id: user.id,
        action: 'VENDOR_REJECTED',
        resource: 'VENDOR',
        resource_id: vendor.id,
        old_data: JSON.stringify({ status: previousStatus }),
        new_data: JSON.stringify({ status: 'REJECTED', reason: reason || '' })
      });
    } catch (auditError) {
      console.error('⚠️ Failed to create audit log for vendor rejection:', auditError);
      // Don't block rejection if audit log fails
    }

    // Send rejection email (non-blocking)
    sendVendorRejectionNotification({
      email: user.email,
      shopName: vendor.shopname || vendor.shopName,
      ownerName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      reason: reason || '',
    }).catch((emailError: any) => {
      console.error('⚠️ Failed to send rejection email:', emailError?.message || emailError);
    });

    console.log(`✅ Vendor ${id} rejected successfully`);

    res.json({
      success: true,
      message: 'Vendor rejected successfully',
      vendor: updatedVendor
    });
  } catch (error: any) {
    console.error('❌ Error rejecting vendor:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to reject vendor',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

router.patch('/vendors/:id/reject', protect, rejectVendorHandler);
router.patch('/vendor/:id/reject', protect, rejectVendorHandler);

// Get all appointments
router.get('/appointments', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { status, serviceType, limit = 50 } = req.query;

    const whereClause: any = {};

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (serviceType && serviceType !== 'all') {
      whereClause.serviceType = serviceType;
    }

    let appointmentsQuery = supabase
      .from('bookings')
      .select(`
        *,
        customer:users!bookings_customer_id_fkey (*),
        vendor:vendor!bookings_vendor_id_fkey (*)
      `)
      .order('scheduled_date', { ascending: false })
      .limit(parseInt(limit as string) || 50);

    if (status && status !== 'all') {
      appointmentsQuery = appointmentsQuery.eq('status', status);
    }

    const appointmentsRes = await appointmentsQuery;
    if (appointmentsRes.error) throw appointmentsRes.error;
    const appointments = appointmentsRes.data || [];

    res.json({ appointments });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update appointment status
router.patch('/appointments/:appointmentId/status', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;

    const updateRes = await supabase
      .from('bookings')
      .update({ status })
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateRes.error) throw updateRes.error;
    const appointment = updateRes.data;

    res.json({ message: 'Appointment status updated successfully', appointment });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get reports data
router.get('/reports', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { range = 'month' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (range) {
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

    // Get vendor stats
    const [totalVendorsRes, activeVendorsRes, pendingVendorsRes] = await Promise.all([
      supabase.from('vendor').select('*', { count: 'exact', head: true }),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      supabase.from('vendor').select('*', { count: 'exact', head: true }).in('status', ['PENDING', 'PENDING_APPROVAL'])
    ]);
    const totalVendors = totalVendorsRes.count || 0;
    const activeVendors = activeVendorsRes.count || 0;
    const pendingVendors = pendingVendorsRes.count || 0;

    // Get appointment stats
    const [totalAppointmentsRes, completedAppointmentsRes, pendingAppointmentsRes] = await Promise.all([
      supabase.from('bookings').select('*', { count: 'exact', head: true }),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'PENDING')
    ]);
    const totalAppointments = totalAppointmentsRes.count || 0;
    const completedAppointments = completedAppointmentsRes.count || 0;
    const pendingAppointments = pendingAppointmentsRes.count || 0;

    // Get revenue stats (calculate from bookings)
    const completedBookingsRes = await supabase
      .from('bookings')
      .select('total')
      .eq('status', 'COMPLETED');
    const totalRevenue = { _sum: { total: (completedBookingsRes.data || []).reduce((sum: number, b: any) => sum + (Number(b.total) || 0), 0) } };

    const monthlyBookingsRes = await supabase
      .from('bookings')
      .select('total')
      .eq('status', 'COMPLETED')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', now.toISOString());
    const monthlyRevenue = { _sum: { total: (monthlyBookingsRes.data || []).reduce((sum: number, b: any) => sum + (Number(b.total) || 0), 0) } };

    // Get customer count
    const customersRes = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'CUSTOMER');
    const totalCustomers = customersRes.count || 0;

    const stats = {
      totalVendors,
      activeVendors,
      pendingVendors,
      totalAppointments,
      completedAppointments,
      pendingAppointments,
      totalRevenue: totalRevenue._sum?.total || 0,
      monthlyRevenue: monthlyRevenue._sum?.total || 0,
      averageRating: 4.6, // Mock data
      totalCustomers
    };

    // Get vendor performance data
    const vendorsRes = await supabase
      .from('vendor')
      .select('*')
      .eq('status', 'APPROVED');

    const vendors = vendorsRes.data || [];
    const vendorIds = vendors.map((v: any) => v.id);

    // Get bookings for these vendors
    const bookingsRes = vendorIds.length > 0
      ? await supabase.from('bookings').select('*').eq('status', 'COMPLETED').in('vendor_id', vendorIds)
      : { data: [] };

    const bookingsByVendor = new Map();
    (bookingsRes.data || []).forEach((b: any) => {
      const vid = b.vendor_id || b.vendorId;
      if (!bookingsByVendor.has(vid)) bookingsByVendor.set(vid, []);
      bookingsByVendor.get(vid).push(b);
    });

    const vendorPerformance = vendors.map((vendor: any) => {
      const bookings = bookingsByVendor.get(vendor.id) || [];
      return {
        id: vendor.id,
        shopName: vendor.shopname || vendor.shopName,
        totalBookings: bookings.length,
        completedBookings: bookings.length,
        totalRevenue: bookings.reduce((sum: number, booking: any) => sum + (Number(booking.total) || 0), 0),
        averageRating: 4.5, // Mock data
        totalReviews: Math.floor(bookings.length * 0.8) // Mock data
      };
    }).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue).slice(0, 10);

    // Mock monthly data for chart
    const monthlyData = [
      { month: 'Jan', vendors: Math.floor(totalVendors * 0.6), appointments: Math.floor(totalAppointments * 0.3), revenue: Math.floor((totalRevenue._sum?.total || 0) * 0.2) },
      { month: 'Feb', vendors: Math.floor(totalVendors * 0.7), appointments: Math.floor(totalAppointments * 0.35), revenue: Math.floor((totalRevenue._sum?.total || 0) * 0.25) },
      { month: 'Mar', vendors: Math.floor(totalVendors * 0.75), appointments: Math.floor(totalAppointments * 0.3), revenue: Math.floor((totalRevenue._sum?.total || 0) * 0.23) },
      { month: 'Apr', vendors: Math.floor(totalVendors * 0.8), appointments: Math.floor(totalAppointments * 0.35), revenue: Math.floor((totalRevenue._sum?.total || 0) * 0.26) },
      { month: 'May', vendors: Math.floor(totalVendors * 0.85), appointments: Math.floor(totalAppointments * 0.37), revenue: Math.floor((totalRevenue._sum?.total || 0) * 0.27) },
      { month: 'Jun', vendors: totalVendors, appointments: totalAppointments, revenue: totalRevenue._sum?.total || 0 }
    ];

    res.json({
      stats,
      vendorPerformance,
      monthlyData
    });
  } catch (error) {
    console.error('Error fetching reports data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get manager profile
router.get('/profile', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const managerRes = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (managerRes.error || !managerRes.data) {
      return res.status(404).json({ message: 'Manager not found' });
    }
    const manager = managerRes.data;

    if (!manager) {
      return res.status(404).json({ message: 'Manager not found' });
    }

    const [vendorsRes, customersRes, appointmentsRes] = await Promise.all([
      supabase.from('vendor').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'CUSTOMER'),
      supabase.from('bookings').select('*', { count: 'exact', head: true })
    ]);
    const totalVendorsManaged = vendorsRes.count || 0;
    const totalCustomersManaged = customersRes.count || 0;
    const totalAppointmentsManaged = appointmentsRes.count || 0;

    res.json({
      firstName: manager.firstName,
      lastName: manager.lastName,
      email: manager.email,
      phone: manager.phone,
      role: manager.role,
      createdAt: manager.createdAt,
      totalVendorsManaged,
      totalCustomersManaged,
      totalAppointmentsManaged,
    });
  } catch (error) {
    console.error('Error fetching manager profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update manager profile
router.put('/profile', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { firstName, lastName, phone } = req.body;

    const updateData: any = {};
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (phone !== undefined) updateData.phone = phone;

    const updatedRes = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single();

    if (updatedRes.error) throw updatedRes.error;
    const updated = updatedRes.data;

    res.json({
      message: 'Profile updated successfully',
      profile: updated,
    });
  } catch (error) {
    console.error('Error updating manager profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== VENDOR SERVICES (READ ONLY) ====================

// Get vendor services (Manager view)
router.get('/vendors/:vendorId/services', protect, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { vendorId } = req.params;

    console.log(`📋 Manager fetching services for vendor: ${vendorId}`);

    // Try vendor_services table first, with updated_at (not createdat)
    let { data: services, error } = await supabase
      .from('vendor_services')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('updated_at', { ascending: false });

    // If vendor_services fails with column error, try services table
    if (error && error.code === '42703') {
      console.log(`⚠️ Column error in vendor_services, trying 'services' table...`);
      const servicesResult = await supabase
        .from('services')
        .select(`
          *,
          categories:service_category_map (
            category:service_categories (id, name)
          )
        `)
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false });

      if (servicesResult.error) {
        throw servicesResult.error;
      }
      services = servicesResult.data || [];
      error = null;
    } else if (error) {
      throw error;
    }

    // If vendor_services returns empty, try services table as fallback
    if ((!services || services.length === 0) && !error) {
      console.log(`⚠️ No services found in vendor_services, trying 'services' table...`);
      const servicesResult = await supabase
        .from('services')
        .select(`
          *,
          categories:service_category_map (
            category:service_categories (id, name)
          )
        `)
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false });

      if (!servicesResult.error) {
        services = servicesResult.data || [];
      }
    }

    // Transform to frontend format - handle both vendor_services and services table schemas
    const transformedServices = (services || []).map((service: any) => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      price: service.price,
      // Handle both duration_minutes (vendor_services) and duration (services)
      duration: service.duration_minutes || service.duration || 60,
      // Handle category - services table uses categories relation, vendor_services may have direct category
      category: service.category || (service.categories && service.categories[0]?.category?.name) || 'general',
      imageUrl: service.image_url || service.image || null,
      tags: service.tags || [],
      genderPreference: service.gender_preference || service.genderPreference || 'UNISEX',
      isActive: service.is_active !== undefined ? service.is_active : (service.isActive !== undefined ? service.isActive : true),
      vendorId: service.vendor_id || service.vendorId,
      createdAt: service.createdat || service.created_at || service.createdAt,
      updatedAt: service.updatedat || service.updated_at || service.updatedAt
    }));

    res.json({
      success: true,
      services: transformedServices
    });
  } catch (error: any) {
    console.error('Error fetching vendor services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch services', error: error.message });
  }
});


export default router;
