/*******************************************************************************************
 * ruleEngine.js (v4.2 - STABLE STATE MACHINE)
 * =========================================================================================
 * * PURPOSE: 
 * Extracts rules using a Document State Machine. It identifies "Zones" (Headers) 
 * and aggregates fragmented lines into complete, context-aware rules.
 * * * FIXES in v4.2:
 * - REVERTED to Standard Regex Literals (/.../g) to eliminate SyntaxErrors.
 * - PRESERVED the "Section-State" logic which solves the truncation/context issues.
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

// Mappings of OCR-messy headers to Clean Categories
const SECTION_MAP = {
  "waiting period": "waiting_periods",
  "waiting peridos": "waiting_periods", // Common OCR typo
  "exclusions": "exclusions",
  "specific exclusions": "exclusions",
  "what is not covered": "exclusions",
  "financial limits": "financial_limits",
  "fin limite": "financial_limits",     // OCR typo seen in logs
  "fin limits": "financial_limits",
  "sub-limits": "financial_limits",
  "coverage": "coverage",
  "what is covered": "coverage",
  "benefits": "coverage",
  "claim": "claim_rejection",
  "claims": "claim_rejection",
  "risk factors": "claim_rejection"
};

// Terms that indicate a line is garbage/noise
const GARBAGE_TERMS = [
  "total rules", "page", "annexure", "list i", "list ii", "irda", "reg no", "cin:", "uin:", 
  "corporate office", "registered office", "sum insured", "premium", "policy period", 
  "schedule of benefits", "contents", "authorized signatory", "stamp", "signature"
];

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Normalizes raw PDF text.
 * Uses standard literals to prevent SyntaxErrors.
 */
function normalizeTextStream(text) {
  if (!text) return "";
  
  return text
    .replace(/\r\n/g, "\n")                 // Standardize newlines
    .replace(/\/g, "")      // Remove tags safely
    .replace(/([a-z])-\n([a-z])/ig, "$1$2") // Fix hyphenation across lines
    .replace(/[ \t]+/g, " ")                // Collapse multiple spaces
    .trim();
}

/**
 * Checks if a line is likely a Section Header.
 * Uses Fuzzy Matching to catch "FIN LIMITE" or "WAITING PERIDOS".
 */
function identifySectionHeader(line) {
  const clean = line.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (clean.length < 3 || clean.length > 40) return null;

  for (const [key, category] of Object.entries(SECTION_MAP)) {
    // Exact match or high-confidence substring match
    if (clean === key || (clean.includes(key) && clean.length < key.length + 10)) {
      return category;
    }
  }
  return null;
}

/**
 * Checks if a line starts a new rule (Bullet point, Number, or abrupt start).
 */
function isNewRuleStart(line) {
  const l = line.trim();
  // Bullets: >, -, *, •, 1., a), i.
  if (/^([>•\-*]|\d+\.|[a-zA-Z]\)|\([a-z]\)|[ivx]+\.)/.test(l)) return true;
  // Capital letter start (heuristic for new sentence in lists)
  if (/^[A-Z][^a-z]{0,2}/.test(l) && l.length > 5) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: THE STATE MACHINE (CORE ENGINE)
// ═══════════════════════════════════════════════════════════════════════════════════════

function runRuleBasedExtraction(rawText) {
  const startTime = Date.now();
  const text = normalizeTextStream(rawText);
  
  const results = {
    waiting_periods: [], financial_limits: [], exclusions: [],
    coverage: [], claim_rejection: [],
    _meta: { rulesMatched: 0, processingTimeMs: 0 }
  };

  if (!text) return results;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // STATE VARIABLES
  let currentSection = null;
  let ruleBuffer = "";
  const processedRules = new Set(); // For deduplication

  // ─── HELPER: FLUSH BUFFER ───
  const flushBuffer = () => {
    if (!ruleBuffer || ruleBuffer.length < 15) {
      ruleBuffer = ""; 
      return;
    }

    // Clean up the rule
    let cleanRule = ruleBuffer
      .replace(/^[>•\-*\d\.)\s]+/, "") // Remove leading bullets
      .replace(/\s+/g, " ")
      .trim();

    // Skip Garbage
    if (GARBAGE_TERMS.some(t => cleanRule.toLowerCase().includes(t)) || /^\d+$/.test(cleanRule)) {
      ruleBuffer = ""; 
      return;
    }

    // Deduplicate
    const ruleKey = cleanRule.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (processedRules.has(ruleKey)) {
      ruleBuffer = "";
      return;
    }
    processedRules.add(ruleKey);

    // INTELLIGENT CLASSIFICATION
    // 1. If we are in a known section, use that.
    // 2. If not, try to guess based on keywords (Fallback).
    let category = currentSection;
    
    if (!category) {
      const lower = cleanRule.toLowerCase();
      if (/waiting period|months|years/i.test(lower) && /\d+/.test(lower)) category = "waiting_periods";
      else if (/limit|capped|upto|sub-limit|co-pay/i.test(lower)) category = "financial_limits";
      else if (/excluded|not covered|not payable/i.test(lower)) category = "exclusions";
      else if (/notify|intimate|submit|claim/i.test(lower)) category = "claim_rejection";
    }

    // Add to results if we have a category
    if (category && results[category]) {
      results[category].push({
        category: category,
        text: cleanRule,
        extractionMethod: "state_machine_v4",
        confidence: 0.95
      });
      results._meta.rulesMatched++;
    }

    ruleBuffer = "";
  };

  // ─── MAIN LOOP ───
  for (const line of lines) {
    // 1. CHECK FOR SECTION HEADER
    const newSection = identifySectionHeader(line);
    if (newSection) {
      flushBuffer(); // Save whatever we were working on
      currentSection = newSection;
      continue;
    }

    // 2. CHECK FOR NEW RULE START
    if (isNewRuleStart(line)) {
      flushBuffer(); // Previous rule is done
      ruleBuffer = line;
    } else {
      // 3. APPEND TO BUFFER (Continuation of previous line)
      if (ruleBuffer) {
        ruleBuffer += " " + line;
      } else {
        // Orphan line, treat as new start if it looks substantial
        ruleBuffer = line;
      }
    }
  }
  
  // Final Flush
  flushBuffer();

  results._meta.processingTimeMs = Date.now() - startTime;
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: SERVER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Routes the extracted rules into the collected object structure used by server.js
 */
function routeRuleResults(ruleResults, collected) {
  const categoryMap = {
    'waiting_periods': 'waiting_periods',
    'financial_limits': 'financial_limits',
    'exclusions': 'exclusions',
    'coverage': 'coverage',
    'claim_rejection': 'claim_rejection_conditions'
  };

  for (const [ruleCat, serverCat] of Object.entries(categoryMap)) {
    if (!ruleResults[ruleCat]) continue;
    
    for (const item of ruleResults[ruleCat]) {
      if (item && item.text) {
        // Basic check to avoid exact duplicates in the final output
        if (!collected[serverCat].includes(item.text)) {
          collected[serverCat].push(item.text);
        }
      }
    }
  }
}

// Dummy export for RULE_PATTERNS to maintain API compatibility
const RULE_PATTERNS = {}; 

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };