import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { sendVendorSignupNotificationToManagers } from '../lib/emailService';

const router = Router();

// Middleware to protect routes (simplified for demo)
const protect = (req: any, res: any, next: any) => {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Get all vendors with search and filter
router.get('/', async (req, res) => {
  try {
    const { search, category, limit = 20, offset = 0 } = req.query;

    let query = supabase
      .from('vendor')
      .select(`
        *,
        user:users!user_id (*),
        services:services (
          *,
          categories:service_category_map (
            category:service_categories (*)
          )
        )
      `)
      .eq('status', 'APPROVED')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (search) {
      const searchStr = String(search);
      query = query.or(`shopName.ilike.%${searchStr}%,description.ilike.%${searchStr}%,address.ilike.%${searchStr}%,city.ilike.%${searchStr}%`);
    }

    const { data: vendors, error } = await query;

    if (error) throw error;

    // Filter by category in memory if needed (Supabase relation filtering is limited)
    let filteredVendors = vendors || [];
    if (category) {
      const categoryStr = String(category).toLowerCase();
      filteredVendors = filteredVendors.filter((vendor: any) =>
        vendor.services?.some((service: any) =>
          service.categories?.some((cat: any) =>
            cat.category?.name?.toLowerCase() === categoryStr
          )
        )
      );
    }

    // Transform the data to include calculated fields
    const transformedVendors = filteredVendors.map((vendor: any) => ({
      id: vendor.id,
      name: vendor.shopName,
      description: vendor.description,
      address: vendor.address,
      city: vendor.city,
      rating: 4.5 + Math.random() * 0.5, // Mock rating
      reviewCount: Math.floor(Math.random() * 200) + 50, // Mock review count
      distance: Math.random() * 5, // Mock distance
      categories: vendor.services?.flatMap((service: any) =>
        service.categories?.map((cat: any) => cat.category?.name?.toLowerCase()) || []
      ).filter((value: any, index: any, self: any) => self.indexOf(value) === index) || [],
      image: '/api/placeholder/300/200',
      isOpen: Math.random() > 0.2, // 80% chance of being open
      nextAvailableSlot: 'Today 2:00 PM', // Mock next available slot
      phone: vendor.user?.phone || '+1 (555) 123-4567',
      email: vendor.user?.email,
      workingHours: {
        'Monday': '9:00 AM - 7:00 PM',
        'Tuesday': '9:00 AM - 7:00 PM',
        'Wednesday': '9:00 AM - 7:00 PM',
        'Thursday': '9:00 AM - 7:00 PM',
        'Friday': '9:00 AM - 8:00 PM',
        'Saturday': '8:00 AM - 6:00 PM',
        'Sunday': '10:00 AM - 5:00 PM'
      }
    }));

    res.json({ vendors: transformedVendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify vendor email using token
router.get('/verify', async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : Array.isArray(req.query.token) ? req.query.token[0] : undefined;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required',
      });
    }

    const { data: vendor, error: fetchError } = await supabase
      .from('vendor')
      .select(`
        *,
        user:users!user_id (
          id, first_name, last_name, email, phone
        )
      `)
      .eq('verification_token', token)
      .single();

    if (fetchError || !vendor) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or already used verification token',
      });
    }

    if (!vendor.verification_token_expires_at || new Date(vendor.verification_token_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Verification link has expired. Please request a new one.',
      });
    }

    if (vendor.email_verified) {
      return res.json({
        success: true,
        message: 'Email already verified',
        status: vendor.status,
      });
    }

    const nextStatus = vendor.status === 'APPROVED' ? 'APPROVED' : 'PENDING_APPROVAL';

    const { data: updatedVendor, error: updateError } = await supabase
      .from('vendor')
      .update({
        email_verified: true,
        status: nextStatus,
        verification_token: null,
        verification_token_expires_at: null,
        rejection_reason: null,
      })
      .eq('id', vendor.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    const { error: auditError } = await supabase.from('audit_log').insert({
      user_id: vendor.user_id,
      action: 'VENDOR_EMAIL_VERIFIED',
      resource: 'VENDOR',
      resource_id: vendor.id,
      old_data: JSON.stringify({
        status: vendor.status,
        emailVerified: vendor.email_verified,
      }),
      new_data: JSON.stringify({
        status: updatedVendor.status,
        emailVerified: updatedVendor.email_verified,
      }),
    });

    if (auditError) {
      console.error('Failed to record audit log for vendor verification:', auditError);
    }

    if (updatedVendor.status === 'PENDING_APPROVAL') {
      sendVendorSignupNotificationToManagers({
        shopName: updatedVendor.shopName,
        ownerName: vendor.user ? `${vendor.user.first_name} ${vendor.user.last_name}`.trim() : 'Vendor',
        email: vendor.user?.email || '',
        phone: vendor.user?.phone || '',
        address: `${updatedVendor.address || ''}, ${updatedVendor.city || ''}, ${updatedVendor.state || ''} ${updatedVendor.zip_code || ''}`,
      }).catch((err: any) => {
        console.error('Failed to send manager notification email after verification:', err);
      });
    }

    res.json({
      success: true,
      message: updatedVendor.status === 'APPROVED'
        ? 'Email verified successfully.'
        : 'Email verified successfully. Waiting for manager approval.',
      status: updatedVendor.status,
    });
  } catch (error) {
    console.error('Error verifying vendor email:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while verifying email',
    });
  }
});

// Get vendor by ID with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: vendor, error } = await supabase
      .from('vendor')
      .select(`
        *,
        user:users!user_id (*),
        services:services (
          *,
          categories:service_category_map (
            category:service_categories (*)
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error || !vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Get beauticians (users with BEAUTICIAN role associated with this vendor)
    // Mock for now as relation might not exist
    const { data: beauticians } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'BEAUTICIAN')
      .limit(5);

    // Mock beautician data with vendor association
    const mockBeauticians = (beauticians || []).map((beautician: any) => ({
      id: beautician.id,
      name: `${beautician.first_name} ${beautician.last_name}`,
      specialization: ['Hair Styling', 'Facial Treatments', 'Makeup'].slice(0, Math.floor(Math.random() * 3) + 1),
      rating: 4.5 + Math.random() * 0.5,
      experience: Math.floor(Math.random() * 10) + 1,
      avatar: '/api/placeholder/100/100',
      isAvailable: Math.random() > 0.3,
      nextAvailableSlot: 'Today 3:00 PM'
    }));

    // Mock products
    const mockProducts = [
      {
        id: '1',
        name: 'Premium Hair Shampoo',
        description: 'Professional grade shampoo for all hair types',
        price: 25,
        image: '/api/placeholder/150/150',
        inStock: true,
        category: 'hair'
      },
      {
        id: '2',
        name: 'Anti-Aging Face Cream',
        description: 'Luxury face cream with anti-aging properties',
        price: 45,
        image: '/api/placeholder/150/150',
        inStock: true,
        category: 'face'
      },
      {
        id: '3',
        name: 'Nail Art Kit',
        description: 'Complete nail art kit with tools and colors',
        price: 35,
        image: '/api/placeholder/150/150',
        inStock: false,
        category: 'nail'
      }
    ];

    const transformedVendor = {
      id: vendor.id,
      name: vendor.shopName,
      description: vendor.description,
      address: vendor.address,
      city: vendor.city,
      rating: 4.5 + Math.random() * 0.5,
      reviewCount: Math.floor(Math.random() * 200) + 50,
      distance: Math.random() * 5,
      categories: vendor.services?.flatMap((service: any) =>
        service.categories?.map((cat: any) => cat.category?.name?.toLowerCase()) || []
      ).filter((value: any, index: any, self: any) => self.indexOf(value) === index) || [],
      images: ['/api/placeholder/800/400', '/api/placeholder/800/400'],
      isOpen: Math.random() > 0.2,
      nextAvailableSlot: 'Today 2:00 PM',
      phone: vendor.user?.phone || '+1 (555) 123-4567',
      email: vendor.user?.email,
      workingHours: {
        'Monday': '9:00 AM - 7:00 PM',
        'Tuesday': '9:00 AM - 7:00 PM',
        'Wednesday': '9:00 AM - 7:00 PM',
        'Thursday': '9:00 AM - 7:00 PM',
        'Friday': '9:00 AM - 8:00 PM',
        'Saturday': '8:00 AM - 6:00 PM',
        'Sunday': '10:00 AM - 5:00 PM'
      }
    };

    res.json({
      vendor: transformedVendor,
      services: vendor.services?.map((service: any) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        duration: service.duration,
        price: service.price,
        category: service.categories?.[0]?.category?.name?.toLowerCase() || 'general'
      })) || [],
      beauticians: mockBeauticians,
      products: mockProducts
    });
  } catch (error) {
    console.error('Error fetching vendor details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new booking
router.post('/:id/bookings', protect, async (req, res) => {
  try {
    const { id: vendorId } = req.params;
    const {
      customerId,
      services,
      products,
      scheduledDate,
      scheduledTime,
      customerInfo,
      total
    } = req.body;

    // Validate vendor exists
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('id', vendorId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Resolve required fields: duration and addressId
    const serviceIds = Array.isArray(services) ? services.map((s: any) => s.id) : [];
    let computedDuration = 0;

    if (serviceIds.length > 0) {
      const { data: dbServices } = await supabase
        .from('services')
        .select('duration')
        .in('id', serviceIds);

      if (dbServices) {
        computedDuration = dbServices.reduce((sum, s) => sum + (s.duration || 0), 0);
      }
    }

    // Prefer explicit addressId from request, else user's default address, or create a temporary one
    const bodyAddressId = (req.body && (req.body.addressId || req.body?.customerInfo?.addressId)) as string | undefined;
    let resolvedAddressId = bodyAddressId;

    if (!resolvedAddressId) {
      const { data: defaultAddress } = await supabase
        .from('addresses')
        .select('id')
        .eq('userId', customerId)
        .eq('isDefault', true)
        .single();

      if (defaultAddress) {
        resolvedAddressId = defaultAddress.id;
      } else {
        // Create a temporary address if needed (logic omitted for brevity, assuming addressId is provided or optional)
        // For now, if no address, we might fail or proceed if address is not strictly required by DB constraint
      }
    }

    // Create booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        customer_id: customerId,
        vendor_id: vendorId,
        address_id: resolvedAddressId, // Might be null if not found
        status: 'PENDING',
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        duration: computedDuration,
        subtotal: total, // Simplified
        total: total,
        notes: customerInfo?.notes
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    // Create booking items
    if (services && services.length > 0) {
      const bookingItems = services.map((service: any) => ({
        booking_id: booking.id,
        service_id: service.id,
        quantity: 1,
        price: service.price
      }));

      const { error: itemsError } = await supabase
        .from('booking_items')
        .insert(bookingItems);

      if (itemsError) console.error('Error creating booking items:', itemsError);
    }

    res.status(201).json({
      success: true,
      booking
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;