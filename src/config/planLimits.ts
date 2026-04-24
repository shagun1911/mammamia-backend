/**
 * PLAN LIMITS - Single Source of Truth
 * 
 * These limits define what each plan tier allows.
 * Used by webhook to activate plans and by middleware to enforce limits.
 */
export const PLAN_LIMITS = {
  free: {
    conversations: 20,
    minutes: 20,
    automations: 5,
  },
  setup: {
    conversations: 3500,
    minutes: 1500,
    automations: 75,
  },
  mileva: {
    conversations: 1000,
    minutes: 500,
    automations: 25,
  },
  nobel: {
    conversations: 2500,
    minutes: 1000,
    automations: 50,
  },
  pro: {
    conversations: 5000,
    minutes: 2000,
    automations: 100,
  },
} as const;

export type EffectiveFeatureLimits = {
  callMinutes: number;
  chatConversations: number;
  automations: number;
};

/**
 * Get plan limits for a plan key
 */
export function getPlanLimits(planKey: string): { conversations: number; minutes: number; automations: number } | null {
  const normalizedKey = planKey.toLowerCase().trim();
  
  // Handle plan slug variations
  if (normalizedKey === 'mileva-pack' || normalizedKey === 'mileva') {
    return PLAN_LIMITS.mileva;
  }
  if (normalizedKey === 'nobel-pack' || normalizedKey === 'nobel') {
    return PLAN_LIMITS.nobel;
  }
  if (normalizedKey === 'aistein-pro-pack' || normalizedKey === 'aistein-pro' || normalizedKey === 'pro') {
    return PLAN_LIMITS.pro;
  }
  if (normalizedKey === 'set-up' || normalizedKey === 'setup') {
    return PLAN_LIMITS.setup;
  }
  if (normalizedKey === 'free') {
    return PLAN_LIMITS.free;
  }
  
  // Try direct lookup
  return PLAN_LIMITS[normalizedKey as keyof typeof PLAN_LIMITS] || null;
}

/**
 * Resolve effective limits from plan features with fallback behavior.
 * If plan/features are missing, fallback to org plan slug defaults and then free.
 */
export function getEffectiveFeatureLimits(input: {
  plan?: { slug?: string; features?: Partial<EffectiveFeatureLimits> } | null;
  organization?: { plan?: string | null } | null;
}): EffectiveFeatureLimits {
  const freeDefaults = PLAN_LIMITS.free;
  const planFeatures = input.plan?.features;

  if (planFeatures) {
    return {
      callMinutes: typeof planFeatures.callMinutes === 'number' ? planFeatures.callMinutes : freeDefaults.minutes,
      chatConversations: typeof planFeatures.chatConversations === 'number' ? planFeatures.chatConversations : freeDefaults.conversations,
      automations: typeof planFeatures.automations === 'number' ? planFeatures.automations : freeDefaults.automations
    };
  }

  const fallbackKey = input.plan?.slug || input.organization?.plan || 'free';
  const fallback = getPlanLimits(fallbackKey) || freeDefaults;

  return {
    callMinutes: fallback.minutes,
    chatConversations: fallback.conversations,
    automations: fallback.automations
  };
}

