import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.util';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public message: string,
    public details?: any
  ) {
    super(message);
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log error for debugging
  console.error('Error occurred:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    stack: err.stack
  });

  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details;

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e: any) => ({
      field: e.path,
      message: e.message
    }));
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE';
    message = 'Resource already exists';
    
    // Safely extract key pattern information
    if (err.keyPattern && typeof err.keyPattern === 'object') {
      const keys = Object.keys(err.keyPattern);
      if (keys.length > 0) {
        details = { 
          field: keys[0],
          duplicateValue: err.keyValue ? err.keyValue[keys[0]] : undefined
        };
      }
    }
    
    // If we have a more specific error message from AppError, use it
    if (err.message && err.message !== 'Resource already exists') {
      message = err.message;
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'UNAUTHORIZED';
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'UNAUTHORIZED';
    message = 'Token expired';
  }

  res.status(statusCode).json(errorResponse(code, message, details));
};

// Async handler wrapper to catch errors and pass to error handler
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

