import { createClient } from 'redis';
import IORedis from 'ioredis';

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: false
  }
});

let isRedisConnected = false;

redisClient.on('error', (err) => {
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

// ── Shared ioredis connections for Bull queues ────────────────────────────────
// Goal: absolute minimum Redis connections.
//   - 1 shared client (all queues)
//   - 1 shared subscriber (all queues)
//   - 1 bclient per queue (Bull requirement)
// With 4 queues: 2 shared + 4 bclient = 6 ioredis + 1 node-redis = 7 total
//
// CRITICAL: retries are capped at 3 to prevent connection storms that exhaust
// the Redis max-client limit on free-tier providers (Render/Upstash = 30 conn).
let sharedSubscriber: IORedis | null = null;
let sharedClient: IORedis | null = null;

function makeIORedis(): IORedis {
  const conn = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    connectTimeout: 10000,
    retryStrategy(times) {
      if (times > 3) return null;  // stop reconnecting after 3 attempts
      return Math.min(times * 1000, 3000);
    }
  });
  conn.on('error', () => {}); // prevent unhandled error crashes
  return conn;
}

export function bullCreateClient(type: 'client' | 'subscriber' | 'bclient'): IORedis {
  if (type === 'subscriber') {
    if (!sharedSubscriber) sharedSubscriber = makeIORedis();
    return sharedSubscriber;
  }
  if (type === 'client') {
    if (!sharedClient) sharedClient = makeIORedis();
    return sharedClient;
  }
  return makeIORedis();
}

export default redisClient;

