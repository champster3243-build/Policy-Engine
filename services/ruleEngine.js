/*******************************************************************************************
 * ruleEngine.js (v4.3 - STABLE SECTION-STATE AUTOMATON)
 * =========================================================================================
 * PURPOSE:
 * Extracts rules using a Document State Machine. It identifies "Zones" (Headers)
 * and aggregates fragmented lines into complete, context-aware rules.
 *
 * FIXES in v4.3:
 * - SYNTAX: Fixed the malformed regex literal that caused the server crash.
 * - LOGIC: Preserved the 'Section-State' buffering to fix sentence truncation.
 * - META: Added _meta.rulesApplied so server.js logging never crashes
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
  "fin limite": "financial_limits", // OCR typo seen in logs
  "fin limits": "financial_limits",
  "sub-limits": "financial_limits",
  "coverage": "coverage",
  "what is covered": "coverage",
  "benefits": "coverage",
  "claim": "claim_rejection",
  "claims": "claim_rejection",
  "risk factors": "claim_rejection",
};

// Terms that indicate a line is garbage/noise
const GARBAGE_TERMS = [
  "total rules",
  "page",
  "annexure",
  "list i",
  "list ii",
  "irda",
  "reg no",
  "cin:",
  "uin:",
  "corporate office",
  "registered office",
  "sum insured",
  "premium",
  "policy period",
  "schedule of benefits",
  "contents",
  "authorized signatory",
  "stamp",
  "signature",
];

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Normalizes raw PDF text.
 * FIX: Uses valid Regex literals (no malformed /.../ patterns).
 */
function normalizeTextStream(text) {
  if (!text) return "";

  return String(text)
    .replace(/\r\n/g, "\n")                 // Standardize newlines
    .replace(/\r/g, "\n")                   // Handle stray CR
    .replace(/\u0000/g, "")                 // Remove null bytes
    .replace(/\//g, "")                     // FIXED: Remove forward slashes safely
    .replace(/([a-z])-\n([a-z])/gi, "$1$2") // Fix hyphenation across lines
    .replace(/[ \t]+/g, " ")                // Collapse multiple spaces
    .replace(/\n{3,}/g, "\n\n")             // Collapse excessive newlines
    .trim();
}

/**
 * Checks if a line is likely a Section Header.
 * Uses fuzzy matching to catch "FIN LIMITE" or "WAITING PERIDOS".
 */
function identifySectionHeader(line) {
  const clean = String(line || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length < 3 || clean.length > 40) return null;

  for (const [key, category] of Object.entries(SECTION_MAP)) {
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
  const l = String(line || "").trim();

  // Bullets: >, -, *, •, 1., a), i.
  if (/^([>•\-*]|\d+\.|[a-zA-Z]\)|\([a-z]\)|[ivx]+\.)/.test(l)) return true;

  // Capital letter start heuristic
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
    waiting_periods: [],
    financial_limits: [],
    exclusions: [],
    coverage: [],
    claim_rejection: [],
    _meta: {
      rulesMatched: 0,
      processingTimeMs: 0,
      rulesApplied: ["state_machine_v4"], // ✅ ADDED so server.js can safely .join()
    },
  };

  if (!text) return results;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // STATE VARIABLES
  let currentSection = null;
  let ruleBuffer = "";
  const processedRules = new Set();

  // ─── HELPER: FLUSH BUFFER ───
  const flushBuffer = () => {
    if (!ruleBuffer || ruleBuffer.trim().length < 15) {
      ruleBuffer = "";
      return;
    }

    let cleanRule = ruleBuffer
      .replace(/^[>•\-*\d\.)\s]+/, "") // Remove leading bullets
      .replace(/\s+/g, " ")
      .trim();

    const lowerClean = cleanRule.toLowerCase();

    // Skip garbage
    if (GARBAGE_TERMS.some((t) => lowerClean.includes(t)) || /^\d+$/.test(cleanRule)) {
      ruleBuffer = "";
      return;
    }

    // Deduplicate
    const ruleKey = lowerClean.replace(/[^a-z0-9]/g, "");
    if (ruleKey.length < 10 || processedRules.has(ruleKey)) {
      ruleBuffer = "";
      return;
    }
    processedRules.add(ruleKey);

    // Classification
    let category = currentSection;

    if (!category) {
      if (/waiting period|months|years/i.test(lowerClean) && /\d+/.test(lowerClean)) {
        category = "waiting_periods";
      } else if (/limit|capped|upto|sub-limit|co-pay|copay|deductible/i.test(lowerClean)) {
        category = "financial_limits";
      } else if (/excluded|not covered|not payable/i.test(lowerClean)) {
        category = "exclusions";
      } else if (/notify|intimate|submit|claim|documentation/i.test(lowerClean)) {
        category = "claim_rejection";
      }
    }

    if (category && results[category]) {
      results[category].push({
        category,
        text: cleanRule,
        extractionMethod: "state_machine_v4",
        confidence: 0.95,
      });
      results._meta.rulesMatched++;
    }

    ruleBuffer = "";
  };

  // ─── MAIN LOOP ───
  for (const line of lines) {
    const newSection = identifySectionHeader(line);
    if (newSection) {
      flushBuffer();
      currentSection = newSection;
      continue;
    }

    if (isNewRuleStart(line)) {
      flushBuffer();
      ruleBuffer = line;
    } else {
      if (ruleBuffer) ruleBuffer += " " + line;
      else ruleBuffer = line;
    }
  }

  flushBuffer();

  results._meta.processingTimeMs = Date.now() - startTime;
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: SERVER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════════════

function routeRuleResults(ruleResults, collected) {
  const categoryMap = {
    waiting_periods: "waiting_periods",
    financial_limits: "financial_limits",
    exclusions: "exclusions",
    coverage: "coverage",
    claim_rejection: "claim_rejection_conditions",
  };

  for (const [ruleCat, serverCat] of Object.entries(categoryMap)) {
    if (!ruleResults?.[ruleCat]) continue;

    for (const item of ruleResults[ruleCat]) {
      if (item?.text) {
        if (Array.isArray(collected?.[serverCat]) && !collected[serverCat].includes(item.text)) {
          collected[serverCat].push(item.text);
        }
      }
    }
  }
}

// Dummy export for RULE_PATTERNS to maintain API compatibility
const RULE_PATTERNS = {};

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };
