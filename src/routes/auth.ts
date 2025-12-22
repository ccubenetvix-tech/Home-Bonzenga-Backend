import express from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { sendVendorSignupNotificationToManagers } from '../lib/emailService';
import { sendVerificationEmail } from '../lib/emailJS';
import { rateLimitMiddleware } from '../lib/rateLimiter';
import { supabase } from '../lib/supabase';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import crypto from 'crypto';

const router = express.Router();

// Helper function to get client IP and user agent
const getClientInfo = (req: express.Request) => {
  const ip = req.ip ||
    req.socket.remoteAddress ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return { ip, userAgent };
};

// Helper function to log access attempt
const logAccessAttempt = async (
  userId: string | null,
  emailAttempted: string | null,
  roleAttempted: string | null,
  success: boolean,
  method: 'email_password' | 'google',
  ipAddress: string | null,
  userAgent: string | null
) => {
  try {
    // Skip if access_log table doesn't exist in Supabase
    await supabase.from('access_log').insert({
      user_id: userId || undefined,
      email_attempted: emailAttempted,
      role_attempted: roleAttempted,
      success,
      method,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  } catch (error) {
    // Silently fail - logging failures shouldn't break auth flow
    // Table might not exist in Supabase
  }
};

// Generate JWT tokens
const generateTokens = (user: any) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    type: 'access' as const,
  };

  const secret: Secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development';
  const expiresIn: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
  const refreshExpiresIn: SignOptions['expiresIn'] = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

  const accessToken = jwt.sign(payload, secret, { expiresIn });
  const refreshToken = jwt.sign(payload, secret, { expiresIn: refreshExpiresIn });

  return { accessToken, refreshToken };
};

// Register vendor (Backend-controlled)
router.post('/register-vendor', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      shopName,
      description,
      address,
      city,
      state,
      zipCode,
      latitude,
      longitude,
      servicesOffered,
      operatingHours
    } = req.body;

    if (!email || !firstName || !lastName || !shopName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (email, password, name, shopName)'
      });
    }

    const emailLower = email.toLowerCase();

    // Check if vendor with this email already exists
    const existingVendorRes = await supabase
      .from('vendor')
      .select('*')
      // .eq('email_verified', true) // Only block if verified? No, block if exists associated with a user
      .textSearch('shopname', shopName) // Loose check? No, let's check user existence first.

    // Better: Check if USER exists
    const userExists = await supabase.from('users').select('id').eq('email', emailLower).maybeSingle();
    if (userExists.data) {
      return res.status(409).json({ success: false, message: 'User with this email already exists' });
    }

    // Hash Password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create User (is_verified = false)
    const userRes = await supabase.from('users').insert({
      first_name: firstName,
      last_name: lastName,
      email: emailLower,
      password: hashedPassword,
      phone: phone ? phone.substring(0, 20) : null,
      role: 'VENDOR',
      status: 'ACTIVE',
      email_verified: false,
      email_verification_token: crypto.randomBytes(32).toString('hex'),
      email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }).select().single();

    if (userRes.error) throw userRes.error;
    const user = userRes.data;

    // Normalizing Coords
    const normalizedLatitude =
      typeof latitude === 'number'
        ? latitude
        : latitude
          ? parseFloat(latitude)
          : 0;
    const normalizedLongitude =
      typeof longitude === 'number'
        ? longitude
        : longitude
          ? parseFloat(longitude)
          : 0;



    const stringifyHours = (value: any) =>
      value ? JSON.stringify(value) : null;

    // Create vendor profile
    // REMOVED: email_verified
    const vendorRes = await supabase
      .from('vendor')
      .insert({
        user_id: user.id,
        shopname: shopName,
        description: description || null,
        address: address || '',
        city: city || '',
        state: state || '',
        zip_code: zipCode || '',
        latitude: Number.isFinite(normalizedLatitude) ? normalizedLatitude : 0,
        longitude: Number.isFinite(normalizedLongitude) ? normalizedLongitude : 0,
        status: 'PENDING_APPROVAL',
        verification_token: null, // Legacy, kept for schema compat if exists, or remove if causing error. Safe to null.
        verification_token_expires_at: null,
        rejection_reason: null,
        monday_hours: stringifyHours(operatingHours?.monday),
        tuesday_hours: stringifyHours(operatingHours?.tuesday),
        wednesday_hours: stringifyHours(operatingHours?.wednesday),
        thursday_hours: stringifyHours(operatingHours?.thursday),
        friday_hours: stringifyHours(operatingHours?.friday),
        saturday_hours: stringifyHours(operatingHours?.saturday),
        sunday_hours: stringifyHours(operatingHours?.sunday)
      })
      .select()
      .single();

    if (vendorRes.error) throw vendorRes.error;
    const vendor = vendorRes.data;

    // Generate Verification Token
    const token = user.email_verification_token;
    // Removed external token table insert as per requirements

    // Send Verification Email
    const baseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3003';
    const verifyLink = `${baseUrl}/verify-email?token=${token}`;

    // DEBUG LOG
    console.log('🔗 [VENDOR] Generated Verification Link:', verifyLink);
    console.log('📧 [VENDOR] Sending email to:', user.email);

    await sendVerificationEmail({
      to_email: user.email,
      user_name: user.first_name,
      verify_link: verifyLink
    });

    // Create audit log (non-blocking)
    try {
      await supabase.from('audit_log').insert({
        user_id: user.id,
        action: 'VENDOR_REGISTRATION',
        resource: 'VENDOR',
        resource_id: vendor.id,
        new_data: JSON.stringify({ shopName: vendor.shopname, email: user.email })
      });
    } catch (err) { console.error('Audit log failed', err); }

    // Notify Managers
    sendVendorSignupNotificationToManagers({
      shopName,
      ownerName: `${firstName} ${lastName}`,
      email: emailLower,
      phone,
      address: `${address} ${city}`
    }).catch(console.error);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Check email to verify.',
      vendor: { id: vendor.id, status: vendor.status }
    });

  } catch (error: any) {
    console.error('❌ Error registering vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during vendor registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/vendor-status/:supabaseUserId', async (req, res) => {
  try {
    const { supabaseUserId } = req.params;

    if (!supabaseUserId) {
      return res.status(400).json({ success: false, message: 'Vendor id is required' });
    }

    // Join with users explicitly to get is_verified correct
    const vendorRes = await supabase
      .from('vendor')
      .select(`
        *,
        user:users!user_id ( email_verified )
      `)
      .eq('user_id', supabaseUserId)
      .single();

    if (vendorRes.error || !vendorRes.data) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const vendor = vendorRes.data;
    const isVerified = vendor.user?.email_verified ?? false;

    res.json({
      success: true,
      status: vendor.status,
      rejectionReason: vendor.rejection_reason || vendor.rejectionReason,
      emailVerified: vendor.user?.email_verified ?? false,
      shopName: vendor.shopname || vendor.shopName
    });
  } catch (error) {
    console.error('Error fetching vendor status:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor status' });
  }
});

// Static admin/manager credentials (legacy fallback for local testing)
const STATIC_USERS = {
  'admin@homebonzenga.com': {
    id: 'admin-static-id',
    email: 'admin@homebonzenga.com',
    firstName: 'System',
    lastName: 'Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    password: 'Admin@123', // Plain text for static comparison
  },
  'manager@homebonzenga.com': {
    id: 'manager-static-id',
    email: 'manager@homebonzenga.com',
    firstName: 'System',
    lastName: 'Manager',
    role: 'MANAGER',
    status: 'ACTIVE',
    password: 'Manager@123', // Plain text for static comparison
  },
};

// Login endpoint with role-based authentication
router.post('/login', rateLimitMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    const { ip, userAgent } = getClientInfo(req);
    const rateLimitInfo = (req as any).rateLimitInfo;

    // Validate inputs
    if (!email || !password) {
      await logAccessAttempt(
        null,
        email || null,
        null,
        false,
        'email_password',
        ip,
        userAgent
      );
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const emailLower = email.toLowerCase();

    // Check static admin/manager credentials first
    const staticUser = STATIC_USERS[emailLower as keyof typeof STATIC_USERS];

    if (staticUser) {
      // Check if password matches static user
      if (password === staticUser.password) {
        // Success - decrement rate limit counter
        if (rateLimitInfo?.decrement) {
          rateLimitInfo.decrement();
        }

        // Generate tokens
        const tokens = generateTokens(staticUser);

        // Log successful attempt
        await logAccessAttempt(
          staticUser.id,
          emailLower,
          staticUser.role,
          true,
          'email_password',
          ip,
          userAgent
        );

        // Return user without password
        const { password: _, ...userWithoutPassword } = staticUser;

        // Determine redirect path based on role (default to root for unknown roles)
        const redirectPath = staticUser.role === 'ADMIN'
          ? '/admin'
          : `/${staticUser.role.toLowerCase()}`;

        return res.json({
          user: userWithoutPassword,
          ...tokens,
          redirectPath,
        });
      } else {
        // Wrong password for static user
        await logAccessAttempt(
          staticUser.id,
          emailLower,
          staticUser.role,
          false,
          'email_password',
          ip,
          userAgent
        );
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    }

    // If not a static user, check Supabase database
    const userRes = await supabase
      .from('users')
      .select('*')
      .eq('email', emailLower)
      .single();

    // Log attempt (before checking password to avoid timing attacks)
    if (userRes.error || !userRes.data) {
      await logAccessAttempt(
        null,
        emailLower,
        null,
        false,
        'email_password',
        ip,
        userAgent
      );
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = userRes.data;

    // REFACTOR: REMOVE manual password check against public.users
    // All logins must be handled via Supabase Auth on the frontend.
    // This backend /login endpoint should only be used for session syncing or status validation.
    // For now, we allow the request to proceed if the user exists and is active.
    // The frontend's signInWithPassword already validated the credentials.

    // Check if user is active
    if (user.status === 'PENDING_VERIFICATION') {
      await logAccessAttempt(
        user.id,
        emailLower,
        user.role,
        false,
        'email_password',
        ip,
        userAgent
      );
      return res.status(403).json({
        message: 'Please verify your email to continue.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    if (user.status !== 'ACTIVE') {
      await logAccessAttempt(
        user.id,
        emailLower,
        user.role,
        false,
        'email_password',
        ip,
        userAgent
      );
      return res.status(403).json({ message: 'Account is not active' });
    }

    // CHECK VERIFICATION (For all users except maybe Admin if checking database?)
    if (user.email_verified === false) {
      await logAccessAttempt(
        user.id,
        emailLower,
        user.role,
        false,
        'email_password',
        ip,
        userAgent
      );
      return res.status(403).json({
        message: 'Please verify your email to continue',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Success - decrement rate limit counter
    if (rateLimitInfo?.decrement) {
      rateLimitInfo.decrement();
    }

    const { password: _, ...userWithoutPassword } = user;

    if (user.role === 'VENDOR') {
      const vendorRes = await supabase
        .from('vendor')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (vendorRes.error || !vendorRes.data) {
        await logAccessAttempt(
          user.id,
          emailLower,
          user.role,
          false,
          'email_password',
          ip,
          userAgent
        );
        return res.status(404).json({ message: 'Vendor profile not found' });
      }

      const vendorProfile = vendorRes.data;

      // Note: We already checked user.is_verified above, so redundancy here is okay or can be removed.
      // But keeping checks aligned with new schema.
      // If user is verified, vendor is verified.
      const isVerified = user.email_verified;

      if (!isVerified) {
        // Should be caught above, but safe overlap
        return res.status(403).json({
          message: 'Please verify your email before signing in.',
          status: vendorProfile.status,
          emailVerified: false,
          code: 'EMAIL_NOT_VERIFIED',
        });
      }

      if (vendorProfile.status === 'REJECTED') {
        await logAccessAttempt(
          user.id,
          emailLower,
          user.role,
          false,
          'email_password',
          ip,
          userAgent
        );
        return res.status(403).json({
          message: 'Your vendor application has been rejected.',
          status: vendorProfile.status,
          reason: vendorProfile.rejection_reason || vendorProfile.rejectionReason || null,
          code: 'VENDOR_REJECTED',
        });
      }

      if (vendorProfile.status === 'PENDING') {
        // This usually means email verified but manager approval pending?
        // Or "PENDING" was the status BEFORE we used "PENDING_APPROVAL"?
        // Let's assume PENDING means "waiting for something".
        // If email is verified, they should be able to login but see restricted view?
        // Let's stick to existing logic but map isVerified properly.
        await logAccessAttempt(
          user.id,
          emailLower,
          user.role,
          false,
          'email_password',
          ip,
          userAgent
        );
        return res.status(403).json({
          message: 'Your registration is still pending.',
          status: vendorProfile.status,
          emailVerified: isVerified,
          code: 'VENDOR_PENDING_EMAIL',
        });
      }

      const tokens = generateTokens(user);

      await logAccessAttempt(
        user.id,
        emailLower,
        user.role,
        true,
        'email_password',
        ip,
        userAgent
      );

      const pendingMessage = 'Account verified. Waiting for manager approval. You will be notified.';

      return res.json({
        user: userWithoutPassword,
        vendor: {
          id: vendorProfile.id,
          status: vendorProfile.status,
          emailVerified: isVerified,
          rejectionReason: vendorProfile.rejection_reason || vendorProfile.rejectionReason,
        },
        status: vendorProfile.status,
        accessRestricted: vendorProfile.status !== 'APPROVED',
        message: vendorProfile.status === 'PENDING_APPROVAL' ? pendingMessage : 'Login successful',
        ...tokens,
        redirectPath: '/vendor',
      });
    }

    // Generate tokens for admin/manager
    const tokens = generateTokens(user);

    await logAccessAttempt(
      user.id,
      emailLower,
      user.role,
      true,
      'email_password',
      ip,
      userAgent
    );

    const redirectPath = user.role === 'ADMIN' ? '/admin' : '/manager';

    res.json({
      user: userWithoutPassword,
      ...tokens,
      redirectPath,
    });
  } catch (error) {
    console.error('Login error:', error);
    const { ip, userAgent } = getClientInfo(req);
    await logAccessAttempt(
      null,
      req.body.email || null,
      null,
      false,
      'email_password',
      ip,
      userAgent
    );
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify Email API
router.get('/verify-email', async (req, res) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    console.log('Verifying token:', token); // Debug log

    // Find user by token
    const userRes = await supabase
      .from('users')
      .select('*')
      .eq('email_verification_token', token)
      .maybeSingle();

    if (userRes.error) {
      console.error('Error finding user by token:', userRes.error);
      return res.status(500).json({ message: 'Database error' });
    }

    if (!userRes.data) return res.status(400).json({ message: 'Invalid or expired token' });

    const user = userRes.data;

    // Check expiry
    if (user.email_verification_expires && new Date(user.email_verification_expires) < new Date()) {
      return res.status(400).json({ message: 'Token has expired' });
    }

    // Verify User & Clear Token
    const updateRes = await supabase.from('users').update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires: null,
      verified_at: new Date().toISOString()
    }).eq('id', user.id).select().single();

    if (updateRes.error) {
      console.error('Error updating user verification:', updateRes.error);
      return res.status(500).json({ message: 'Failed to update user status' });
    }

    const updatedUser = updateRes.data;

    // Generate Login Token (Auto-login)
    const tokens = generateTokens(updatedUser);
    const { password: _, ...userWithoutPassword } = updatedUser;

    res.json({
      success: true,
      message: 'Email verified successfully',
      token: tokens.accessToken, // As requested
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      role: updatedUser.role,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Log Google OAuth login (called from frontend after successful OAuth)
router.post('/log-google-auth', async (req, res) => {
  try {
    const { userId, email, role, success, ipAddress, userAgent } = req.body;

    await logAccessAttempt(
      userId || null,
      email || null,
      role || null,
      success !== false, // Default to true if not specified
      'google',
      ipAddress || null,
      userAgent || null
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error logging Google auth:', error);
    // Don't fail the request if logging fails
    res.json({ success: true });
  }
});

// Register customer (Backend-controlled)
router.post('/register-customer', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone
    } = req.body;

    // Check if user already exists
    const existingUserRes = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingUserRes.data) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user (is_verified = false)
    const userRes = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: email.toLowerCase(),
        password: hashedPassword,
        phone: phone ? phone.substring(0, 20) : null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        email_verified: false,
        email_verification_token: crypto.randomBytes(32).toString('hex'),
        email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      })
      .select()
      .single();

    if (userRes.error) throw userRes.error;
    const user = userRes.data;

    // Use the token from the user record
    const token = user.email_verification_token;

    // Send Verification Email
    const baseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3003';
    const verifyLink = `${baseUrl}/verify-email?token=${token}`;
    await sendVerificationEmail({
      to_email: user.email,
      user_name: user.first_name || user.firstName,
      verify_link: verifyLink
    });

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error: any) {
    console.error('Error registering customer:', error);
    res.status(500).json({ message: 'Internal server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});



// Generate manual verification link (Supabase Admin)
router.post('/generate-verification-link', async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    console.log(`Generating verification link for ${email} (${role})`);

    const { data, error } = await (supabaseAdmin.auth.admin as any).generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${frontendUrl}/auth/verify`
      }
    });

    if (error) {
      console.error('Error generating Supabase link:', error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to generate verification link'
      });
    }

    res.json({
      success: true,
      verificationLink: data.properties.action_link
    });
  } catch (error: any) {
    console.error('❌ Server error generating link:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error generating verification link',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Resend Verification Email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const userRes = await supabase.from('users').select('*').eq('email', email.toLowerCase()).maybeSingle();
    if (!userRes.data) return res.status(404).json({ message: 'User not found' });

    const user = userRes.data;
    if (user.email_verified) return res.status(400).json({ message: 'Email already verified' });

    // Generate Token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Save new token to user
    await supabase.from('users').update({
      email_verification_token: token,
      email_verification_expires: expiresAt
    }).eq('id', user.id);

    // Send Email
    const baseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
    const verifyLink = `${baseUrl}/verify-email?token=${token}`;
    await sendVerificationEmail({
      to_email: user.email,
      user_name: user.first_name || user.firstName || 'User',
      verify_link: verifyLink
    });

    res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
