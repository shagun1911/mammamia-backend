/**
 * Normalize template variables to lowercase
 * Converts {{Name}} → {{name}}, {{Customer_Name}} → {{customer_name}}
 * 
 * @param text - Text containing template variables
 * @returns Object with normalized text and changed flag
 */
export function normalizeTemplateVariables(text: string): {
  normalized: string;
  changed: boolean;
} {
  if (!text || typeof text !== 'string') {
    return { normalized: text || '', changed: false };
  }

  const variableRegex = /{{\s*([^}]+)\s*}}/g;
  let changed = false;

  const normalized = text.replace(variableRegex, (match, varName) => {
    const trimmed = varName.trim();
    const lower = trimmed.toLowerCase();
    
    if (trimmed !== lower) {
      changed = true;
      // Preserve original spacing around variable name
      const leadingSpaces = varName.match(/^\s*/)?.[0] || '';
      const trailingSpaces = varName.match(/\s*$/)?.[0] || '';
      return `{{${leadingSpaces}${lower}${trailingSpaces}}}`;
    }
    
    return match; // No change needed
  });

  return { normalized, changed };
}

