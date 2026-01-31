import { AppError } from '../middleware/error.middleware';

/**
 * Validate that all template variables in text use lowercase only
 * Enforces pattern: {{[a-z0-9_]+}}
 * 
 * @param text - Text to validate (first_message, system_prompt, etc.)
 * @param fieldName - Name of the field being validated (for error messages)
 * @throws AppError if invalid variables are found
 */
export function validateLowercaseTemplateVariables(text: string, fieldName: string): void {
  if (!text || typeof text !== 'string') {
    return; // Skip validation for empty/null values
  }

  const variableRegex = /{{\s*([^}]+)\s*}}/g;
  const invalidVars: string[] = [];

  let match;
  while ((match = variableRegex.exec(text)) !== null) {
    const varName = match[1].trim(); // Remove any whitespace inside {{ }}

    // Validate: only lowercase letters, numbers, and underscores allowed
    if (!/^[a-z0-9_]+$/.test(varName)) {
      invalidVars.push(`{{${varName}}}`);
    }
  }

  if (invalidVars.length > 0) {
    const uniqueInvalidVars = [...new Set(invalidVars)]; // Remove duplicates
    throw new AppError(
      422,
      'INVALID_TEMPLATE_VARIABLE',
      `${fieldName} contains invalid template variables. Use lowercase only: {{name}}, {{customer_name}}. Invalid variables: ${uniqueInvalidVars.join(', ')}`
    );
  }

  console.log(`[Agent Validation] ✅ Template variables validated successfully for ${fieldName}`);
}

