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
    console.log('[E-commerce Util] Fetching e-commerce credentials for userId:', userId);
    const settings = await Settings.findOne({ userId });
    
    if (!settings) {
      console.log('[E-commerce Util] ⚠️  No settings found for userId:', userId);
      return undefined;
    }
    
    if (!settings.ecommerceIntegration) {
      console.log('[E-commerce Util] ⚠️  No ecommerceIntegration in settings');
      return undefined;
    }
    
    // Check if ecommerceIntegration is an empty object
    const ecommerceKeys = Object.keys(settings.ecommerceIntegration || {});
    if (ecommerceKeys.length === 0) {
      console.log('[E-commerce Util] ⚠️  ecommerceIntegration exists but is an empty object');
      console.log('[E-commerce Util] Settings document ID:', settings._id);
      console.log('[E-commerce Util] Settings userId:', settings.userId);
      console.log('[E-commerce Util] Full settings object keys:', Object.keys(settings.toObject ? settings.toObject() : {}));
      return undefined;
    }
    
    if (!settings.ecommerceIntegration.platform) {
      console.log('[E-commerce Util] ⚠️  ecommerceIntegration exists but platform is missing');
      console.log('[E-commerce Util] ecommerceIntegration object:', JSON.stringify(settings.ecommerceIntegration, null, 2));
      console.log('[E-commerce Util] ecommerceIntegration type:', typeof settings.ecommerceIntegration);
      console.log('[E-commerce Util] ecommerceIntegration keys:', Object.keys(settings.ecommerceIntegration || {}));
      return undefined;
    }

    // Log the full ecommerceIntegration object for debugging
    console.log('[E-commerce Util] Raw ecommerceIntegration object:', JSON.stringify(settings.ecommerceIntegration, null, 2));
    console.log('[E-commerce Util] Stored base_url in DB:', settings.ecommerceIntegration.base_url);
    
    const { platform, base_url, api_key, api_secret, access_token } = settings.ecommerceIntegration;
    
    // Also check for WooCommerce-specific field names as fallback
    const woocommerceBaseUrl = (settings.ecommerceIntegration as any).store_url || base_url;
    const woocommerceApiKey = (settings.ecommerceIntegration as any).consumer_key || api_key;
    const woocommerceApiSecret = (settings.ecommerceIntegration as any).consumer_secret || api_secret;
    
    console.log('[E-commerce Util] Extracted credentials:', {
      platform,
      base_url: base_url || 'MISSING',
      store_url: woocommerceBaseUrl || 'MISSING',
      api_key: api_key ? `${api_key.substring(0, 10)}...***` : 'MISSING',
      consumer_key: woocommerceApiKey ? `${woocommerceApiKey.substring(0, 10)}...***` : 'MISSING',
      api_secret: api_secret ? 'PRESENT' : 'MISSING',
      consumer_secret: woocommerceApiSecret ? 'PRESENT' : 'MISSING',
      has_access_token: !!access_token
    });

    // Handle WooCommerce-specific field names (consumer_key/consumer_secret → api_key/api_secret)
    const finalBaseUrl = woocommerceBaseUrl || base_url;
    const finalApiKey = woocommerceApiKey || api_key;
    const finalApiSecret = woocommerceApiSecret || api_secret;
    
    // Use base_url as-is from database (it should already have /wp-json/wc/v3 appended when stored)
    // Send the complete URL to Python backend - DO NOT remove the API path
    console.log('[E-commerce Util] Final base_url to send to Python:', finalBaseUrl);
    console.log('[E-commerce Util] ⚠️  IMPORTANT: Sending complete URL with /wp-json/wc/v3 path to Python backend');

    // Validate that we have required fields for WooCommerce
    if (platform === 'woocommerce') {
      if (!finalBaseUrl || !finalApiKey || !finalApiSecret) {
        console.log('[E-commerce Util] ⚠️  WooCommerce credentials incomplete:', {
          has_base_url: !!finalBaseUrl,
          has_api_key: !!finalApiKey,
          has_api_secret: !!finalApiSecret
        });
        return undefined;
      }
    }

    // Return in the format expected by Python backend
    // Send the complete base_url as stored in database (includes /wp-json/wc/v3)
    const credentials = {
      platform,
      base_url: finalBaseUrl,
      api_key: finalApiKey,
      api_secret: finalApiSecret,
      access_token: access_token || '' // Empty string if not provided
    };
    
    console.log('[E-commerce Util] ✅ Returning credentials object:', {
      platform: credentials.platform,
      base_url: credentials.base_url,
      has_api_key: !!credentials.api_key,
      has_api_secret: !!credentials.api_secret,
      has_access_token: !!credentials.access_token
    });
    
    return credentials;
  } catch (error: any) {
    console.error('[E-commerce Util] Error fetching e-commerce credentials:', error.message);
    return undefined;
  }
}