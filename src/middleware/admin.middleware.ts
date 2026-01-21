import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { AppError } from './error.middleware';

/**
 * Require admin role middleware
 * STRICT: Only allows users with role === 'admin' in database
 * No email whitelist - only database role matters
 */
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Not authenticated'));
  }

  const userRole = req.user.role;

  // STRICT CHECK: Only allow if role === 'admin'
  if (userRole !== 'admin') {
    console.warn(`[Admin] Non-admin user attempted admin access. Role: ${userRole}, Email: ${req.user.email}`);
    return next(new AppError(403, 'FORBIDDEN', 'Admin access required. Only users with admin role can access this resource.'));
  }

  return next();
};
