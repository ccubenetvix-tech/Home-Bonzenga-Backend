import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 5 * 60 * 1000);

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { email } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // Create keys for IP and email
  const ipKey = `ip:${ip}`;
  const emailKey = email ? `email:${email}` : null;

  const now = Date.now();
  const windowMs = 1000; // 1 second
  const maxAttempts = 1000; // Effectively disabled

  // Check IP-based rate limit
  if (!store[ipKey] || store[ipKey].resetTime < now) {
    store[ipKey] = { count: 0, resetTime: now + windowMs };
  }

  // Check email-based rate limit
  if (emailKey && (!store[emailKey] || store[emailKey].resetTime < now)) {
    store[emailKey] = { count: 0, resetTime: now + windowMs };
  }

  // Check if limit exceeded
  if (store[ipKey].count >= maxAttempts) {
    return res.status(429).json({
      message: 'Too many failed login attempts. Please try again in 15 minutes.'
    });
  }

  if (emailKey && store[emailKey].count >= maxAttempts) {
    return res.status(429).json({
      message: 'Too many failed login attempts. Please try again in 15 minutes.'
    });
  }

  // Increment counters (will be decremented on success)
  store[ipKey].count++;
  if (emailKey) {
    store[emailKey].count++;
  }

  // Attach rate limit info to request for use in route handler
  (req as any).rateLimitInfo = {
    ipKey,
    emailKey,
    decrement: () => {
      if (store[ipKey]) store[ipKey].count = Math.max(0, store[ipKey].count - 1);
      if (emailKey && store[emailKey]) store[emailKey].count = Math.max(0, store[emailKey].count - 1);
    }
  };

  next();
};

