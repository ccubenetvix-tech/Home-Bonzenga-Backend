import { Response, NextFunction } from 'express';

export const authorizeAdmin = (req: any, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Access denied: Admin role required'
        });
    }
    next();
};
