import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: false
  }
});

let isRedisConnected = false;

redisClient.on('error', (err) => {
  // Silently handle Redis errors in development
  if (process.env.NODE_ENV === 'production') {
    console.error('Redis Client Error', err);
  }
});

export const connectRedis = async () => {
  try {
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]);
    isRedisConnected = true;
    console.log('✓ Redis Connected');
  } catch (error) {
    isRedisConnected = false;
    console.log('⚠ Redis not available - running without cache (some features disabled)');
    // Ensure client is disconnected if connection failed
    try {
      if (redisClient.isOpen) {
        await redisClient.disconnect();
      }
    } catch (e) {
      // Ignore disconnect errors
    }
  }
};

export const isRedisAvailable = () => isRedisConnected;

export default redisClient;

