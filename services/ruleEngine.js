/*******************************************************************************************
 * ruleEngine.js (v4.4 - FINAL STABLE SYNTAX)
 * =========================================================================================
 * * PURPOSE: Extracts structured rules using Section-State logic.
 * * FIX: Replaced all fragile regex literals with robust string-based patterns.
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const SECTION_MAP = {
  "waiting period": "waiting_periods",
  "waiting peridos": "waiting_periods",
  "exclusions": "exclusions",
  "specific exclusions": "exclusions",
  "what is not covered": "exclusions",
  "financial limits": "financial_limits",
  "fin limite": "financial_limits",
  "fin limits": "financial_limits",
  "sub-limits": "financial_limits",
  "coverage": "coverage",
  "what is covered": "coverage",
  "benefits": "coverage",
  "claim": "claim_rejection",
  "claims": "claim_rejection",
  "risk factors": "claim_rejection",
};

const GARBAGE_TERMS = [
  "total rules", "page", "annexure", "list i", "list ii", "irda", "reg no",
  "cin:", "uin:", "corporate office", "registered office", "sum insured",
  "premium", "policy period", "schedule of benefits", "contents",
  "authorized signatory", "stamp", "signature",
];

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════

function normalizeTextStream(text) {
  if (!text) return "";

  // Safe Regex Construction to avoid parser errors
  const sourceTag = new RegExp("\\", "g");
  const forwardSlash = new RegExp("/", "g"); // Replaces literal / 
  const hyphenFix = new RegExp("([a-z])-\\n([a-z])", "ig");

  return text
    .replace(/\r\n/g, "\n")
    .replace(sourceTag, "") 
    .replace(forwardSlash, "") 
    .replace(hyphenFix, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function identifySectionHeader(line) {
  const clean = line.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (clean.length < 3 || clean.length > 40) return null;

  for (const [key, category] of Object.entries(SECTION_MAP)) {
    if (clean === key || (clean.includes(key) && clean.length < key.length + 10)) {
      return category;
    }
  }
  return null;
}

function isNewRuleStart(line) {
  const l = line.trim();
  // Bullets: >, -, *, •, 1., a), i.
  if (/^([>•\-*]|\d+\.|[a-zA-Z]\)|\([a-z]\)|[ivx]+\.)/.test(l)) return true;
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
    _meta: { rulesMatched: 0, processingTimeMs: 0 },
  };

  if (!text) return results;

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  let currentSection = null;
  let ruleBuffer = "";
  const processedRules = new Set();

  const flushBuffer = () => {
    if (!ruleBuffer || ruleBuffer.length < 15) {
      ruleBuffer = "";
      return;
    }

    let cleanRule = ruleBuffer
      .replace(/^[>•\-*\d\.)\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      GARBAGE_TERMS.some((t) => cleanRule.toLowerCase().includes(t)) ||
      /^\d+$/.test(cleanRule)
    ) {
      ruleBuffer = "";
      return;
    }

    const ruleKey = cleanRule.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (processedRules.has(ruleKey)) {
      ruleBuffer = "";
      return;
    }
    processedRules.add(ruleKey);

    let category = currentSection;

    // Fallback Categorization
    if (!category) {
      const lower = cleanRule.toLowerCase();
      if (/waiting period|months|years/i.test(lower) && /\d+/.test(lower))
        category = "waiting_periods";
      else if (/limit|capped|upto|sub-limit|co-pay/i.test(lower))
        category = "financial_limits";
      else if (/excluded|not covered|not payable/i.test(lower))
        category = "exclusions";
      else if (/notify|intimate|submit|claim/i.test(lower))
        category = "claim_rejection";
    }

    if (category && results[category]) {
      results[category].push({
        category: category,
        text: cleanRule,
        extractionMethod: "state_machine_v4",
        confidence: 0.95,
      });
      results._meta.rulesMatched++;
    }

    ruleBuffer = "";
  };

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
      if (ruleBuffer) {
        ruleBuffer += " " + line;
      } else {
        ruleBuffer = line;
      }
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
    if (!ruleResults[ruleCat]) continue;

    for (const item of ruleResults[ruleCat]) {
      if (item && item.text) {
        if (!collected[serverCat].includes(item.text)) {
          collected[serverCat].push(item.text);
        }
      }
    }
  }
}

const RULE_PATTERNS = {};

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };