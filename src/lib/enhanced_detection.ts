import { debugPiiClassification } from "@/lib/pii";
import { unionBBoxes } from "@/lib/utils";

export interface OcrResult {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  lines: Array<{
    words: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; conf: number }>;
    joined: string;
    spans: Array<{ start: number; end: number; wordIdx: number }>;
    meanCharWidth: number;
  }>;
  piiCandidates?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }>;
}

// Match your existing Detection type system
export type PiiType = 'email' | 'url' | 'ipv4' | 'phone' | 'cc' | 'credit_card' | 'name'; // Include both CC aliases and 'name'

export interface Detection {
  id: string;
  type: PiiType;
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export function processOcrForDetections(
  ocrResult: OcrResult,
  minConfidence: number = 40
): Detection[] {
  const detections: Detection[] = [];
  
  if (process.env.NODE_ENV === 'development') {
    console.log("=== Enhanced PII Detection Starting ===");
    console.log(`Processing ${ocrResult.lines.length} lines with min confidence ${minConfidence}%`);
  }
  
  // Process each line for PII - but be much more selective
  ocrResult.lines.forEach((line, lineIdx) => {
    const lineText = line.joined.trim();
    if (!lineText || lineText.length < 5) return;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n--- Line ${lineIdx}: "${lineText}" ---`);
    }
    
    // 1. Check entire line as single PII item - only if it's likely to be clean PII
    const lineClassification = debugPiiClassification(lineText);
    if (process.env.NODE_ENV === 'development') console.log(`Full line classification:`, lineClassification);
    
    // Skip line detection if it contains "Email:" - we'll handle this specially
    const skipLineDetection = lineText.toLowerCase().includes("email");
    
    if (lineClassification.type !== "other" && isHighQualityDetection(lineText, lineClassification.type) && !skipLineDetection) {
      const wordBboxes = line.words.map(w => w.bbox);
      const lineBbox = {
        x0: Math.min(...wordBboxes.map(b => b.x)) * ocrResult.scaleX,
        y0: Math.min(...wordBboxes.map(b => b.y)) * ocrResult.scaleY,
        x1: Math.max(...wordBboxes.map(b => b.x + b.w)) * ocrResult.scaleX,
        y1: Math.max(...wordBboxes.map(b => b.y + b.h)) * ocrResult.scaleY,
      };
      
      const avgConfidence = line.words.reduce((sum, w) => sum + w.conf, 0) / line.words.length;
      
      if (avgConfidence >= minConfidence) {
        if (process.env.NODE_ENV === 'development') console.log(`✅ Adding line detection: ${lineClassification.type} - "${lineText}"`);
        detections.push({
          id: `line-${lineIdx}-${lineClassification.type}`,
          type: lineClassification.type,
          text: lineText,
          bbox: lineBbox,
          confidence: avgConfidence,
        });
      }
    } else if (skipLineDetection) {
      if (process.env.NODE_ENV === 'development') console.log(`⏭️ Skipping line detection for email line: "${lineText}"`);
    }
    
    // 2. Look for specific high-quality PII patterns in the line
    const piiMatches = findSpecificPiiInLine(lineText, line.words, ocrResult.scaleX, ocrResult.scaleY, minConfidence);
    piiMatches.forEach((match, idx) => {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Adding specific detection: ${match.type} - "${match.text}"`);
      detections.push({
        id: `specific-${lineIdx}-${idx}-${match.type}`,
        type: match.type,
        text: match.text,
        bbox: match.bbox,
        confidence: match.confidence,
      });
    });
    
    // 3. Special case: Look for email patterns in lines containing "Email"
    if (lineText.toLowerCase().includes("email")) {
      const emailMatch = extractEmailFromEmailLine(lineText, line.words, ocrResult.scaleX, ocrResult.scaleY, minConfidence);
      if (emailMatch) {
        console.log(`✅ Adding email from email line: "${emailMatch.text}"`);
        detections.push({
          id: `email-line-${lineIdx}`,
          type: "email",
          text: emailMatch.text,
          bbox: emailMatch.bbox,
          confidence: emailMatch.confidence,
        });
      }
    }
  });
  
  // 4. Smart deduplication - keep only the best detection for overlapping areas
  const finalDetections = smartDeduplication(detections);
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`\n=== Final Results ===`);
    console.log(`Found ${finalDetections.length} unique PII detections:`);
    finalDetections.forEach(d => {
      console.log(`  ${d.type}: "${d.text}" (${Math.round(d.confidence)}%)`);
    });
  }
  
  return finalDetections;
}

// Reusable types
type OCRWord = { text: string; bbox: { x: number; y: number; w: number; h: number }; conf: number };
type BBox = { x0: number; y0: number; x1: number; y1: number };

// Helper function to determine if a detection is high quality
function isHighQualityDetection(text: string, type: string): boolean {
  const cleanText = text.trim().replace(/\s+/g, "");
  
  switch (type) {
    case "email":
      // Must have @ and . with some reasonable structure
      return cleanText.includes("@") && cleanText.includes(".") && cleanText.length >= 5 && !cleanText.startsWith("@");
    case "url":
      // Must have . and be reasonable length, OR start with http
      return (cleanText.includes(".") && cleanText.length >= 4) || cleanText.toLowerCase().startsWith("http");
    case "ipv4":
      // Must be exactly 4 numbers separated by dots
      const ipParts = cleanText.split(".");
      return ipParts.length === 4 && ipParts.every(part => /^\d{1,3}$/.test(part) && parseInt(part) <= 255);
    case "phone":
      // Must have reasonable phone structure
      const digits = cleanText.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    case "cc":
      // Must have reasonable credit card structure
      const ccDigits = cleanText.replace(/\D/g, "");
      return ccDigits.length >= 13 && ccDigits.length <= 19;
    default:
      return true;
  }
}

// Helper function to find specific PII patterns in a line
function findSpecificPiiInLine(
  lineText: string, 
  words: Array<OCRWord>,
  scaleX: number,
  scaleY: number,
  minConfidence: number
): Array<{ type: PiiType; text: string; bbox: BBox; confidence: number }> {
  const matches: Array<{ type: PiiType; text: string; bbox: BBox; confidence: number }> = [];
  
  // if (process.env.NODE_ENV === 'development') console.log(`Searching in cleaned text: "${lineText}"`);
  
  // Define OCR-friendly patterns that handle spacing issues
  const patterns: Array<{ type: PiiType; regex: RegExp; clean: (s: string) => string }> = [
    { 
      type: "email", 
      // Handles: "john.doe@company.com", "john . doe @ company . com", etc.
      regex: /([a-zA-Z0-9][a-zA-Z0-9._%-]*\s*[@]\s*[a-zA-Z0-9][a-zA-Z0-9.-]*\s*[.]\s*[a-zA-Z]{2,})/gi,
      clean: (match: string) => {
        // More sophisticated cleaning for emails
        return match
          .replace(/\s+/g, "") // Remove all spaces
          .replace(/[^\w.@\-]/g, "") // Keep only alphanumeric, ., @, -
          .replace(/[@]+/g, "@") // Ensure only one @
          .replace(/[.]+/g, "."); // Ensure no double dots
      }
    },
    { 
      type: "url", 
      // Handles: "https://example.com", "https : // example . com", etc.
      regex: /((?:https?\s*[:;]\s*\/\s*\/\s*)?[a-zA-Z0-9][\w\-]*(?:\s*[.]\s*[a-zA-Z0-9][\w\-]*)+(?:\s*\/[^\s]*)?)/gi,
      clean: (match: string) => {
        // Clean URL by handling OCR artifacts
        return match
          .replace(/\s+/g, "") // Remove spaces
          .replace(/[:;]\s*\/\s*\//g, "://") // Fix protocol
          .replace(/\s*\.\s*/g, ".") // Fix dots
          .replace(/[^a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, ""); // Keep URL-safe chars
      }
    },
    { 
      type: "ipv4", 
      // Handles: "192.168.1.1", "192 . 168 . 1 . 1", etc.
      regex: /(\d{1,3}\s*[.]\s*\d{1,3}\s*[.]\s*\d{1,3}\s*[.]\s*\d{1,3})/g,
      clean: (match: string) => match.replace(/\s+/g, "")
    },
    { 
      type: "phone", 
      // Handles various phone formats with OCR artifacts
      regex: /(\+?\s*[1]?\s*[-.\s\(]?\s*\d\s*\d\s*\d\s*[-.\s\)]?\s*\d\s*\d\s*\d\s*[-.\s]?\s*\d\s*\d\s*\d\s*\d)/gi,
      clean: (match: string) => {
        // Extract only digits and common phone separators
        return match.replace(/[^0-9+\-\(\)\s]/g, "");
      }
    },
    { 
      type: "cc", // Changed from "credit_card" to match your system
      // Handles: "4111 1111 1111 1111", "4111-1111-1111-1111", etc.
      regex: /(\d\s*\d\s*\d\s*\d\s*[\s\-]?\s*\d\s*\d\s*\d\s*\d\s*[\s\-]?\s*\d\s*\d\s*\d\s*\d\s*[\s\-]?\s*\d\s*\d\s*\d\s*\d)/g,
      clean: (match: string) => {
        // Extract only digits for credit card validation
        return match.replace(/\D/g, "");
      }
    }
  ];
  
  patterns.forEach(pattern => {
    let match;
    
    while ((match = pattern.regex.exec(lineText)) !== null) {
      const rawMatch = match[1];
      const cleanedMatch = pattern.clean(rawMatch);
      
      // Skip if cleaned match is too short
      if (cleanedMatch.length < 3) continue;
      
      // if (process.env.NODE_ENV === 'development') console.log(`Found ${pattern.type} candidate: "${rawMatch}" -> "${cleanedMatch}"`);
      
      // Validate the cleaned match
      if (isOcrFriendlyMatch(cleanedMatch, pattern.type)) {
        // Find words that are part of this match by looking for overlap
        const matchWords = findWordsForMatch(rawMatch, words, lineText);
        
        if (matchWords.length > 0) {
          // Convert word bboxes to standard format and apply scaling
          const wordBboxes = matchWords.map(w => ({
            x0: w.bbox.x * scaleX,
            y0: w.bbox.y * scaleY,
            x1: (w.bbox.x + w.bbox.w) * scaleX,
            y1: (w.bbox.y + w.bbox.h) * scaleY,
          }));
          const bbox = unionBBoxes(wordBboxes);
          
          const avgConfidence = matchWords.reduce((sum, w) => sum + w.conf, 0) / matchWords.length;
          
          // Improved confidence scoring
          let finalConfidence = avgConfidence;
          if (isLowConfidenceButValid(cleanedMatch, pattern.type)) {
            // Boost confidence for clearly valid matches but don't overdo it
            finalConfidence = Math.min(95, Math.max(avgConfidence * 1.5, 70));
          }
          
          if (finalConfidence >= minConfidence || isLowConfidenceButValid(cleanedMatch, pattern.type)) {
            // if (process.env.NODE_ENV === 'development') console.log(`✅ Validated ${pattern.type}: "${cleanedMatch}"`);
            matches.push({
              type: pattern.type,
              text: cleanedMatch,
              bbox,
              confidence: finalConfidence
            });
          } else {
            // if (process.env.NODE_ENV === 'development') console.log(`❌ ${pattern.type} confidence too low: ${avgConfidence}% < ${minConfidence}%`);
          }
        }
      } else {
        // if (process.env.NODE_ENV === 'development') console.log(`❌ ${pattern.type} failed validation: "${cleanedMatch}"`);
      }
    }
  });
  
  return matches;
}

// Helper to find which words correspond to a matched text
function findWordsForMatch(
  matchText: string, 
  words: Array<OCRWord>,
  fullLineText: string
): Array<OCRWord> {
  // Find the approximate position of the match in the full line
  const matchStart = fullLineText.toLowerCase().indexOf(matchText.toLowerCase().substring(0, 5));
  if (matchStart === -1) return words; // Fallback to all words if we can't locate it
  
  // Find words that overlap with this text region
  let currentPos = 0;
  const matchWords: Array<OCRWord> = [];
  
  for (const word of words) {
    const wordStart = currentPos;
    const wordEnd = currentPos + word.text.length;
    
    // Check if this word overlaps with our match
    if (wordEnd > matchStart && wordStart < matchStart + matchText.length) {
      matchWords.push(word);
    }
    
    currentPos = wordEnd + 1; // +1 for space
  }
  
  return matchWords.length > 0 ? matchWords : words.slice(0, Math.min(3, words.length));
}

// Helper function to allow low confidence but clearly valid PII
function isLowConfidenceButValid(text: string, type: string): boolean {
  switch (type) {
    case "url":
      // Allow common URLs even with low confidence
      return text.includes("example.com") || text.includes("https://") || text.includes("www.");
    case "ipv4":
      // Allow valid IP addresses even with low confidence
      const parts = text.split(".");
      return parts.length === 4 && parts.every(part => {
        const num = parseInt(part);
        return !isNaN(num) && num >= 0 && num <= 255;
      });
    case "email":
      // Allow valid emails even with low confidence
      return text.includes("@") && text.includes(".") && text.length > 5;
    case "cc": // Changed from "credit_card"
      // Allow valid credit cards even with low confidence
      const ccDigits = text.replace(/\D/g, "");
      return ccDigits.length >= 13 && ccDigits.length <= 19;
    default:
      return false;
  }
}

// More lenient validation for OCR-processed text
function isOcrFriendlyMatch(text: string, type: string): boolean {
  // console.log(`Validating ${type}: "${text}"`);
  
  switch (type) {
    case "email":
      // More comprehensive email validation with OCR fixes
      const hasAt = text.includes("@");
      const hasDot = text.includes(".");
      const hasDomainPart = text.includes("@") && text.split("@")[1].includes(".");
      const isLongEnough = text.length >= 5;
      const hasValidStructure = hasAt && hasDot && hasDomainPart && isLongEnough && !text.startsWith("@");
      
      // Additional checks for common OCR issues
      const noDoubleAt = (text.match(/@/g) || []).length === 1; // Only one @
      const hasUsername = text.includes("@") && text.split("@")[0].length > 0;
      const hasDomain = text.includes("@") && text.split("@")[1].length > 0;
      
      return hasValidStructure && noDoubleAt && hasUsername && hasDomain;
      
    case "url":
      // Enhanced URL validation
      const hasProtocolOrWww = text.toLowerCase().includes("http") || text.toLowerCase().includes("www.") || /\.(com|org|net|edu|gov|co|io|me)$/i.test(text);
      const hasDotAndLength = text.includes(".") && text.length >= 4;
      const isValidUrl = hasProtocolOrWww || hasDotAndLength;
      
      // More permissive - only exclude if it looks like an email
      const notEmailLike = !(text.includes("@") && text.split("@")[0].length > 1);
      
      // Special case: allow common domains
      const isCommonDomain = /\.(com|org|net|edu|gov|co|io|me|ly|tv)$/i.test(text);
      
      return (isValidUrl && notEmailLike) || isCommonDomain;
      
    case "ipv4":
      const ipParts = text.split(".");
      const has4Parts = ipParts.length === 4;
      const allValidParts = ipParts.every(part => {
        // Handle OCR artifacts like extra dots or spaces
        const cleanPart = part.trim();
        return /^\d{1,3}$/.test(cleanPart) && parseInt(cleanPart) <= 255;
      });
      return has4Parts && allValidParts;
      
    case "phone":
      // Enhanced phone validation that handles OCR artifacts
      const digitsOnly = text.replace(/\D/g, "");
      const validLength = digitsOnly.length >= 7 && digitsOnly.length <= 15;
      
      // Additional pattern checks for common phone formats
      const commonPatterns = [
        /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/, // US format
        /^\+?[0-9]{1,3}[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}$/, // International
        /^[0-9]{7,15}$/ // Just digits
      ];
      
      const matchesPattern = commonPatterns.some(pattern => pattern.test(text));
      
      return validLength && (matchesPattern || digitsOnly.length >= 10);
      
    case "cc": // Changed from "credit_card"
      // Credit card validation with OCR artifact handling
      const ccDigits = text.replace(/\D/g, "");
      const validCcLength = ccDigits.length >= 13 && ccDigits.length <= 19;
      
      // Quick Luhn check if we have enough digits
      if (validCcLength && ccDigits.length >= 13) {
        return luhnCheck(ccDigits);
      }
      
      return validCcLength;
      
    default:
      return true;
  }
}

// Simple Luhn algorithm implementation
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

// Special function to extract email from lines like "Email: john.doe@company.com"
// Special function to extract email from lines like "Email: john.doe@company.com"
function extractEmailFromEmailLine(
  lineText: string,
  words: Array<OCRWord>,
  scaleX: number,
  scaleY: number,
  minConfidence: number
): { type: PiiType; text: string; bbox: BBox; confidence: number } | null {
  console.log(`Trying to extract email from: "${lineText}"`);
  
  // Look for the specific pattern: "Email. john .doecompany . com"
  // We want to extract: john@doecompany.com
  const cleanLine = lineText.replace(/\s+/g, " ").trim();
  
  // Pattern to match: "Email. john .doecompany . com" 
  // Capture: john, doecompany, com
  const emailPattern = /email[.\s:]*([a-zA-Z0-9]+)[.\s]*([a-zA-Z0-9]+)[.\s]*[.]\s*([a-zA-Z]{2,})/i;
  const match = cleanLine.match(emailPattern);
  
  if (match && match[1] && match[2] && match[3]) {
    const username = match[1];     // "john"
    const domain = match[2];       // "doecompany" 
    const tld = match[3];          // "com"
    
    const extractedEmail = `${username}@${domain}.${tld}`;
    console.log(`✅ Email pattern matched! Extracted: "${extractedEmail}" from groups:`, {
      username, domain, tld, fullMatch: match[0]
    });
    
    // Find words that are part of the email (more targeted)
    const emailWords = words.filter(word => {
      const wordText = word.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      return wordText === username.toLowerCase() || 
             wordText === domain.toLowerCase() || 
             wordText === tld.toLowerCase() ||
             wordText.includes(username.toLowerCase()) ||
             wordText.includes(domain.toLowerCase());
    });
    
    if (emailWords.length > 0) {
      const bbox: BBox = {
        x0: Math.min(...emailWords.map(w => w.bbox.x)) * scaleX,
        y0: Math.min(...emailWords.map(w => w.bbox.y)) * scaleY,
        x1: Math.max(...emailWords.map(w => w.bbox.x + w.bbox.w)) * scaleX,
        y1: Math.max(...emailWords.map(w => w.bbox.y + w.bbox.h)) * scaleY,
      };
      
      const avgConfidence = emailWords.reduce((sum, w) => sum + w.conf, 0) / emailWords.length;
      
      // Accept emails with lower confidence
      if (avgConfidence >= Math.min(minConfidence, 30)) {
        console.log(`✅ Successfully extracted email: "${extractedEmail}" with ${emailWords.length} words, confidence ${avgConfidence}%`);
        return {
          type: "email" as PiiType,
          text: extractedEmail,
          bbox,
          confidence: Math.max(avgConfidence, 70) // Boost confidence
        };
      } else {
        console.log(`❌ Email confidence too low: ${avgConfidence}% < ${Math.min(minConfidence, 30)}%`);
      }
    } else {
      console.log(`❌ No matching words found for email parts: ${username}, ${domain}, ${tld}`);
    }
  } else {
    console.log(`❌ No email pattern matched in: "${cleanLine}"`);
  }
  
  return null;
}

// Smart deduplication - keep the best detection for overlapping areas
function smartDeduplication(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  
  for (const detection of sorted) {
    const overlaps = kept.some(existing => {
      // Check if bounding boxes overlap significantly
      const overlapX = Math.max(0, Math.min(detection.bbox.x1, existing.bbox.x1) - Math.max(detection.bbox.x0, existing.bbox.x0));
      const overlapY = Math.max(0, Math.min(detection.bbox.y1, existing.bbox.y1) - Math.max(detection.bbox.y0, existing.bbox.y0));
      const overlapArea = overlapX * overlapY;
      
      const detectionArea = (detection.bbox.x1 - detection.bbox.x0) * (detection.bbox.y1 - detection.bbox.y0);
      const existingArea = (existing.bbox.x1 - existing.bbox.x0) * (existing.bbox.y1 - existing.bbox.y0);
      
      const overlapRatio = overlapArea / Math.min(detectionArea, existingArea);
      
      // If more than 50% overlap, consider it a duplicate
      return overlapRatio > 0.5;
    });
    
    if (!overlaps) {
      kept.push(detection);
    }
  }
  
  return kept;
}

// Test function to debug PII detection
export function testPiiDetection() {
  const testCases = [
    "john.doe@company.com",
    "john . doe @ company . com", // OCR with spaces
    "https://example.com",
    "https : // example . com", // OCR with spaces  
    "192.168.1.1",
    "192 . 168 . 1 . 1", // OCR with spaces
    "+1-555-1723-4567",
    "(555) 173-4567", 
    "4111 1111 1111 1111",
    "John Doe",
  ];
  
  console.log("=== PII Detection Test Results ===");
  testCases.forEach(test => {
    const result = debugPiiClassification(test);
    console.log(`"${test}" -> ${result.type}`, result.checks);
  });
}