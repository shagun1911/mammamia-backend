/**
 * Build dynamic variables by merging customer_info and explicit dynamic_variables
 * Priority: explicit dynamic_variables (highest) > customer_info > fallback {}
 * 
 * @param customerInfo - Customer information (name, email, etc.)
 * @param explicitVariables - Explicitly provided dynamic variables (highest priority)
 * @returns Merged dynamic variables object
 */
export function buildDynamicVariables(
  customerInfo?: Record<string, any>,
  explicitVariables?: Record<string, any>
): Record<string, any> {
  // Start with customer_info as base
  const base: Record<string, any> = {};
  
  if (customerInfo) {
    // Extract name and email from customer_info
    if (customerInfo.name) {
      base.name = String(customerInfo.name).trim();
      base.customer_name = base.name; // Also set customer_name for compatibility
    }
    if (customerInfo.email) {
      base.email = String(customerInfo.email).trim();
    }
    
    // Include any other fields from customer_info
    Object.keys(customerInfo).forEach(key => {
      if (key !== 'name' && key !== 'email' && key !== 'phone') {
        const value = customerInfo[key];
        if (value !== undefined && value !== null) {
          base[key] = typeof value === 'string' ? value.trim() : value;
        }
      }
    });
  }
  
  // Merge explicit dynamic_variables (highest priority - overwrites base)
  if (explicitVariables && typeof explicitVariables === 'object') {
    Object.keys(explicitVariables).forEach(key => {
      const value = explicitVariables[key];
      if (value !== undefined && value !== null) {
        base[key] = typeof value === 'string' ? value.trim() : value;
      }
    });
  }
  
  // Ensure name and customer_name are always set (fallback to 'there')
  if (!base.name || base.name.trim() === '') {
    base.name = 'there';
    base.customer_name = 'there';
  } else if (!base.customer_name) {
    base.customer_name = base.name;
  }
  
  return base;
}

