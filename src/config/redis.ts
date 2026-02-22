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

// ── Shared ioredis connections for Bull queues ────────────────────────────────
// Bull creates 3 Redis connections per queue (client, subscriber, bclient).
// With 4 queues that's 12 connections – easy to hit free-tier limits.
// By sharing one subscriber and one client across all queues we drop to ~6 total.
let sharedSubscriber: IORedis | null = null;
let sharedClient: IORedis | null = null;

function makeIORedis(): IORedis {
  return new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,   // required by Bull
    enableReadyCheck: false,
    connectTimeout: 10000,
    retryStrategy(times) {
      return Math.min(times * 500, 5000);
    }
  });
}

/**
 * Pass this as the `createClient` option when constructing Bull queues.
 * Bull calls it with type = 'client' | 'subscriber' | 'bclient'.
 * - subscriber: shared (one per process)
 * - client: shared (one per process)
 * - bclient: unique per queue (Bull requirement for blocking commands)
 */
export function bullCreateClient(type: 'client' | 'subscriber' | 'bclient'): IORedis {
  if (type === 'subscriber') {
    if (!sharedSubscriber) sharedSubscriber = makeIORedis();
    return sharedSubscriber;
  }
  if (type === 'client') {
    if (!sharedClient) sharedClient = makeIORedis();
    return sharedClient;
  }
  // bclient must be unique per queue (used for BRPOPLPUSH)
  return makeIORedis();
}

export default redisClient;

