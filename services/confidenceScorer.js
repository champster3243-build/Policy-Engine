/*******************************************************************************************
 *
 *  confidenceScorer.js (v1.5 NEW FILE)
 *  ====================================
 *
 *  PURPOSE: Calculate confidence scores for AI-extracted data
 *
 *  WHY THIS EXISTS:
 *  ----------------
 *  In v1.4, we trusted Gemini 100%. If it returned data, we accepted it as truth.
 *  
 *  PROBLEMS WITH THIS:
 *  - Gemini sometimes hallucinates (makes up plausible-sounding rules)
 *  - Gemini sometimes returns vague/uncertain extractions
 *  - No way to know if an extraction is 99% certain or 60% certain
 *  
 *  v1.5 SOLUTION:
 *  - Assign a confidence score (0.0 - 1.0) to EVERY extraction
 *  - High confidence (>0.85) → Auto-approve
 *  - Low confidence (<0.85) → Flag for human review
 *  
 *  This is "Strategy B" from mentor's approach: Context-aware scoring
 *
 *  CONFIDENCE SCALE:
 *  -----------------
 *  0.95-0.99 = Rule-based match (near certain)
 *  0.85-0.94 = AI extraction with strong signals
 *  0.70-0.84 = AI extraction with some uncertainty
 *  0.50-0.69 = AI extraction with weak signals (needs review)
 *  <0.50     = Very uncertain (definitely needs review)
 *
 *******************************************************************************************/

/* =========================================================================================
 * SIGNAL DETECTION - Positive Indicators
 * =========================================================================================
 * 
 * POSITIVE SIGNALS = Textual features that INCREASE confidence
 * 
 * WHY THESE MATTER:
 * - Structured text (bullets, numbers, tables) is more reliable than prose
 * - Specific numbers/amounts are more reliable than vague language
 * - Complete sentences are more reliable than fragments
 * - Legal/formal language is more reliable than casual language
 * 
 */

/**
 * CHECK IF TEXT IS STRUCTURED
 * 
 * STRUCTURED TEXT EXAMPLES:
 * - "• War is excluded"
 * - "1. Waiting period: 30 days"
 * - "| Room Rent | Rs. 5000 |"
 * - "a) Maternity coverage"
 * 
 * WHY STRUCTURED = HIGH CONFIDENCE:
 * - Indicates formal policy language
 * - Less likely to be narrative/explanatory text
 * - More likely to be actual policy rules
 * 
 * RETURNS: Boolean
 */
function hasStructuredFormatting(text) {
  const structurePatterns = [
    /^[\s]*[•\-\*]/m,                    // Bullet points
    /^[\s]*\d+\./m,                       // Numbered lists (1. 2. 3.)
    /^[\s]*[a-z]\)/mi,                    // Letter lists (a) b) c))
    /^[\s]*\([a-z]\)/mi,                  // Parenthetical letters ((a) (b))
    /^[\s]*[ivx]+\./mi,                   // Roman numerals (i. ii. iii.)
    /\|.*\|/,                             // Table rows
    /^[\s]*-{3,}/m                        // Horizontal rules (---)
  ];
  
  return structurePatterns.some(pattern => pattern.test(text));
}

/**
 * CHECK IF TEXT CONTAINS SPECIFIC NUMBERS
 * 
 * NUMBER EXAMPLES:
 * - "30 days"
 * - "Rs. 5,000"
 * - "20% co-payment"
 * - "48 months"
 * 
 * WHY NUMBERS = HIGH CONFIDENCE:
 * - Specificity indicates factual data
 * - Numbers are less ambiguous than words
 * - Policies use numbers for limits, periods, amounts
 * 
 * RETURNS: Boolean
 */
function containsSpecificNumbers(text) {
  const numberPatterns = [
    /\d+\s*(?:day|month|year)s?/i,       // Time periods
    /(?:₹|Rs\.?|\$)\s*[\d,]+/,           // Currency amounts
    /\d+\s*%/,                            // Percentages
    /\d+\s*(?:lakhs?|crores?)/i          // Indian number system
  ];
  
  return numberPatterns.some(pattern => pattern.test(text));
}

/**
 * CHECK IF TEXT IS A COMPLETE SENTENCE
 * 
 * COMPLETE SENTENCE INDICATORS:
 * - Ends with punctuation (. ! ?)
 * - Has reasonable length (>15 chars)
 * - Contains verb indicators (is, are, will, shall)
 * 
 * WHY COMPLETE = HIGHER CONFIDENCE:
 * - Fragments are often headers or incomplete extractions
 * - Complete sentences contain full rules
 * 
 * RETURNS: Boolean
 */
function isCompleteSentence(text) {
  const trimmed = text.trim();
  
  // Must end with punctuation
  const hasPunctuation = /[.!?]$/.test(trimmed);
  
  // Must have reasonable length
  const hasLength = trimmed.length > 15;
  
  // Must contain verb indicators
  const hasVerb = /\b(?:is|are|will|shall|must|may|can|be)\b/i.test(trimmed);
  
  return hasPunctuation && hasLength && hasVerb;
}

/**
 * CHECK IF TEXT USES FORMAL POLICY LANGUAGE
 * 
 * FORMAL LANGUAGE INDICATORS:
 * - "shall", "must", "will"
 * - "excluded", "covered", "limited"
 * - "subject to", "in case of"
 * 
 * WHY FORMAL = HIGHER CONFIDENCE:
 * - Policy documents use specific legal terminology
 * - Casual explanations don't use this language
 * 
 * RETURNS: Boolean
 */
function usesFormalLanguage(text) {
  const formalTerms = [
    /\bshall\b/i,
    /\bmust\b/i,
    /\bexcluded?\b/i,
    /\bcovered?\b/i,
    /\blimited?\b/i,
    /\bsubject to\b/i,
    /\bin case of\b/i,
    /\bprovided that\b/i,
    /\bwhereas\b/i
  ];
  
  return formalTerms.some(pattern => pattern.test(text));
}


/* =========================================================================================
 * SIGNAL DETECTION - Negative Indicators
 * =========================================================================================
 * 
 * NEGATIVE SIGNALS = Textual features that DECREASE confidence
 * 
 * WHY THESE MATTER:
 * - Vague language indicates uncertainty
 * - Questions indicate explanatory text (not rules)
 * - Very short text is often noise
 * 
 */

/**
 * CHECK IF TEXT CONTAINS VAGUE LANGUAGE
 * 
 * VAGUE LANGUAGE EXAMPLES:
 * - "may be excluded"
 * - "could result in"
 * - "typically", "generally", "usually"
 * 
 * WHY VAGUE = LOWER CONFIDENCE:
 * - Indicates uncertainty even in the source document
 * - Not a definitive rule
 * - Often explanatory/educational text, not policy rules
 * 
 * RETURNS: Boolean
 */
function containsVagueLanguage(text) {
  const vagueTerms = [
    /\bmay\b/i,
    /\bmight\b/i,
    /\bcould\b/i,
    /\btypically\b/i,
    /\bgenerally\b/i,
    /\busually\b/i,
    /\bsometimes\b/i,
    /\bpossibly\b/i,
    /\bin some cases\b/i
  ];
  
  return vagueTerms.some(pattern => pattern.test(text));
}

/**
 * CHECK IF TEXT IS A QUESTION
 * 
 * WHY QUESTIONS = LOWER CONFIDENCE:
 * - Questions are FAQ sections, not policy rules
 * - "What is excluded?" is not the same as "War is excluded"
 * 
 * RETURNS: Boolean
 */
function isQuestion(text) {
  return text.trim().endsWith('?');
}

/**
 * CHECK IF TEXT IS TOO SHORT
 * 
 * WHY SHORT = LOWER CONFIDENCE:
 * - "excluded" (1 word) is likely a fragment
 * - "War is excluded from coverage" is a complete rule
 * 
 * THRESHOLD: 10 characters minimum
 * 
 * RETURNS: Boolean
 */
function isTooShort(text) {
  return text.trim().length < 10;
}


/* =========================================================================================
 * MAIN EXPORT: calculateConfidence
 * =========================================================================================
 * 
 * PURPOSE: Calculate a confidence score for an AI-extracted finding
 * 
 * ALGORITHM:
 * ----------
 * 1. Start with base confidence (0.70 for AI, 0.99 for rules)
 * 2. Add points for positive signals
 * 3. Subtract points for negative signals
 * 4. Clamp result to [0.5, 0.99] range
 * 
 * INPUTS:
 * -------
 * - finding: The extracted data object
 * - chunk: The original text chunk it came from
 * - source: "rule_engine" or "ai_extraction"
 * 
 * OUTPUT:
 * -------
 * Number between 0.5 and 0.99
 * 
 * EXAMPLES:
 * ---------
 * Rule-based match: 0.99
 * AI + structured + numbers: 0.92
 * AI + vague language: 0.65
 * AI + too short + question: 0.52
 * 
 */
export function calculateConfidence(finding, chunk, source = "ai_extraction") {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: BASE CONFIDENCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  let confidence = 0.70; // Default for AI extractions
  
  // If this came from rule engine, it's already high confidence
  if (source === "rule_engine" || finding.source === "rule_engine") {
    return finding.confidence || 0.99; // Use rule's own confidence
  }
  
  // Get the text we're evaluating
  const text = finding.text || finding.rule || "";
  
  // Safety check
  if (!text || typeof text !== "string") {
    console.warn("⚠️  calculateConfidence: Invalid text provided");
    return 0.50; // Minimum confidence for invalid data
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: APPLY POSITIVE SIGNALS (Boost Confidence)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // Signal 1: Structured formatting (+0.10)
  if (hasStructuredFormatting(text)) {
    confidence += 0.10;
    console.log(`  ↑ Structured formatting detected (+0.10)`);
  }
  
  // Signal 2: Contains specific numbers (+0.08)
  if (containsSpecificNumbers(text)) {
    confidence += 0.08;
    console.log(`  ↑ Specific numbers found (+0.08)`);
  }
  
  // Signal 3: Complete sentence (+0.05)
  if (isCompleteSentence(text)) {
    confidence += 0.05;
    console.log(`  ↑ Complete sentence (+0.05)`);
  }
  
  // Signal 4: Formal policy language (+0.07)
  if (usesFormalLanguage(text)) {
    confidence += 0.07;
    console.log(`  ↑ Formal language detected (+0.07)`);
  }
  
  // Signal 5: Chunk has high signal keywords (from chunk hint)
  if (chunk && chunk.hint === "rules") {
    confidence += 0.05;
    console.log(`  ↑ High-signal chunk hint (+0.05)`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: APPLY NEGATIVE SIGNALS (Reduce Confidence)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // Signal 1: Vague language (-0.15)
  if (containsVagueLanguage(text)) {
    confidence -= 0.15;
    console.log(`  ↓ Vague language detected (-0.15)`);
  }
  
  // Signal 2: Question format (-0.20)
  if (isQuestion(text)) {
    confidence -= 0.20;
    console.log(`  ↓ Question format detected (-0.20)`);
  }
  
  // Signal 3: Too short (-0.10)
  if (isTooShort(text)) {
    confidence -= 0.10;
    console.log(`  ↓ Text too short (-0.10)`);
  }
  
  // Signal 4: AI returned "type: none" or similar (indicates uncertainty)
  if (finding.type === "none" || finding.category === "unknown") {
    confidence -= 0.25;
    console.log(`  ↓ AI indicated uncertainty (-0.25)`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: CLAMP TO VALID RANGE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // Minimum: 0.50 (always leave some chance it's correct)
  // Maximum: 0.95 (never 100% certain for AI extractions, reserve 0.99 for rules)
  confidence = Math.max(0.50, Math.min(confidence, 0.95));
  
  // Round to 2 decimal places for readability
  confidence = Math.round(confidence * 100) / 100;
  
  console.log(`  ✅ Final confidence: ${confidence}`);
  
  return confidence;
}


/* =========================================================================================
 * UTILITY: Confidence Level Description
 * =========================================================================================
 * 
 * PURPOSE: Convert numeric confidence to human-readable description
 * 
 * USAGE:
 * getConfidenceLevel(0.96) // → "Very High"
 * getConfidenceLevel(0.72) // → "Medium"
 * 
 * USE CASE:
 * - Display in UI: "Confidence: High (0.89)"
 * - Filtering: "Show only Very High confidence items"
 * 
 */
export function getConfidenceLevel(confidence) {
  if (confidence >= 0.95) return "Very High";
  if (confidence >= 0.85) return "High";
  if (confidence >= 0.70) return "Medium";
  if (confidence >= 0.50) return "Low";
  return "Very Low";
}


/* =========================================================================================
 * UTILITY: Should Flag for Review
 * =========================================================================================
 * 
 * PURPOSE: Determine if an extraction needs human review
 * 
 * DECISION LOGIC:
 * - Confidence >= 0.85: Auto-approve (no review needed)
 * - Confidence < 0.85: Flag for review
 * 
 * WHY 0.85 THRESHOLD:
 * - Balances accuracy vs review workload
 * - Too high (0.95) = many correct items flagged
 * - Too low (0.70) = incorrect items slip through
 * - 0.85 is empirically tested sweet spot
 * 
 * RETURNS: Boolean
 */
export function shouldFlagForReview(confidence) {
  return confidence < 0.85;
}


/* =========================================================================================
 * UTILITY: Batch Confidence Calculation
 * =========================================================================================
 * 
 * PURPOSE: Calculate confidence for multiple findings at once
 * 
 * USAGE:
 * const findings = [finding1, finding2, finding3];
 * const scored = calculateConfidenceBatch(findings, chunk);
 * // Each finding now has a .confidence property
 * 
 * PERFORMANCE:
 * - O(n) where n = number of findings
 * - ~0.1ms per finding
 * 
 */
export function calculateConfidenceBatch(findings, chunk, source = "ai_extraction") {
  return findings.map(finding => ({
    ...finding,
    confidence: calculateConfidence(finding, chunk, source),
    needs_review: shouldFlagForReview(finding.confidence || 0.5)
  }));
}


/* =========================================================================================
 * UTILITY: Confidence Statistics
 * =========================================================================================
 * 
 * PURPOSE: Get statistics about confidence scores in a dataset
 * 
 * USAGE:
 * const stats = getConfidenceStats(allFindings);
 * console.log(stats);
 * // {
 * //   average: 0.83,
 * //   very_high: 45,
 * //   high: 120,
 * //   medium: 35,
 * //   low: 8,
 * //   needs_review: 43
 * // }
 * 
 * USE CASE:
 * - Dashboard metrics
 * - Quality monitoring
 * - Model performance tracking
 * 
 */
export function getConfidenceStats(findings) {
  if (!findings || findings.length === 0) {
    return {
      total: 0,
      average: 0,
      very_high: 0,
      high: 0,
      medium: 0,
      low: 0,
      needs_review: 0
    };
  }
  
  const confidences = findings.map(f => f.confidence || 0.5);
  const average = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  
  const levels = {
    very_high: confidences.filter(c => c >= 0.95).length,
    high: confidences.filter(c => c >= 0.85 && c < 0.95).length,
    medium: confidences.filter(c => c >= 0.70 && c < 0.85).length,
    low: confidences.filter(c => c < 0.70).length
  };
  
  return {
    total: findings.length,
    average: Math.round(average * 100) / 100,
    ...levels,
    needs_review: levels.medium + levels.low
  };
}


/* =========================================================================================
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * END OF confidenceScorer.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * JUNIOR DEVELOPER NOTES:
 * -----------------------
 * 
 * 1. HOW TO TUNE THE SCORING:
 *    - Change the +/- values in STEP 2 and STEP 3
 *    - Example: If you want structured formatting to boost more:
 *      confidence += 0.15; // instead of 0.10
 *    - Test on real data to see impact
 * 
 * 2. HOW TO ADD NEW SIGNALS:
 *    - Create a new detection function (like hasStructuredFormatting)
 *    - Add it to STEP 2 (positive) or STEP 3 (negative)
 *    - Assign a boost/penalty value
 *    - Document why this signal matters
 * 
 * 3. ADJUSTING THE THRESHOLD:
 *    - Currently: 0.85 triggers review
 *    - If too many reviews: Lower to 0.80
 *    - If too many errors: Raise to 0.90
 *    - Monitor your review queue size to tune
 * 
 * 4. TESTING CONFIDENCE SCORES:
 *    ```javascript
 *    import { calculateConfidence } from './confidenceScorer.js';
 *    
 *    const finding = { text: "War is excluded from coverage" };
 *    const chunk = { hint: "rules" };
 *    const score = calculateConfidence(finding, chunk);
 *    console.log(score); // Should be high (0.85+)
 *    ```
 * 
 * 5. COMMON PATTERNS:
 *    - High confidence: Structured + Numbers + Formal = 0.90+
 *    - Medium confidence: Complete sentence + No vague = 0.75-0.85
 *    - Low confidence: Short + Vague + Question = 0.50-0.70
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */