/**
 * PRODUCTION-GRADE GREETING RENDERER
 * 
 * SINGLE SOURCE OF TRUTH for greeting variable replacement
 * 
 * CRITICAL CONTRACT:
 * - Input: Template string with {{name}}, {{email}}, {{phone}}
 * - Output: Plain text string with NO variables, NO placeholders, NO special characters
 * - Guarantee: Output is ALWAYS safe for TTS engines
 * 
 * ROOT CAUSE ANALYSIS:
 * - TTS engines (ElevenLabs) reject text with unresolved variables
 * - Python API may pass through variables to TTS without validation
 * - Empty strings or malformed text cause call drops
 * - Multiple cleanup passes create race conditions
 * 
 * SOLUTION:
 * - Single-pass, deterministic replacement
 * - Pre-validate contact data BEFORE rendering
 * - Fail-fast if template is unsafe
 * - Never send templates downstream
 */

export interface ContactData {
  name: string;  // REQUIRED - never empty
  email?: string;
  phone?: string;
}

export interface RenderingResult {
  success: boolean;
  rendered: string;
  errors: string[];
  warnings: string[];
}

/**
 * STRICT VARIABLE CONTRACT
 * Supported variable formats:
 * - {{name}} or {{customer_name}} or {{contact.name}} - REQUIRED, always replaced
 * - {{email}} or {{customer_email}} or {{contact.email}} - Optional
 * - {{phone}} or {{phone_number}} or {{customer_phone_number}} or {{contact.phone_number}} - Optional
 * 
 * All formats are normalized to the same values for consistency.
 */
const ALLOWED_VARIABLES = [
  'name', 'customer_name', 'contact.name',
  'email', 'customer_email', 'contact.email', 
  'phone', 'phone_number', 'customer_phone_number', 'contact.phone_number'
] as const;
type AllowedVariable = typeof ALLOWED_VARIABLES[number];

/**
 * VALIDATION GATE: Pre-validate template before rendering
 * Returns errors if template is unsafe
 */
export function validateGreetingTemplate(template: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!template || typeof template !== 'string') {
    errors.push('Template is empty or not a string');
    return { valid: false, errors };
  }
  
  if (template.trim().length === 0) {
    errors.push('Template is empty after trimming');
    return { valid: false, errors };
  }
  
  // Check for unknown variables
  const variablePattern = /\{\{([^}]+)\}\}/g;
  const matches = template.match(variablePattern) || [];
  
  for (const match of matches) {
    const varName = match.replace(/\{\{|\}\}/g, '').trim().toLowerCase();
    if (!ALLOWED_VARIABLES.includes(varName as AllowedVariable)) {
      errors.push(`Unknown variable: ${match}. Only {{name}}, {{email}}, {{phone}} are allowed.`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * BULLETPROOF RENDERING FUNCTION
 * 
 * SINGLE PASS REPLACEMENT - No iterative cleanup needed
 * DETERMINISTIC - Same input always produces same output
 * IDEMPOTENT - Can be called multiple times safely
 * 
 * @param template - Greeting template (e.g., "Hi {{name}}, welcome!")
 * @param contact - Contact data (name is REQUIRED)
 * @param fallbackName - Fallback if name is missing (default: "there")
 * @returns Rendered greeting with ALL variables replaced
 */
export function renderGreeting(
  template: string,
  contact: ContactData,
  fallbackName: string = 'there'
): RenderingResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // STEP 1: Validate template
  const validation = validateGreetingTemplate(template);
  if (!validation.valid) {
    errors.push(...validation.errors);
    return {
      success: false,
      rendered: '',
      errors,
      warnings
    };
  }
  
  // STEP 2: Pre-validate and normalize contact data
  // CRITICAL: Name must be resolved BEFORE rendering
  let contactName = contact.name?.trim();
  if (!contactName || contactName.length === 0) {
    contactName = fallbackName?.trim() || 'there';
    warnings.push(`Contact name was empty, using fallback: "${contactName}"`);
  }
  
  // Ensure name is safe (no special characters that break TTS)
  contactName = contactName.replace(/[{}<>]/g, '').trim();
  if (contactName.length === 0) {
    contactName = 'there';
    errors.push('Contact name became empty after sanitization');
  }
  
  const contactEmail = (contact.email?.trim() || '').replace(/[{}<>]/g, '');
  const contactPhone = (contact.phone?.trim() || '').replace(/[{}<>]/g, '');
  
  // STEP 3: SINGLE-PASS REPLACEMENT
  // Support multiple variable formats for backward compatibility
  let rendered = template;
  
  // Replace all NAME variants (case-insensitive)
  rendered = rendered.replace(/\{\{name\}\}/gi, contactName);
  rendered = rendered.replace(/\{\{customer_name\}\}/gi, contactName);
  rendered = rendered.replace(/\{\{contact\.name\}\}/gi, contactName);
  
  // Replace all EMAIL variants (case-insensitive)
  rendered = rendered.replace(/\{\{email\}\}/gi, contactEmail);
  rendered = rendered.replace(/\{\{customer_email\}\}/gi, contactEmail);
  rendered = rendered.replace(/\{\{contact\.email\}\}/gi, contactEmail);
  
  // Replace all PHONE variants (case-insensitive)
  rendered = rendered.replace(/\{\{phone\}\}/gi, contactPhone);
  rendered = rendered.replace(/\{\{phone_number\}\}/gi, contactPhone);
  rendered = rendered.replace(/\{\{customer_phone_number\}\}/gi, contactPhone);
  rendered = rendered.replace(/\{\{contact\.phone_number\}\}/gi, contactPhone);
  
  // STEP 4: CRITICAL SAFETY CHECK - Remove ANY remaining variables
  // This catches typos, unknown variables, or malformed patterns
  const remainingVariables = rendered.match(/\{\{[^}]+\}\}/g);
  if (remainingVariables && remainingVariables.length > 0) {
    errors.push(`Unresolved variables found: ${remainingVariables.join(', ')}`);
    // Remove them to prevent TTS errors
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');
    warnings.push('Removed unresolved variables to prevent TTS errors');
  }
  
  // STEP 5: Clean up whitespace and punctuation
  rendered = rendered
    .replace(/\s+/g, ' ')  // Multiple spaces -> single space
    .replace(/^\s*[,.\-:;]\s*/, '')  // Leading punctuation
    .replace(/\s*[,.\-:;]\s*$/, '')  // Trailing punctuation
    .trim();
  
  // STEP 6: Final validation - ensure output is safe
  if (!rendered || rendered.length === 0) {
    errors.push('Rendered greeting is empty after processing');
    // Use fallback greeting
    rendered = `Hello ${contactName}! How can I help you today?`;
    warnings.push('Using fallback greeting due to empty result');
  }
  
  // STEP 7: Verify no variables remain (CRITICAL CHECK)
  if (rendered.includes('{{') || rendered.includes('}}')) {
    errors.push('CRITICAL: Variables still present in final output!');
    // Last resort: remove all variable patterns
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '').trim();
    if (rendered.length === 0) {
      rendered = `Hello ${contactName}! How can I help you today?`;
    }
  }
  
  // STEP 8: Sanitize for TTS (remove any problematic characters)
  rendered = rendered
    .replace(/[{}<>]/g, '')  // Remove any remaining braces or angle brackets
    .replace(/\s+/g, ' ')
    .trim();
  
  return {
    success: errors.length === 0,
    rendered,
    errors,
    warnings
  };
}

/**
 * VALIDATION GATE: Check if greeting is safe to send to Python API
 * BLOCKS CALL if greeting is unsafe
 */
export function validateRenderedGreeting(rendered: string): { safe: boolean; reason?: string } {
  if (!rendered || typeof rendered !== 'string') {
    return { safe: false, reason: 'Greeting is not a string' };
  }
  
  if (rendered.trim().length === 0) {
    return { safe: false, reason: 'Greeting is empty' };
  }
  
  if (rendered.includes('{{') || rendered.includes('}}')) {
    return { safe: false, reason: 'Greeting contains unresolved variables' };
  }
  
  // Check for problematic characters that might break TTS
  if (/[{}<>]/.test(rendered)) {
    return { safe: false, reason: 'Greeting contains unsafe characters: {}<>' };
  }
  
  return { safe: true };
}

/**
 * Get default greeting message for a language
 */
export function getDefaultGreeting(languageCode: string): string {
  const defaults: Record<string, string> = {
    en: 'Hello! How can I help you today?',
    it: 'Ciao! Come posso aiutarti oggi?',
    es: 'Hola, ¿en qué puedo ayudarte?',
    fr: 'Bonjour! Comment puis-je vous aider aujourd\'hui?',
    de: 'Hallo! Wie kann ich Ihnen heute helfen?',
    pt: 'Olá! Como posso ajudá-lo hoje?',
    pl: 'Cześć! Jak mogę Ci dzisiaj pomóc?',
    hi: 'नमस्ते! मैं आज आपकी कैसे मदद कर सकता हूं?',
    zh: '你好！今天我能为你做些什么？',
    ja: 'こんにちは！今日はどのようにお手伝いできますか？',
    ko: '안녕하세요! 오늘 어떻게 도와드릴까요?',
    tr: 'Merhaba! Bugün size nasıl yardımcı olabilirim?',
    ar: 'مرحبا! كيف يمكنني مساعدتك اليوم؟',
  };

  return defaults[languageCode.toLowerCase()] || defaults.en;
}

/**
 * Get default system prompt for a language
 */
export function getDefaultSystemPrompt(languageCode: string): string {
  const defaults: Record<string, string> = {
    en: 'You are a polite, empathetic AI voice agent. Speak clearly, be concise, and guide the user toward their goal.',
    it: 'Sei un assistente vocale AI educato ed empatico. Parla chiaramente, sii conciso e guida l\'utente verso il suo obiettivo.',
    es: 'Eres un agente de voz IA educado y empático. Habla claramente, sé conciso y guía al usuario hacia su objetivo.',
    fr: 'Vous êtes un agent vocal IA poli et empathique. Parlez clairement, soyez concis et guidez l\'utilisateur vers son objectif.',
    de: 'Sie sind ein höflicher, empathischer KI-Sprachassistent. Sprechen Sie klar, seien Sie prägnant und führen Sie den Benutzer zu seinem Ziel.',
    pt: 'Você é um agente de voz IA educado e empático. Fale claramente, seja conciso e guie o usuário em direção ao seu objetivo.',
    pl: 'Jesteś uprzejmym, empatycznym asystentem głosowym AI. Mów wyraźnie, bądź zwięzły i prowadź użytkownika do jego celu.',
    hi: 'आप एक विनम्र, सहानुभूतिपूर्ण AI आवाज एजेंट हैं। स्पष्ट रूप से बोलें, संक्षिप्त रहें और उपयोगकर्ता को उनके लक्ष्य की ओर मार्गदर्शन करें।',
    zh: '你是一个礼貌、有同理心的人工智能语音助手。说话清晰，简洁，引导用户实现目标。',
    ja: 'あなたは礼儀正しく、共感的なAI音声エージェントです。明確に話し、簡潔にし、ユーザーを目標に向けて導きます。',
    ko: '당신은 정중하고 공감적인 AI 음성 에이전트입니다. 명확하게 말하고, 간결하게 하며, 사용자를 목표로 안내합니다.',
    tr: 'Kibar, empatik bir AI ses asistanısınız. Açıkça konuşun, kısa ve öz olun ve kullanıcıyı hedefine yönlendirin.',
    ar: 'أنت مساعد صوتي ذكي مهذب ومتعاطف. تحدث بوضوح، كن مختصراً ووجه المستخدم نحو هدفه.',
  };

  return defaults[languageCode.toLowerCase()] || defaults.en;
}

/**
 * Get default escalation conditions for a language
 */
export function getDefaultEscalationConditions(languageCode: string): string[] {
  const defaults: Record<string, string[]> = {
    en: ['user says transfer', 'user requests human', 'sentiment negative'],
    it: ['utente dice trasferire', 'utente richiede umano', 'sentiment negativo'],
    es: ['usuario dice transferir', 'usuario solicita humano', 'sentimiento negativo'],
    fr: ['utilisateur dit transférer', 'utilisateur demande humain', 'sentiment négatif'],
    de: ['benutzer sagt übertragen', 'benutzer fordert mensch', 'stimmung negativ'],
    pt: ['usuário diz transferir', 'usuário solicita humano', 'sentimento negativo'],
    pl: ['użytkownik mówi przekazać', 'użytkownik prosi o człowieka', 'nastrój negatywny'],
    hi: ['उपयोगकर्ता स्थानांतरण कहता है', 'उपयोगकर्ता मानव का अनुरोध करता है', 'भावना नकारात्मक'],
    zh: ['用户说转接', '用户请求人工', '情绪负面'],
    ja: ['ユーザーが転送と言う', 'ユーザーが人間を要求', '感情がネガティブ'],
    ko: ['사용자가 전환을 말함', '사용자가 인간을 요청', '감정이 부정적'],
    tr: ['kullanıcı transfer diyor', 'kullanıcı insan istiyor', 'duygu negatif'],
    ar: ['المستخدم يقول النقل', 'المستخدم يطلب إنسان', 'المشاعر سلبية'],
  };

  return defaults[languageCode.toLowerCase()] || defaults.en;
}
