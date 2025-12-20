import 'dotenv/config'; // Load environment variables first, ensuring it runs before other imports
// Restart trigger
require('../config.js');

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { supabase } from './lib/supabase';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3003',
  'http://localhost:5173',
  'http://localhost:8081'
];

app.use(cors({
  origin: true, // Reflects the request origin, effectively allowing all
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'apikey', 'X-Requested-With', 'Accept']
}));

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', true);

app.use(express.json());

// JWT utilities
const generateTokens = (user: any) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role
  };

  const secret: Secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development';
  const expiresIn: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
  const refreshExpiresIn: SignOptions['expiresIn'] = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

  const accessToken = jwt.sign(payload, secret, { expiresIn });
  const refreshToken = jwt.sign(payload, secret, { expiresIn: refreshExpiresIn });

  return { accessToken, refreshToken };
};

const hashPassword = async (password: string) => {
  return bcrypt.hash(password, 12);
};

const comparePassword = async (password: string, hashedPassword: string) => {
  return bcrypt.compare(password, hashedPassword);
};

// Note: Login endpoint is now handled by authRoutes at /api/auth/login
// This provides role-based authentication with logging and rate limiting

// NOTE: This endpoint is deprecated - use /api/auth/register-customer instead
app.post('/api/auth/register', async (req, res) => {
  try {
    // This endpoint is disabled - use Supabase auth or /api/auth/register-customer
    return res.status(410).json({ error: 'This endpoint is deprecated. Use /api/auth/register-customer or Supabase auth instead.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Import routes
import dashboardRoutes from './routes/dashboard';
import vendorRoutes from './routes/vendors';
import bookingRoutes from './routes/bookings';
import productsRoutes from './routes/products';
import vendorApiRoutes from './routes/vendor';
import authRoutes from './routes/auth';
import managerRoutes from './routes/manager';
import managerBookingsRoutes from './routes/manager-bookings';
import managerAthomeBookingsRoutes from './routes/manager-athome-bookings'; // Added
import managerHealthRoutes from './routes/manager-health';
import vendorBookingsRoutes from './routes/vendor-bookings';
import vendorProductsRoutes from './routes/vendor-products';
import vendorServicesRoutes from './routes/vendor-services';
import adminRoutes from './routes/admin';
import customerRoutes from './routes/customer';
import catalogRoutes from './routes/catalog';
import vendorEmployeesRoutes from "./routes/vendor-employees";
import atSalonBookingRoutes from './routes/at_salon_booking'; // IMPORT NEW ROUTE
import { verifyEmailTransport } from './lib/emailService';

// Use routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/at-salon-booking', atSalonBookingRoutes); // MOUNT NEW ROUTE
app.use('/api/products', productsRoutes); // Legacy?
app.use('/api/vendor', vendorProductsRoutes); // Mount products BEFORE vendor general routes to ensure priority
app.use('/api/vendor', vendorServicesRoutes); // Mount services BEFORE vendor general routes to ensure priority
app.use("/api/vendor", vendorEmployeesRoutes);
app.use('/api/vendor', vendorApiRoutes);
app.use('/api/vendor/bookings', vendorBookingsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/manager/bookings', managerBookingsRoutes);
app.use('/api/manager/athome-bookings', managerAthomeBookingsRoutes); // Added
app.use('/api/manager', managerHealthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/catalog', catalogRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Auth server running with Supabase' });
});

// Start server
import { testSupabaseConnection } from './lib/supabase';

const startServer = async () => {
  // Test DB connection first
  await testSupabaseConnection();

  app.listen(PORT, async () => {

    // Verify email transport (non-blocking)
    /*
    verifyEmailTransport().catch((err: any) => {
      console.warn('⚠️  Email service not available (non-critical):', err.message);
    });
    */

    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: ${allowedOrigins.join(', ')}`);
    console.log(`🌐 Also allowing all localhost origins in development`);
    console.log(`📝 Login credentials:`);
    console.log(`   Admin: admin@homebonzenga.com / admin123`);
    console.log(`   Manager: manager@homebonzenga.com / manager123`);
    console.log(`\n📍 Login endpoint: http://localhost:${PORT}/api/auth/login`);
    console.log(`📍 At-Salon Booking: http://localhost:${PORT}/api/at-salon-booking`);
    console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
    console.log(`\n💡 To test connection, visit: http://localhost:${PORT}/api/health`);
  });
};

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

export default app;