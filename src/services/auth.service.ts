import jwt, { SignOptions } from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import redisClient, { isRedisAvailable } from '../config/redis';
import { AppError } from '../middleware/error.middleware';

export class AuthService {
  // In-memory store as fallback when Redis is not available
  private refreshTokenStore: Map<string, string> = new Map();

  // Generate JWT token
  generateAccessToken(userId: string) {
    const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production';
    return jwt.sign(
      { userId },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } as SignOptions
    );
  }

  // Generate refresh token
  generateRefreshToken(userId: string) {
    const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production';
    return jwt.sign(
      { userId },
      jwtSecret,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' } as SignOptions
    );
  }

  // Store refresh token in Redis or memory
  async storeRefreshToken(userId: string, refreshToken: string) {
    if (isRedisAvailable()) {
      try {
        const expiresIn = 7 * 24 * 60 * 60; // 7 days in seconds
        await redisClient.setEx(`refresh_token:${userId}`, expiresIn, refreshToken);
      } catch (error) {
        // Fallback to memory store
        this.refreshTokenStore.set(`refresh_token:${userId}`, refreshToken);
      }
    } else {
      // Use memory store when Redis is not available
      this.refreshTokenStore.set(`refresh_token:${userId}`, refreshToken);
    }
  }

  // Verify refresh token from Redis or memory
  async verifyRefreshToken(userId: string, refreshToken: string) {
    if (isRedisAvailable()) {
      try {
        const storedToken = await redisClient.get(`refresh_token:${userId}`);
        return storedToken === refreshToken;
      } catch (error) {
        // Fallback to memory store
        const storedToken = this.refreshTokenStore.get(`refresh_token:${userId}`);
        return storedToken === refreshToken;
      }
    } else {
      // Use memory store when Redis is not available
      const storedToken = this.refreshTokenStore.get(`refresh_token:${userId}`);
      return storedToken === refreshToken;
    }
  }

  // Login
  async login(email: string, password: string) {
    const user = await User.findOne({ email, status: 'active' });
    
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
    }

    // Check if user is OAuth user (no password)
    if (!user.password && !user.passwordHash && user.provider !== 'local') {
      throw new AppError(401, 'UNAUTHORIZED', `Please sign in with ${user.provider}`);
    }

    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
    }

    const userId = (user._id as any).toString();
    const accessToken = this.generateAccessToken(userId);
    const refreshToken = this.generateRefreshToken(userId);

    await this.storeRefreshToken(userId, refreshToken);

    // Update last active
    user.lastActiveAt = new Date();
    await user.save();

    return {
      token: accessToken,
      refreshToken,
      expiresIn: 3600, // 1 hour in seconds
      user: {
        id: user._id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        role: user.role,
        organizationId: user.organizationId
      }
    };
  }

  // OAuth Login - handles both Google and Facebook
  async oauthLogin(user: IUser) {
    const userId = (user._id as any).toString();
    const accessToken = this.generateAccessToken(userId);
    const refreshToken = this.generateRefreshToken(userId);

    await this.storeRefreshToken(userId, refreshToken);

    // Update last active
    user.lastActiveAt = new Date();
    await user.save();

    return {
      token: accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: user._id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        role: user.role,
        organizationId: user.organizationId,
        provider: user.provider
      }
    };
  }

  // Refresh token
  async refreshToken(refreshToken: string) {
    try {
      const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production';
      const decoded: any = jwt.verify(refreshToken, jwtSecret);
      
      const isValid = await this.verifyRefreshToken(decoded.userId, refreshToken);
      
      if (!isValid) {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid refresh token');
      }

      const user = await User.findById(decoded.userId);
      
      if (!user || user.status !== 'active') {
        throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive');
      }

      const userId = (user._id as any).toString();
      const newAccessToken = this.generateAccessToken(userId);
      const newRefreshToken = this.generateRefreshToken(userId);

      await this.storeRefreshToken(userId, newRefreshToken);

      return {
        token: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600
      };
    } catch (error) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token');
    }
  }

  // Logout
  async logout(userId: string) {
    if (isRedisAvailable()) {
      try {
        await redisClient.del(`refresh_token:${userId}`);
      } catch (error) {
        // Fallback to memory store
        this.refreshTokenStore.delete(`refresh_token:${userId}`);
      }
    } else {
      // Use memory store when Redis is not available
      this.refreshTokenStore.delete(`refresh_token:${userId}`);
    }
    return { message: 'Logged out successfully' };
  }

  // Get current user
  async getCurrentUser(userId: string) {
    const user = await User.findById(userId).select('-passwordHash');
    
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    return {
      id: user._id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      avatar: user.avatar,
      role: user.role,
      organizationId: user.organizationId,
      permissions: user.permissions,
      createdAt: user.createdAt
    };
  }
}

export const authService = new AuthService();
