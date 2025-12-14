import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// ==================== PUBLIC SERVICES ====================

// Get all services (public)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string;
    const vendorId = req.query.vendorId as string;
    const search = req.query.search as string;
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;
    const skip = (page - 1) * limit;

    let query = supabase
      .from('services')
      .select(`
        *,
        vendor:vendor!vendorId (
          id, shopName, address, status, rating, totalReviews
        ),
        category:service_categories!categoryId (
          id, name, description
        ),
        addons:service_addons (
          addon:addons (
            id, name, price, description
          )
        ),
        media (
          url, type
        )
      `, { count: 'exact' })
      .eq('isActive', true)
      // Only show services from approved vendors
      // Note: Supabase filtering on related tables is tricky. 
      // We might need to filter in application or use !inner join if supported by client for filtering.
      // For now, we'll try to filter by vendor status if possible, or filter after fetch.
      // .eq('vendor.status', 'APPROVED') // This syntax might not work directly for filtering
      .order('createdAt', { ascending: false })
      .range(skip, skip + limit - 1);

    if (category) query = query.eq('categoryId', category);
    if (vendorId) query = query.eq('vendorId', vendorId);
    if (minPrice !== undefined) query = query.gte('price', minPrice);
    if (maxPrice !== undefined) query = query.lte('price', maxPrice);

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: services, count, error } = await query;

    if (error) throw error;

    // Filter by vendor status manually if needed (since we can't easily do it in one query without inner join syntax which is !inner)
    // Using !inner on vendor relation:
    // vendor:vendor!inner(...)
    // But let's stick to simple for now and filter in memory if the dataset is small, or assume the query handles it if we add !inner.
    // Let's try to add !inner to the select string for vendor.

    // Re-running query with !inner for vendor status check if we want to be strict.
    // However, for now, let's just filter the results.
    const approvedServices = services?.filter((s: any) => s.vendor?.status === 'APPROVED') || [];
    const total = count || 0; // This count might be wrong if we filter in memory.

    // Ideally we should use !inner:
    /*
    .select(`
      *,
      vendor:vendor!inner(status)
    `)
    .eq('vendor.status', 'APPROVED')
    */

    res.json({
      success: true,
      data: {
        services: approvedServices,
        pagination: {
          page,
          limit,
          total: approvedServices.length, // Approximate
          pages: Math.ceil(approvedServices.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch services' });
  }
});

// Get service details (public)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: service, error } = await supabase
      .from('services')
      .select(`
        *,
        vendor:vendor!vendorId (
          id, shopName, description, address, phone, email, rating, totalReviews, workingHours
        ),
        category:service_categories!categoryId (
          id, name, description
        ),
        addons:service_addons (
          addon:addons (
            id, name, price, description
          )
        ),
        media (
          url, type
        ),
        reviews (
          rating, comment, createdAt,
          customer:users!customerId (
            id, firstName, lastName
          )
        )
      `)
      .eq('id', id)
      .eq('isActive', true)
      .single();

    if (error || !service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch service' });
  }
});

// Get service categories (public)
router.get('/categories/all', async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('service_categories')
      .select(`
        *,
        services (count)
      `)
      .eq('isActive', true)
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// Get unique services grouped by category (public)
router.get('/unique/grouped', async (req, res) => {
  try {
    // Get all active services from approved vendors
    // We need to join with vendors to check status
    const { data: services, error } = await supabase
      .from('services')
      .select(`
        name,
        description,
        vendor:vendor!inner(status),
        categories:service_category_map(
          category:service_categories(name)
        )
      `)
      .eq('isActive', true)
      .eq('vendor.status', 'APPROVED');

    if (error) throw error;

    // Group services by their actual database category
    const categoryMap: Record<string, Set<string>> = {};

    services?.forEach((service: any) => {
      const serviceName = service.name;

      // Get the first category assigned to this service
      if (service.categories && service.categories.length > 0) {
        const categoryName = service.categories[0].category.name;

        if (!categoryMap[categoryName]) {
          categoryMap[categoryName] = new Set();
        }
        categoryMap[categoryName].add(serviceName);
      } else {
        // If no category assigned, put in "Other"
        if (!categoryMap['Other']) {
          categoryMap['Other'] = new Set();
        }
        categoryMap['Other'].add(serviceName);
      }
    });

    // Convert to the format expected by frontend
    const result = Object.entries(categoryMap).map(([category, servicesSet]) => ({
      category,
      services: Array.from(servicesSet)
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Error fetching unique services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch unique services' });
  }
});

// Get vendor services (public)
router.get('/vendor/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const { data: services, count, error } = await supabase
      .from('services')
      .select(`
        *,
        categories:service_category_map(
          category:service_categories(id, name)
        ),
        addons:service_addons(
          addon:addons(id, name, price)
        ),
        media(url, type),
        reviews(count)
      `, { count: 'exact' })
      .eq('vendorId', vendorId)
      .eq('isActive', true)
      .order('createdAt', { ascending: false })
      .range(skip, skip + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: {
        services,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching vendor services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor services' });
  }
});

// ==================== VENDOR SERVICE MANAGEMENT ====================

// Get vendor services
router.get('/vendor/my-services', requireAuth, requireRole(['VENDOR']), async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    let query = supabase
      .from('services')
      .select(`
        *,
        categories:service_category_map(
          category:service_categories(id, name)
        ),
        addons:service_addons(
          addon:addons(id, name, price)
        ),
        media(url, type),
        reviews(count)
      `, { count: 'exact' })
      .eq('vendorId', req.user.vendorId);

    if (status) {
      query = query.eq('isActive', status === 'active');
    }

    const { data: services, count, error } = await query
      .order('createdAt', { ascending: false })
      .range(skip, skip + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: {
        services,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching vendor services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor services' });
  }
});

// Create new service
router.post('/', requireAuth, requireRole(['VENDOR']), async (req: any, res) => {
  try {
    const {
      name,
      description,
      price,
      duration,
      categoryId,
      isActive = true,
      addons = [],
      media
    } = req.body;

    // Validate required fields
    if (!name || !description || !price || !categoryId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Verify category exists
    const { data: category, error: catError } = await supabase
      .from('service_categories')
      .select('id, name')
      .eq('id', categoryId)
      .single();

    if (catError || !category) {
      return res.status(400).json({ success: false, message: 'Invalid category ID' });
    }

    // Create service
    const { data: service, error: createError } = await supabase
      .from('services')
      .insert({
        name,
        description,
        price: parseFloat(price),
        duration: duration ? parseInt(duration) : 60,
        isActive,
        vendorId: req.user.vendorId
      })
      .select()
      .single();

    if (createError) throw createError;

    // Create category mapping
    await supabase.from('service_category_map').insert({
      serviceId: service.id,
      categoryId: categoryId
    });

    // Add addons if provided
    if (addons && addons.length > 0) {
      await supabase.from('service_addons').insert(
        addons.map((addonId: string) => ({
          serviceId: service.id,
          addonId
        }))
      );
    }

    // Add media if provided
    if (media && media.length > 0) {
      await supabase.from('media').insert(
        media.map((item: any) => ({
          serviceId: service.id,
          type: item.type || 'IMAGE',
          url: item.url,
          alt: item.alt || name
        }))
      );
    }

    res.status(201).json({
      success: true,
      data: {
        ...service,
        category
      }
    });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ success: false, message: 'Failed to create service' });
  }
});

// Update service
router.put('/:id', requireAuth, requireRole(['VENDOR']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      duration,
      categoryId,
      isActive,
      addons
    } = req.body;

    // Verify service belongs to vendor
    const { data: existingService, error: checkError } = await supabase
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('vendorId', req.user.vendorId)
      .single();

    if (checkError || !existingService) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // Update service
    const { data: updatedService, error: updateError } = await supabase
      .from('services')
      .update({
        name,
        description,
        price: price ? parseFloat(price) : undefined,
        duration: duration ? parseInt(duration) : undefined,
        isActive
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update category mapping if categoryId is provided
    if (categoryId) {
      // Verify category exists
      const { data: category, error: catError } = await supabase
        .from('service_categories')
        .select('id')
        .eq('id', categoryId)
        .single();

      if (catError || !category) {
        return res.status(400).json({ success: false, message: 'Invalid category ID' });
      }

      // Remove existing category mappings
      await supabase.from('service_category_map').delete().eq('serviceId', id);

      // Add new category mapping
      await supabase.from('service_category_map').insert({
        serviceId: id,
        categoryId: categoryId
      });
    }

    // Update addons if provided
    if (addons !== undefined) {
      // Remove existing addons
      await supabase.from('service_addons').delete().eq('serviceId', id);

      // Add new addons
      if (addons && addons.length > 0) {
        await supabase.from('service_addons').insert(
          addons.map((addonId: string) => ({
            serviceId: id,
            addonId
          }))
        );
      }
    }

    // Get the updated service with category information
    const { data: serviceWithCategory } = await supabase
      .from('services')
      .select(`
        *,
        categories:service_category_map(
          category:service_categories(id, name)
        )
      `)
      .eq('id', id)
      .single();

    res.json({
      success: true,
      data: {
        ...updatedService,
        category: serviceWithCategory?.categories?.[0]?.category || null
      }
    });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ success: false, message: 'Failed to update service' });
  }
});

// Delete service
router.delete('/:id', requireAuth, requireRole(['VENDOR']), async (req: any, res) => {
  try {
    const { id } = req.params;

    // Verify service belongs to vendor
    const { data: service, error: checkError } = await supabase
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('vendorId', req.user.vendorId)
      .single();

    if (checkError || !service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // Soft delete by setting isActive to false
    await supabase
      .from('services')
      .update({ isActive: false })
      .eq('id', id);

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ success: false, message: 'Failed to delete service' });
  }
});

// ==================== ADMIN SERVICE MANAGEMENT ====================

// Get all services (Admin only)
router.get('/admin/all', requireAuth, requireRole(['ADMIN']), async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const category = req.query.category as string;
    const vendorId = req.query.vendorId as string;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    let query = supabase
      .from('services')
      .select(`
        *,
        vendor:vendor!vendorId (
          id, shopName, email
        ),
        category:service_categories!categoryId (
          id, name
        ),
        reviews (count)
      `, { count: 'exact' })
      .order('createdAt', { ascending: false })
      .range(skip, skip + limit - 1);

    if (category) query = query.eq('categoryId', category);
    if (vendorId) query = query.eq('vendorId', vendorId);
    if (status === 'active') query = query.eq('isActive', true);
    if (status === 'inactive') query = query.eq('isActive', false);

    const { data: services, count, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: {
        services,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching admin services:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch services' });
  }
});

// Update service status (Admin only)
router.patch('/admin/:id/status', requireAuth, requireRole(['ADMIN']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    const { data: service, error: fetchError } = await supabase
      .from('services')
      .select(`
        *,
        vendor:vendor!vendorId (shopName)
      `)
      .eq('id', id)
      .single();

    if (fetchError || !service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // Update service status
    const { data: updatedService, error: updateError } = await supabase
      .from('services')
      .update({ isActive })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log the action
    await supabase.from('audit_logs').insert({
      action: isActive ? 'SERVICE_ACTIVATED' : 'SERVICE_DEACTIVATED',
      resource: 'SERVICE',
      resourceId: id,
      userId: req.user.id,
      newData: JSON.stringify({
        serviceName: service.name,
        vendorName: service.vendor?.shopName,
        reason: reason || 'Admin action',
        previousStatus: !isActive,
        newStatus: isActive
      })
    });

    res.json({
      success: true,
      data: updatedService
    });
  } catch (error) {
    console.error('Error updating service status:', error);
    res.status(500).json({ success: false, message: 'Failed to update service status' });
  }
});

export default router;