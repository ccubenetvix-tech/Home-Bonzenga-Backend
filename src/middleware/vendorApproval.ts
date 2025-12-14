import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

/**
 * Middleware to check if vendor is approved (blocks actions for pending vendors)
 * This should be used on routes that modify vendor data (services, products, employees)
 */
export const checkVendorApproved = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { vendorId: userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'Vendor ID is required' });
    }

    // Find vendor by userId from Supabase
    const vendorRes = await supabase
      .from('vendor')
      .select('*')
      .eq('user_id', userId)
      .single();

    // If vendor doesn't exist, allow through (will be created with PENDING status)
    // But this shouldn't happen in normal flow since vendor should exist
    if (vendorRes.error || !vendorRes.data) {
      console.warn(`⚠️  Vendor not found for userId: ${userId}`);
      return next();
    }

    const vendor = vendorRes.data;

    // Check Supabase Auth for source-of-truth email verification status
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(userId);

      if (!authError && authUser && authUser.email_confirmed_at) {
        // User is verified in Auth system
        // If vendor table thinks otherwise, update it now
        if (!vendor.email_verified && !vendor.emailVerified) {
          console.log(`🔄 Auto-syncing email verification for vendor ${userId}`);
          await supabase
            .from('vendor')
            .update({ email_verified: true, emailVerified: true }) // Update both for safety
            .eq('user_id', userId);

          // Update local object so downstream checks pass
          vendor.email_verified = true;
          vendor.emailVerified = true;
        }
      }
    } catch (err) {
      console.warn('Failed to check Supabase Auth status, falling back to db record:', err);
    }
    // Block actions if vendor is not approved
    if (!vendor.email_verified && !vendor.emailVerified) {
      return res.status(403).json({
        message: 'Please verify your email before accessing vendor tools.',
        status: vendor.status,
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (vendor.status === 'REJECTED') {
      return res.status(403).json({
        message: 'Your vendor application has been rejected.',
        status: vendor.status,
        reason: vendor.rejection_reason || vendor.rejectionReason || null,
        code: 'VENDOR_REJECTED',
      });
    }

    if (vendor.status !== 'APPROVED') {
      return res.status(403).json({
        message: 'Manager approval is required before you can manage vendor resources.',
        status: vendor.status,
        code: 'VENDOR_PENDING_APPROVAL',
      });
    }

    next();
  } catch (error) {
    console.error('Error checking vendor approval status:', error);
    next(); // Allow through on error to avoid breaking existing functionality
  }
};

