import Settings from '../models/Settings';

/**
 * Get e-commerce credentials for a user
 * Returns the ecommerce_credentials object in the format expected by the Python backend
 */
export async function getEcommerceCredentials(userId: string): Promise<{
  platform?: string;
  base_url?: string;
  api_key?: string;
  api_secret?: string;
  access_token?: string;
} | undefined> {
  try {
    const settings = await Settings.findOne({ userId });
    
    if (!settings || !settings.ecommerceIntegration || !settings.ecommerceIntegration.platform) {
      return undefined;
    }

    const { platform, base_url, api_key, api_secret, access_token } = settings.ecommerceIntegration;

    // Return in the format expected by Python backend
    return {
      platform,
      base_url,
      api_key,
      api_secret,
      access_token: access_token || '' // Empty string if not provided
    };
  } catch (error: any) {
    console.error('[E-commerce Util] Error fetching e-commerce credentials:', error.message);
    return undefined;
  }
}