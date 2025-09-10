export type PiiType = "email" | "phone" | "url" | "ipv4" | "credit_card" | "name" | "other";

export function classifyPii(text: string): PiiType {
  const s = sanitize(text);
  
  // Debug logging - remove in production
  if (process.env.NODE_ENV === 'development') {
    console.log(`Classifying: "${text}" -> sanitized: "${s}"`);
  }
  
  if (isEmail(s)) return "email";
  if (isPhone(s)) return "phone";
  if (isUrl(s)) return "url";
  if (isIPv4(s)) return "ipv4";
  if (isCreditCard(s)) return "credit_card";
  if (isNameHeuristic(s)) return "name";
  return "other";
}

export function isEmail(s: string): boolean {
  // Enhanced email detection with better OCR artifact handling
  const normalized = s
    // Handle common OCR "at" replacements
    .replace(/\s*\(at\)\s*|\s*\[at\]\s*|\s*\{at\}\s*|\s+at\s+/gi, "@")
    // Handle common OCR "dot" replacements
    .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*|\s*\{dot\}\s*|\s+dot\s+/gi, ".")
    // Remove spaces that OCR might inject
    .replace(/\s+/g, "")
    // Handle common OCR character substitutions
    .replace(/[0O]/g, match => {
      // Context-aware O/0 replacement
      return match === '0' ? 'O' : '0';
    })
    .replace(/[1l|I]/g, match => {
      // Context-aware 1/l/I replacement
      return match === '1' ? 'l' : (match === 'l' ? '1' : 'I');
    })
    // Fix common punctuation issues
    .replace(/[.,;]\s*@/g, "@") // Remove punctuation before @
    .replace(/@\s*[.,;]/g, "@") // Remove punctuation after @
    .trim();

  // More flexible email regex that handles common OCR artifacts
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`Email check: "${s}" -> "${normalized}" -> ${emailRegex.test(normalized)}`);
  }
  
  return emailRegex.test(normalized);
}

export function isPhone(s: string): boolean {
  // Accept typical international/NANP variants, separators and parentheses
  const cleaned = s.replace(/[^0-9+()\-\s]/g, "").trim();
  // Stronger pattern: optional country, then groups of 2-4 digits
  const re = /^\+?\d{1,3}[\s\-]?\(?\d{2,4}\)?([\s\-]?\d{2,4}){1,4}$/;
  if (!re.test(cleaned)) return false;
  // Ensure at least 7 digits overall
  const digits = cleaned.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isUrl(s: string): boolean {
  // Enhanced URL detection with OCR preprocessing
  let normalized = s
    // Remove spaces that OCR might inject
    .replace(/\s+/g, "")
    // Handle common OCR substitutions
    .replace(/[0O]/g, (match, offset, string) => {
      // Context-aware O/0 replacement
      const prev = string[offset - 1];
      const next = string[offset + 1];
      if (prev === '.' || next === '.') return 'o'; // likely domain
      return match;
    })
    // Handle protocol variations
    .replace(/^h[t1l|]+p[s5]?[:;]\/\//gi, 'http://')
    .replace(/^[w\s]*[w\s]*[w\s]*\./gi, 'www.')
    // Fix common punctuation issues
    .replace(/[.,;:]*(https?:\/\/)/gi, '$1')
    .trim();

  // Handle cases where OCR splits the URL
  normalized = normalized.replace(/[:;]\s*\/\s*\//g, "://");
  normalized = normalized.replace(/\s*\.\s*/g, ".");
  
  // Multiple URL patterns to catch different formats
  const patterns = [
    // Standard URLs with protocol
    /^https?:\/\/[\w\-]+(\.[\w\-]+)+([\/\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/i,
    // URLs without protocol but with www
    /^www\.[\w\-]+(\.[\w\-]+)+([\/\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/i,
    // Domain-only patterns
    /^[\w\-]+(\.[\w\-]+){1,}\.[a-z]{2,}$/i,
    // IP-based URLs
    /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}([\/\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/i
  ];

  const result = patterns.some(pattern => pattern.test(normalized));
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`URL check: "${s}" -> "${normalized}" -> ${result}`);
  }
  
  return result;
}

export function isIPv4(s: string): boolean {
  // Use the ipv4Ok function for consistent preprocessing
  return ipv4Ok(s);
}

export function isCreditCard(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  return luhnCheck(digits);
}

export function isNameHeuristic(s: string): boolean {
  // Very simple: two words ProperCase each, optional middle initial
  const cleaned = s.replace(/[^A-Za-z'\-\s]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  const isProper = (w: string) => /^[A-Z][a-zA-Z'\-]{1,}$/.test(w);
  const isInitial = (w: string) => /^[A-Z]\.$/.test(w);
  if (parts.length === 2) return isProper(parts[0]) && isProper(parts[1]);
  return isProper(parts[0]) && (isProper(parts[1]) || isInitial(parts[1])) && isProper(parts[2]);
}

export function sanitize(s: string): string {
  return s
    .trim()
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Remove trailing punctuation (but be careful not to remove dots from domains)
    .replace(/[,;:!?)]$/g, "")
    // Handle OCR artifacts - multiple spaces become single space
    .replace(/\s+/g, " ");
}

function luhnCheck(numStr: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let digit = parseInt(numStr.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Strict validators for detection pipeline
export function luhnOk(raw: string): boolean {
  // reject letters or dots
  if (/[A-Za-z\.]/.test(raw)) return false;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  return luhnCheck(digits);
}

export function ipv4Ok(raw: string): boolean {
  // Enhanced IP validation with OCR preprocessing
  const compact = raw
    .replace(/\s+/g, "")  // Remove all spaces
    .replace(/[oO]/g, "0") // OCR often mistakes O for 0
    .replace(/[1l|I]/g, "1") // OCR often mistakes these for 1
    .trim();
  
  const parts = compact.split(".");
  if (parts.length !== 4) return false;
  
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const v = parseInt(p, 10);
    if (v < 0 || v > 255) return false;
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`IP check: "${raw}" -> "${compact}" -> valid`);
  }
  
  return true;
}

// Additional utility function to help with debugging
export function debugPiiClassification(text: string): { 
  type: PiiType; 
  sanitized: string; 
  checks: Record<string, boolean> 
} {
  const sanitized = sanitize(text);
  const checks = {
    email: isEmail(sanitized),
    phone: isPhone(sanitized),
    url: isUrl(sanitized),
    ipv4: isIPv4(sanitized),
    credit_card: isCreditCard(sanitized),
    name: isNameHeuristic(sanitized)
  };
  
  return {
    type: classifyPii(text),
    sanitized,
    checks
  };
}