import { Router, Response } from 'express';
import { supabase } from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { checkVendorApproved } from '../middleware/vendorApproval';
import multer from 'multer';

// Use memory storage for Multer
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB to match frontend
    },
});

const router = Router();

// ----------------------------------------------------------------------
// GET ALL SERVICES
// ----------------------------------------------------------------------
router.get('/:vendorId/services', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { vendorId: paramId } = req.params;
        const userId = req.user?.id;
        const userRole = req.user?.role || '';

        console.log(`📥 GET /api/vendor/${paramId}/services - Fetching services. Request by: ${userId} (${userRole})`);

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        let targetUserId = userId;

        // If Admin or Manager, allow viewing any vendor
        if (['ADMIN', 'MANAGER'].includes(userRole) && paramId) {
            targetUserId = paramId;
        }

        // Find the vendor record for this user
        const { data: vendor, error: vendorError } = await supabase
            .from('vendor')
            .select('id')
            .eq('user_id', targetUserId)
            .single();

        if (vendorError || !vendor) {
            return res.status(404).json({ message: 'Vendor not found' });
        }

        // Fetch services from services table (services, not vendor_services? Check schema)
        // User used 'vendor_services' in their code. But earlier 'vendor.ts' used 'services'.
        // 'vendor.ts' (lines 260) -> supabase.from('services').
        // User's code for 'vendor-services.ts' -> supabase.from('vendor_services').
        // This is a discrepancy. I'll stick to 'services' table if that's what vendor.ts used, OR check if 'vendor_services' exists.
        // User said "The following changes were made by the USER to ... vendor-services.ts" and it used 'vendor_services'.
        // But `list_dir` showed `vendor.ts` exists and I read it, and it used `services`.
        // If I use `vendor_services`, it might fail if the table doesn't exist.
        // However, the User might have created a view or table?
        // Given I previously read `vendor.ts` and it used `services` (view_file output Step 52 line 261: .from('services')),
        // I should probably use `services`.
        // BUT, maybe the User WANTS to use `vendor_services`? 
        // User's code: `.from('vendor_services')`
        // I'll check if `vendor_services` table exists? No easy way.
        // I'll check `vendor.ts` again. The conflict resolution (Step 50) mentioned "update table names (e.g., services to vendor_services)".
        // Ah! Conflict resolution summary said: "accepting the incoming changes that update table names (e.g., services to vendor_services)".
        // So `services` table might have been RENAMED to `vendor_services`.
        // But `vendor.ts` I read (Step 52) still says `.from('services')`.
        // Maybe `vendor.ts` is outdated or merging failed to update it?
        // OR `vendor_services` is the new table.
        // I will use `vendor_services` as per User's code.

        const { data: services, error: servicesError } = await supabase
            .from('vendor_services')
            .select('*')
            .eq('vendor_id', vendor.id)
            .order('updated_at', { ascending: false });

        // If error is "relation does not exist", fallback to 'services'?
        // Cannot do that easily in one go.
        // I'll assume User knows what they are doing with 'vendor_services'.

        if (servicesError) {
            // Fallback to 'services' if vendor_services not found (common issue during migration)
            if (servicesError.code === '42P01') { // undefined_table
                console.warn("Table vendor_services not found, trying 'services'");
                const { data: fallbackServices, error: fallbackError } = await supabase
                    .from('services')
                    .select('*')
                    .eq('vendor_id', vendor.id) // check column name too? 'services' table has 'vendor_id'
                    .order('created_at', { ascending: false });

                if (fallbackError) throw fallbackError;

                const transformedServices = (fallbackServices || []).map((s: any) => ({
                    ...s,
                    vendorId: s.vendor_id,
                    updatedAt: s.updated_at || s.created_at,
                    isActive: s.is_active,
                    imageUrl: s.image_url || s.image, // vendor.ts uses image? No, vendor.ts services queries didn't select specific columns, just *.
                    // map other fields
                    duration: s.duration, // services table uses duration
                    tags: s.tags || [],
                    gender: s.gender_preferences || []
                }));
                return res.json({ services: transformedServices });
            }
            throw servicesError;
        }

        // Transform to camelCase for frontend
        const transformedServices = (services || []).map((s: any) => ({
            ...s,
            vendorId: s.vendor_id,
            updatedAt: s.updated_at,
            isActive: s.is_active,
            imageUrl: s.image_url,
            // Map DB columns to frontend expected props
            duration: s.duration_minutes,
            tags: s.tags || [],
            gender: s.gender_preferences,
        }));

        res.json({ services: transformedServices });
    } catch (error: any) {
        console.error('❌ Error fetching services:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ----------------------------------------------------------------------
// CREATE NEW SERVICE
// ----------------------------------------------------------------------
router.post(
    '/:id/services',
    authenticate,          // 1. MUST BE FIRST
    checkVendorApproved,   // 2. Security check
    upload.single('image'),// 3. File upload
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            // 1. AUTH & VENDOR RESOLUTION
            if (!req.user || !req.user.id) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const userId = req.user.id;

            // QUERY VENDOR FROM DB
            const { data: vendor, error: vendorError } = await supabase
                .from('vendor')
                .select('id')
                .eq('user_id', userId)
                .limit(1)
                .single();

            if (vendorError || !vendor) {
                return res.status(400).json({ message: 'Vendor profile not found' });
            }

            const vendorId = vendor.id;

            // 2. VALIDATE FILE INPUT
            // Note: Frontend might rely on multer even if field name isn't exactly 'image', but form data usually matches.
            // If image is optional (e.g. edit mode?), handle it. But creation usually requires it.
            if (!req.file) {
                // Warn but maybe allow? User code said "Service image is required".
                return res.status(400).json({ message: 'Service image is required' });
            }

            // 3. PARSE BODY SAFELY
            const price = Number(req.body.price);
            const duration_minutes = Number(req.body.duration_minutes || req.body.duration); // Support 'duration' too

            if (isNaN(price)) {
                return res.status(400).json({ message: 'Invalid price' });
            }
            // If duration is NaN, maybe default to 30? Or error.

            if (!req.body.name || !req.body.category) {
                return res.status(400).json({ message: 'Service name and category are required' });
            }

            // 3b. RESOLVE CATEGORY
            let categoryId = req.body.categoryId;
            const categoryName = req.body.category;

            if (!categoryId && categoryName) {
                // Try to find category by name
                const { data: catData } = await supabase
                    .from('service_categories')
                    .select('id')
                    .ilike('name', categoryName)
                    .single();

                if (catData) {
                    categoryId = catData.id;
                } else {
                    console.warn(`Category '${categoryName}' not found in service_categories`);
                }
            }

            // 4. UPLOAD IMAGE
            const file = req.file;
            const fileExt = file.originalname.split('.').pop() || 'jpg';
            const filePath = `services/${vendorId}/${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('product-images') // Reusing properly configured bucket
                .upload(filePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (uploadError) {
                console.error('Image upload failed:', uploadError);
                return res.status(400).json({ message: `Image upload failed: ${uploadError.message}` });
            }

            const { data: { publicUrl } } = supabase.storage
                .from('product-images')
                .getPublicUrl(filePath);

            // 5. INSERT SERVICE
            const serviceData = {
                vendor_id: vendorId,
                name: req.body.name,
                description: req.body.description || null,
                category: req.body.category,
                price: price,
                duration_minutes: !isNaN(duration_minutes) ? duration_minutes : 60,
                image_url: publicUrl,
                tags: req.body.tags ? (typeof req.body.tags === 'string' ? req.body.tags.split(',').map((t: string) => t.trim()) : req.body.tags) : [],
                is_active: true,
                updated_at: new Date().toISOString()
            };

            console.log('📝 Inserting Service:', serviceData);

            // Attempt insert
            const result1 = await supabase
                .from('vendor_services')
                .insert(serviceData)
                .select()
                .single();

            if (result1.error) {
                console.error('Service insert error:', result1.error);
                // Return FULL error details for debugging
                return res.status(500).json({
                    message: 'Database error during service creation',
                    error: result1.error,
                    details: result1.error.message,
                    code: result1.error.code,
                    hint: result1.error.hint
                });
            }

            const service = result1.data;

            // The `insertError` variable is no longer used in this revised logic,
            // as `result1.error` is handled directly.
            // Keeping the check for `insertError` would be redundant or indicate a logic flaw.
            // Removing the `if (insertError)` block as it's not set in the new flow.

            // 6. SUCCESS RESPONSE
            return res.status(201).json({
                message: 'Service created successfully',
                service: {
                    ...service,
                    isActive: service.is_active,
                    duration: service.duration_minutes
                }
            });

        } catch (error: any) {
            console.error('❌ FATAL ERROR in POST /services:', error);
            return res.status(500).json({
                message: 'Internal server error',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
);

// ----------------------------------------------------------------------
// DELETE SERVICE
// ----------------------------------------------------------------------
router.delete('/:vendorId/services/:serviceId', authenticate, async (req, res) => {
    try {
        const { serviceId } = req.params;
        const { error } = await supabase.from('vendor_services').delete().eq('id', serviceId);
        if (error) {
            // Try services
            if (error.code === '42P01') {
                const { error: error2 } = await supabase.from('services').delete().eq('id', serviceId);
                if (error2) throw error2;
            } else {
                throw error;
            }
        }
        res.json({ message: 'Service deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
