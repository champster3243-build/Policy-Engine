/*******************************************************************************************
 * ruleEngine.js (v5.2 - PRODUCTION HARDENED + SERVER INTEGRATION FIXES)
 * 
 * Changes from v5.1:
 * - Fixed routeRuleResults category mapping (claim_rejection -> claim_rejection_conditions)
 * - Added VALID_CATEGORIES constant for consistency
 * - Improved anchor token extraction (skip common words)
 * - Added reset() method to DeduplicationEngine
 * - Better handling of empty/null inputs throughout
 * - Explicit exports for all server-used functions
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Valid rule categories - single source of truth
 */
const VALID_CATEGORIES = [
  "waiting_periods",
  "financial_limits",
  "exclusions",
  "coverage",
  "claim_rejection"
];

/**
 * Common words to skip when extracting anchor tokens
 */
const COMMON_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was",
  "one", "our", "out", "has", "have", "been", "were", "being", "their", "there",
  "will", "shall", "would", "could", "should", "this", "that", "with", "from",
  "they", "which", "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "again", "further", "then", "once",
  "here", "where", "when", "what", "other", "some", "such", "only", "same",
  "than", "very", "just", "also", "back", "been", "being", "both", "each",
  "insured", "insurance", "policy", "cover", "covered", "claim", "claims",
  "period", "limit", "amount", "sum", "benefit", "benefits", "treatment",
]);

/**
 * Section header patterns with fuzzy matching support
 */
const SECTION_PATTERNS = [
  // Waiting periods
  { pattern: /waiting\s*period/i, category: "waiting_periods", priority: 10 },
  { pattern: /waiting\s*perido/i, category: "waiting_periods", priority: 10 },
  { pattern: /cooling[\s-]*off/i, category: "waiting_periods", priority: 8 },
  
  // Exclusions
  { pattern: /(?:specific\s+)?exclusions?/i, category: "exclusions", priority: 12 },
  { pattern: /what\s+is\s+not\s+covered/i, category: "exclusions", priority: 12 },
  { pattern: /not\s+payable/i, category: "exclusions", priority: 10 },
  
  // Financial limits
  { pattern: /financial\s*limits?/i, category: "financial_limits", priority: 10 },
  { pattern: /sub[\s-]*limits?/i, category: "financial_limits", priority: 9 },
  { pattern: /room\s*rent\s*(?:limit|cap)/i, category: "financial_limits", priority: 9 },
  
  // Coverage
  { pattern: /(?:what\s+is\s+)?covered/i, category: "coverage", priority: 7 },
  { pattern: /benefits?\s*(?:summary|highlights)?/i, category: "coverage", priority: 6 },
  { pattern: /scope\s+of\s+cover/i, category: "coverage", priority: 8 },
  
  // Claims
  { pattern: /claim\s*(?:procedure|process|submission)/i, category: "claim_rejection", priority: 10 },
  { pattern: /how\s+to\s+(?:file|make)\s+a?\s*claim/i, category: "claim_rejection", priority: 10 },
  { pattern: /claim\s*rejection/i, category: "claim_rejection", priority: 11 },
];

/**
 * Content signals for category detection
 */
const CONTENT_SIGNALS = {
  waiting_periods: {
    strong: [
      /waiting\s*period\s*(?:of\s*)?\d+/i,
      /\d+\s*(?:days?|months?|years?)\s*waiting/i,
      /coverage\s*(?:will\s*)?(?:commence|start|begin)\s*after\s*\d+/i,
      /pre[\s-]*existing\s*.*\d+\s*(?:months?|years?)/i,
    ],
    weak: [
      /moratorium/i,
      /initial\s*period/i,
    ]
  },
  
  financial_limits: {
    strong: [
      /(?:up\s*to|maximum|limit(?:ed)?\s*to|capped\s*at)\s*(?:rs\.?|inr|₹)?\s*[\d,]+/i,
      /(?:rs\.?|inr|₹)\s*[\d,]+\s*(?:per|\/)\s*(?:day|claim|year|policy)/i,
      /\d+\s*%\s*(?:of\s*)?(?:sum\s*insured|si|co[\s-]*pay)/i,
      /sub[\s-]*limit\s*(?:of|:)?\s*(?:rs\.?|inr|₹)?\s*[\d,]+/i,
      /room\s*rent.*(?:capped|limit|max)/i,
    ],
    weak: [
      /aggregate/i,
      /cumulative/i,
      /deductible/i,
    ]
  },
  
  exclusions: {
    strong: [
      /(?:is|are)\s*(?:not\s*)?excluded/i,
      /(?:will|shall)\s*not\s*(?:be\s*)?(?:covered|payable|admissible)/i,
      /no\s*(?:claim|coverage|benefit)\s*(?:will\s*be|is|for)/i,
      /not\s*covered\s*under/i,
      /does\s*not\s*cover/i,
    ],
    weak: [
      /exception/i,
      /unless\s*(?:specifically|otherwise)/i,
    ]
  },
  
  coverage: {
    strong: [
      /(?:is|are)\s*covered\s*under/i,
      /(?:we|insurer)\s*(?:will|shall)\s*pay\s*for/i,
      /coverage\s*(?:includes?|extends?\s*to)/i,
      /(?:will|shall)\s*(?:be\s*)?(?:covered|payable|reimbursed)/i,
    ],
    weak: [
      /benefit/i,
      /eligible\s*for/i,
    ]
  },
  
  claim_rejection: {
    strong: [
      /claim\s*(?:must|should|shall)\s*be\s*(?:submitted|filed|intimated)/i,
      /(?:notify|intimate)\s*(?:us|insurer|tpa|company)\s*within\s*\d+/i,
      /\d+\s*(?:days?|hours?)\s*(?:of|from)\s*(?:admission|discharge|diagnosis)/i,
      /documents?\s*(?:required|must\s*be\s*submitted)/i,
      /claim\s*(?:will|may|shall)\s*be\s*rejected\s*if/i,
      /failure\s*to\s*(?:notify|intimate|submit)/i,
    ],
    weak: [
      /tpa/i,
      /documentation/i,
      /intimation/i,
    ]
  }
};

/**
 * Procedure list indicators
 */
const PROCEDURE_LIST_INDICATORS = {
  headerPatterns: [
    /(?:list\s*of\s*)?(?:covered\s*)?(?:surgeries|procedures|treatments|diseases|ailments)/i,
    /following\s*(?:are|is)\s*(?:covered|included)\s*:/i,
    /coverage\s*(?:includes?|for)\s*:/i,
  ],
  modalVerbs: /\b(?:shall|will|must|should|may|can|cannot|not)\b/i,
  maxItemLength: 80,
  minItemsForList: 4,
};

/**
 * Garbage patterns - content to completely ignore
 */
const GARBAGE_PATTERNS = [
  /^(?:page|pg\.?)\s*\d+\s*(?:of\s*\d+)?$/i,
  /^(?:annexure|appendix)\s*[a-z\d]$/i,
  /(?:irda|irdai)\s*reg(?:istration)?/i,
  /(?:cin|uin)\s*:\s*[a-z0-9]+/i,
  /(?:corporate|registered)\s*office\s*:/i,
  /^\s*(?:authorized\s*)?signatory\s*$/i,
  /^\s*(?:stamp|signature|seal)\s*$/i,
  /^table\s*of\s*contents?$/i,
  /^\d+\s*$/,
  /^[a-z]\s*$/i,
];

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: TEXT PROCESSING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Normalize text for processing
 */
function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/([a-z])-\n([a-z])/gi, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/—|–/g, "-")
    .trim();
}

/**
 * Create dedupe key - CONSERVATIVE normalization
 */
function createDedupeKey(text) {
  if (!text || typeof text !== "string") return "";
  
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(w => w.length > 2)
    .join(" ")
    .trim();
}

/**
 * Extract anchor tokens for candidate filtering
 * IMPROVED: Skip common words for better selectivity
 */
function extractAnchorTokens(text, count = 3) {
  if (!text || typeof text !== "string") return [];
  
  const key = createDedupeKey(text);
  const tokens = key.split(" ");
  
  // Filter out common words and sort by length
  return tokens
    .filter(t => t.length > 4 && !COMMON_WORDS.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, count);
}

/**
 * Calculate Jaccard similarity between two strings
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const key1 = createDedupeKey(str1);
  const key2 = createDedupeKey(str2);
  
  if (key1 === key2) return 1.0;
  if (!key1 || !key2) return 0.0;
  
  const tokens1 = new Set(key1.split(" "));
  const tokens2 = new Set(key2.split(" "));
  
  let intersection = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++;
  }
  
  const union = tokens1.size + tokens2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: DETECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Detect section header
 */
function detectSectionHeader(line) {
  if (!line || typeof line !== "string") return null;
  
  const clean = line.trim();
  if (clean.length < 3 || clean.length > 60) return null;
  
  const looksLikeHeader = 
    /^[A-Z\s]+$/.test(clean) ||
    (/^[A-Z]/.test(clean) && clean.length < 40) ||
    /^\d+\.?\s*[A-Z]/.test(clean) ||
    /^[IVXLC]+\.?\s/i.test(clean);
  
  let bestMatch = null;
  
  for (const { pattern, category, priority } of SECTION_PATTERNS) {
    if (pattern.test(clean)) {
      const confidence = looksLikeHeader ? 0.9 : 0.7;
      if (!bestMatch || priority > bestMatch.priority) {
        bestMatch = { category, confidence, priority };
      }
    }
  }
  
  return bestMatch ? { category: bestMatch.category, confidence: bestMatch.confidence } : null;
}

/**
 * Detect if line starts a new rule
 */
function isRuleStart(line) {
  if (!line || typeof line !== "string") return false;
  
  const l = line.trim();
  if (!l) return false;
  
  // Bullet points
  if (/^[•·▪▸►◦○●]\s/.test(l)) return true;
  // Numbered lists
  if (/^\d{1,2}[.\)]\s/.test(l)) return true;
  // Lettered lists
  if (/^[a-z][.\)]\s/i.test(l)) return true;
  // Roman numerals
  if (/^[ivxlc]+[.\)]\s/i.test(l)) return true;
  // Parenthetical markers
  if (/^\([a-z0-9]+\)\s/i.test(l)) return true;
  // Dashes as bullets
  if (/^[-–—]\s/.test(l)) return true;
  // Asterisk bullets
  if (/^\*\s/.test(l)) return true;
  // Greater-than as bullet
  if (/^>\s/.test(l)) return true;
  
  return false;
}

/**
 * Improved continuation detection
 */
function isContinuation(line, previousLine) {
  if (!line || !previousLine) return false;
  
  const l = String(line).trim();
  const prev = String(previousLine).trim();
  
  if (!l || !prev) return false;
  
  // HARD BOUNDARIES
  if (/[.!?]\s*$/.test(prev) && isRuleStart(l)) return false;
  if (detectSectionHeader(l)) return false;
  
  // SOFT CONTINUATION SIGNALS
  if (/^[a-z]/.test(l)) return true;
  if (/(?:and|or|but|that|which|where|when|if|unless|provided|including|excluding|such\s+as|,)\s*$/i.test(prev)) {
    return true;
  }
  if (!/[.!?:;]\s*$/.test(prev) && prev.length > 15) {
    return true;
  }
  
  return false;
}

/**
 * Detect procedure list zone
 */
function detectProcedureListZone(lines, startIndex) {
  if (!Array.isArray(lines)) return { inList: false, confidence: 0 };
  
  let shortItemCount = 0;
  let itemsWithoutModals = 0;
  const checkCount = Math.min(8, lines.length - startIndex);
  
  for (let i = 0; i < checkCount; i++) {
    const line = lines[startIndex + i];
    if (!line || line.length < 3) continue;
    
    if (line.length < PROCEDURE_LIST_INDICATORS.maxItemLength) {
      shortItemCount++;
      if (!PROCEDURE_LIST_INDICATORS.modalVerbs.test(line)) {
        itemsWithoutModals++;
      }
    }
  }
  
  const density = shortItemCount / Math.max(checkCount, 1);
  const noModalRatio = itemsWithoutModals / Math.max(shortItemCount, 1);
  
  const isLikelyList = density > 0.7 && noModalRatio > 0.6 && 
    shortItemCount >= PROCEDURE_LIST_INDICATORS.minItemsForList;
  
  return {
    inList: isLikelyList,
    confidence: density * noModalRatio
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: CONTENT-AWARE CATEGORIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Categorize content with strict requirements for overriding section context
 */
function categorizeByContent(text, sectionContext = null) {
  if (!text || typeof text !== "string") return null;
  
  const cleanText = text.trim();
  if (cleanText.length < 10) return null;
  
  const scores = {};
  const details = {};
  
  for (const [category, signals] of Object.entries(CONTENT_SIGNALS)) {
    let strongCount = 0;
    let weakCount = 0;
    
    for (const pattern of signals.strong || []) {
      if (pattern.test(cleanText)) strongCount++;
    }
    
    for (const pattern of signals.weak || []) {
      if (pattern.test(cleanText)) weakCount++;
    }
    
    let score = (strongCount * 10) + (weakCount * 3);
    if (category === sectionContext) score += 5;
    
    scores[category] = score;
    details[category] = { strongCount, weakCount, score };
  }
  
  // Find best category
  let bestCategory = null;
  let bestScore = 0;
  let bestDetails = null;
  
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
      bestDetails = details[category];
    }
  }
  
  // STRICT OVERRIDE RULE
  if (bestCategory && bestCategory !== sectionContext && sectionContext) {
    if (bestDetails.strongCount === 0) {
      if (scores[sectionContext] >= 3) {
        return {
          category: sectionContext,
          confidence: 0.65,
          reason: "section_context_preserved",
          overrideBlocked: true
        };
      }
    }
  }
  
  // Minimum threshold
  if (bestScore < 5) {
    if (sectionContext && scores[sectionContext] >= 0) {
      return {
        category: sectionContext,
        confidence: 0.55,
        reason: "weak_fallback_to_section"
      };
    }
    return null;
  }
  
  // Calculate confidence
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const margin = sortedScores[0] - (sortedScores[1] || 0);
  const confidence = Math.min(0.95, 0.6 + (margin / 30) + (bestDetails.strongCount * 0.1));
  
  return {
    category: bestCategory,
    confidence: Math.round(confidence * 100) / 100,
    reason: `strong:${bestDetails.strongCount},weak:${bestDetails.weakCount}`,
    contentScore: bestScore
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 5: DEDUPLICATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════════════

class DeduplicationEngine {
  constructor(similarityThreshold = 0.92) {
    this.threshold = similarityThreshold;
    this.rules = [];
    this.exactKeyIndex = new Map();
    this.anchorIndex = new Map();
  }
  
  /**
   * Reset the engine (useful for testing)
   */
  reset() {
    this.rules = [];
    this.exactKeyIndex.clear();
    this.anchorIndex.clear();
  }
  
  /**
   * Add a rule with O(candidates) lookup using anchor-based filtering
   */
  addRule(text, category, confidence, metadata = {}) {
    if (!text || typeof text !== "string") {
      return { added: false, reason: "invalid_input" };
    }
    
    const key = createDedupeKey(text);
    
    if (key.length < 10) {
      return { added: false, reason: "too_short" };
    }
    
    // Fast path: exact key match
    if (this.exactKeyIndex.has(key)) {
      const existing = this.exactKeyIndex.get(key);
      if (confidence > existing.confidence) {
        existing.text = text;
        existing.confidence = confidence;
        existing.category = category;
        return { added: false, reason: "replaced_lower_confidence" };
      }
      return { added: false, reason: "exact_duplicate" };
    }
    
    // Get candidates using anchor tokens
    const anchors = extractAnchorTokens(text);
    const candidateIndices = new Set();
    
    for (const anchor of anchors) {
      const indices = this.anchorIndex.get(anchor);
      if (indices) {
        for (const idx of indices) candidateIndices.add(idx);
      }
    }
    
    // Check similarity against candidates
    for (const idx of candidateIndices) {
      const existing = this.rules[idx];
      if (!existing) continue;
      
      const similarity = calculateSimilarity(text, existing.text);
      if (similarity >= this.threshold) {
        if (confidence >= existing.confidence - 0.1 && text.length > existing.text.length * 1.2) {
          existing.text = text;
          existing.confidence = confidence;
          existing.category = category;
          return { added: false, reason: "replaced_shorter" };
        }
        return { added: false, reason: `fuzzy_duplicate:${Math.round(similarity * 100)}%` };
      }
    }
    
    // Add new rule
    const ruleIndex = this.rules.length;
    const rule = { key, text, category, confidence, ...metadata };
    this.rules.push(rule);
    this.exactKeyIndex.set(key, rule);
    
    // Index by anchor tokens
    for (const anchor of anchors) {
      if (!this.anchorIndex.has(anchor)) {
        this.anchorIndex.set(anchor, new Set());
      }
      this.anchorIndex.get(anchor).add(ruleIndex);
    }
    
    return { added: true, reason: "new_rule" };
  }
  
  getByCategory() {
    const result = {};
    for (const rule of this.rules) {
      if (!result[rule.category]) result[rule.category] = [];
      result[rule.category].push(rule);
    }
    return result;
  }
  
  getStats() {
    const byCategory = this.getByCategory();
    return {
      totalRules: this.rules.length,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, v.length])
      )
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 6: MAIN EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════════════

const STATE = {
  SCANNING: "scanning",
  IN_SECTION: "in_section",
  BUILDING_RULE: "building_rule",
  IN_PROCEDURE_LIST: "in_procedure_list"
};

/**
 * Main extraction function
 */
function runRuleBasedExtraction(rawText, options = {}) {
  const startTime = Date.now();
  const {
    similarityThreshold = 0.92,
    minRuleLength = 15,
    maxRuleLength = 2000,
    prependFragment = null,
    debug = false
  } = options;
  
  // Handle null/undefined input
  if (!rawText || typeof rawText !== "string") {
    return buildResults(new DeduplicationEngine(similarityThreshold), {
      rulesMatched: 0,
      rulesRejected: 0,
      duplicatesFound: 0,
      processingTimeMs: Date.now() - startTime,
      rulesApplied: ["state_machine_v5.2"],
      sectionTransitions: [],
      trailingFragment: null,
    }, startTime);
  }
  
  let text = normalizeText(rawText);
  
  // Prepend trailing fragment from previous chunk
  if (prependFragment && typeof prependFragment === "string" && prependFragment.trim()) {
    text = prependFragment.trim() + " " + text;
  }
  
  const dedupe = new DeduplicationEngine(similarityThreshold);
  
  const meta = {
    rulesMatched: 0,
    rulesRejected: 0,
    duplicatesFound: 0,
    processingTimeMs: 0,
    rulesApplied: ["state_machine_v5.2"],
    sectionTransitions: [],
    trailingFragment: null,
    debug: debug ? [] : undefined
  };
  
  if (!text) {
    return buildResults(dedupe, meta, startTime);
  }
  
  const lines = text.split("\n").map(l => l.trim());
  
  let state = STATE.SCANNING;
  let currentSection = null;
  let ruleBuffer = "";
  let previousLine = "";
  let procedureListBuffer = [];
  let procedureListHeader = "";
  
  const log = (msg) => {
    if (debug && meta.debug) meta.debug.push(msg);
  };
  
  const emitRule = (forceCategory = null) => {
    if (!ruleBuffer || ruleBuffer.trim().length < minRuleLength) {
      ruleBuffer = "";
      return;
    }
    
    let cleanRule = ruleBuffer
      .replace(/^[•·▪▸►◦○●\-–—*>]\s*/, "")
      .replace(/^\d{1,2}[.\)]\s*/, "")
      .replace(/^[a-z][.\)]\s*/i, "")
      .replace(/^[ivxlc]+[.\)]\s*/i, "")
      .replace(/^\([a-z0-9]+\)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    
    // Check garbage
    if (GARBAGE_PATTERNS.some(p => p.test(cleanRule))) {
      log(`Rejected (garbage): ${cleanRule.slice(0, 50)}...`);
      meta.rulesRejected++;
      ruleBuffer = "";
      return;
    }
    
    if (cleanRule.length > maxRuleLength) {
      cleanRule = cleanRule.slice(0, maxRuleLength) + "...";
    }
    
    const categorization = categorizeByContent(cleanRule, forceCategory || currentSection);
    
    if (!categorization) {
      log(`Rejected (no category): ${cleanRule.slice(0, 50)}...`);
      meta.rulesRejected++;
      ruleBuffer = "";
      return;
    }
    
    const result = dedupe.addRule(
      cleanRule,
      categorization.category,
      categorization.confidence,
      {
        reason: categorization.reason,
        extractionMethod: "state_machine_v5.2",
        sectionContext: currentSection
      }
    );
    
    if (result.added) {
      meta.rulesMatched++;
      log(`Added: [${categorization.category}] ${cleanRule.slice(0, 50)}...`);
    } else {
      meta.duplicatesFound++;
      log(`Duplicate (${result.reason}): ${cleanRule.slice(0, 50)}...`);
    }
    
    ruleBuffer = "";
  };
  
  const emitProcedureList = () => {
    if (procedureListBuffer.length < PROCEDURE_LIST_INDICATORS.minItemsForList) {
      for (const item of procedureListBuffer) {
        ruleBuffer = item;
        emitRule("coverage");
      }
      procedureListBuffer = [];
      procedureListHeader = "";
      return;
    }
    
    const header = procedureListHeader || "Coverage includes";
    const combinedText = `${header}: ${procedureListBuffer.join("; ")}`;
    
    const result = dedupe.addRule(
      combinedText,
      "coverage",
      0.7,
      {
        reason: "procedure_list_grouped",
        extractionMethod: "state_machine_v5.2",
        itemCount: procedureListBuffer.length
      }
    );
    
    if (result.added) meta.rulesMatched++;
    
    procedureListBuffer = [];
    procedureListHeader = "";
  };
  
  // Main processing loop
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Empty line handling
    if (!line) {
      if (state === STATE.BUILDING_RULE && ruleBuffer.length > 50) {
        if (/[.!?]\s*$/.test(ruleBuffer)) {
          emitRule();
          state = currentSection ? STATE.IN_SECTION : STATE.SCANNING;
        }
      }
      previousLine = line;
      continue;
    }
    
    // Section header detection
    const sectionMatch = detectSectionHeader(line);
    if (sectionMatch && sectionMatch.confidence >= 0.7) {
      emitRule();
      emitProcedureList();
      
      meta.sectionTransitions.push({
        from: currentSection,
        to: sectionMatch.category,
        lineNumber: i
      });
      
      currentSection = sectionMatch.category;
      state = STATE.IN_SECTION;
      log(`Section: ${currentSection} (line ${i})`);
      previousLine = line;
      continue;
    }
    
    // Procedure list header detection
    if (PROCEDURE_LIST_INDICATORS.headerPatterns.some(p => p.test(line))) {
      emitRule();
      procedureListHeader = line.replace(/:\s*$/, "");
      
      const listZone = detectProcedureListZone(lines, i + 1);
      if (listZone.inList) {
        state = STATE.IN_PROCEDURE_LIST;
        log(`Procedure list started (line ${i})`);
        previousLine = line;
        continue;
      }
    }
    
    // State machine
    switch (state) {
      case STATE.SCANNING:
      case STATE.IN_SECTION:
        if (isRuleStart(line)) {
          emitRule();
          ruleBuffer = line;
          state = STATE.BUILDING_RULE;
        } else if (isContinuation(line, previousLine) && ruleBuffer) {
          ruleBuffer += " " + line;
        } else if (line.length > 20) {
          emitRule();
          ruleBuffer = line;
          state = STATE.BUILDING_RULE;
        }
        break;
        
      case STATE.BUILDING_RULE:
        if (isRuleStart(line)) {
          emitRule();
          ruleBuffer = line;
        } else if (isContinuation(line, previousLine)) {
          ruleBuffer += " " + line;
        } else if (/^[A-Z]/.test(line) && /[.!?]\s*$/.test(ruleBuffer) && line.length > 20) {
          emitRule();
          ruleBuffer = line;
        } else {
          ruleBuffer += " " + line;
        }
        break;
        
      case STATE.IN_PROCEDURE_LIST:
        if (isRuleStart(line)) {
          const item = line
            .replace(/^[•·▪▸►◦○●\-–—*>]\s*/, "")
            .replace(/^\d{1,2}[.\)]\s*/, "")
            .trim();
          
          if (item.length > 3 && item.length < PROCEDURE_LIST_INDICATORS.maxItemLength) {
            if (PROCEDURE_LIST_INDICATORS.modalVerbs.test(item)) {
              emitProcedureList();
              ruleBuffer = line;
              state = STATE.BUILDING_RULE;
            } else {
              procedureListBuffer.push(item);
            }
          }
        } else if (detectSectionHeader(line)) {
          emitProcedureList();
          state = STATE.IN_SECTION;
        } else if (line.length > 100) {
          emitProcedureList();
          ruleBuffer = line;
          state = STATE.BUILDING_RULE;
        } else if (!isRuleStart(line) && line.length < PROCEDURE_LIST_INDICATORS.maxItemLength) {
          if (!PROCEDURE_LIST_INDICATORS.modalVerbs.test(line) && line.length > 3) {
            procedureListBuffer.push(line);
          }
        }
        break;
    }
    
    previousLine = line;
  }
  
  // Handle trailing fragment
  if (ruleBuffer && !/[.!?]\s*$/.test(ruleBuffer)) {
    meta.trailingFragment = ruleBuffer;
    log(`Trailing fragment: ${ruleBuffer.slice(0, 50)}...`);
  } else {
    emitRule();
  }
  
  emitProcedureList();
  
  return buildResults(dedupe, meta, startTime);
}

/**
 * Build final results object
 */
function buildResults(dedupe, meta, startTime) {
  const byCategory = dedupe.getByCategory();
  
  const results = {
    waiting_periods: [],
    financial_limits: [],
    exclusions: [],
    coverage: [],
    claim_rejection: [],
    _meta: {
      ...meta,
      processingTimeMs: Date.now() - startTime,
      stats: dedupe.getStats()
    }
  };
  
  for (const [category, rules] of Object.entries(byCategory)) {
    if (results[category]) {
      results[category] = rules.map(r => ({
        category: r.category,
        text: r.text,
        extractionMethod: r.extractionMethod,
        confidence: r.confidence,
        reason: r.reason
      }));
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 7: SERVER INTEGRATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Category mapping from rule engine to server's collected structure
 * FIXED: claim_rejection -> claim_rejection_conditions
 */
const SERVER_CATEGORY_MAP = {
  waiting_periods: "waiting_periods",
  financial_limits: "financial_limits",
  exclusions: "exclusions",
  coverage: "coverage",
  claim_rejection: "claim_rejection_conditions"  // <-- FIXED
};

/**
 * Route extracted rules to server's collected data structure
 */
function routeRuleResults(ruleResults, collected) {
  if (!ruleResults || !collected) return;
  
  for (const [ruleCat, serverCat] of Object.entries(SERVER_CATEGORY_MAP)) {
    const rules = ruleResults?.[ruleCat];
    if (!Array.isArray(rules)) continue;
    
    for (const item of rules) {
      const text = item?.text;
      if (!text || typeof text !== "string") continue;
      
      // Ensure target array exists
      if (!Array.isArray(collected[serverCat])) {
        collected[serverCat] = [];
      }
      
      // Avoid duplicates
      if (!collected[serverCat].includes(text)) {
        collected[serverCat].push(text);
      }
    }
  }
}

/**
 * Process multiple chunks with cross-chunk continuation
 */
function processChunksWithContinuation(chunks, options = {}) {
  if (!Array.isArray(chunks)) {
    return buildResults(new DeduplicationEngine(), {
      rulesMatched: 0,
      rulesApplied: ["state_machine_v5.2_multi_chunk"]
    }, Date.now());
  }
  
  const dedupe = new DeduplicationEngine(options.similarityThreshold || 0.92);
  let trailingFragment = null;
  
  const allMeta = {
    totalRulesMatched: 0,
    totalDuplicates: 0,
    chunksProcessed: 0,
    processingTimeMs: 0
  };
  
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "string") continue;
    
    const result = runRuleBasedExtraction(chunk, {
      ...options,
      prependFragment: trailingFragment
    });
    
    // Add rules to global dedupe
    for (const cat of VALID_CATEGORIES) {
      for (const rule of result[cat] || []) {
        dedupe.addRule(rule.text, rule.category, rule.confidence, {
          extractionMethod: rule.extractionMethod,
          reason: rule.reason
        });
      }
    }
    
    trailingFragment = result._meta?.trailingFragment || null;
    allMeta.totalRulesMatched += result._meta?.rulesMatched || 0;
    allMeta.totalDuplicates += result._meta?.duplicatesFound || 0;
    allMeta.chunksProcessed++;
    allMeta.processingTimeMs += result._meta?.processingTimeMs || 0;
  }
  
  return buildResults(dedupe, {
    ...allMeta,
    rulesMatched: dedupe.getStats().totalRules,
    rulesApplied: ["state_machine_v5.2_multi_chunk"]
  }, Date.now() - allMeta.processingTimeMs);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 8: EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Export patterns for external inspection/testing
 */
const RULE_PATTERNS = {
  SECTION_PATTERNS,
  CONTENT_SIGNALS,
  PROCEDURE_LIST_INDICATORS,
  GARBAGE_PATTERNS,
  VALID_CATEGORIES,
  SERVER_CATEGORY_MAP,
};

export {
  // Main functions
  runRuleBasedExtraction,
  routeRuleResults,
  processChunksWithContinuation,
  
  // Utilities (used by server.js for fuzzy dedup)
  createDedupeKey,
  calculateSimilarity,
  extractAnchorTokens,
  
  // For testing/debugging
  categorizeByContent,
  detectSectionHeader,
  normalizeText,
  isRuleStart,
  isContinuation,
  
  // Classes
  DeduplicationEngine,
  
  // Constants
  RULE_PATTERNS,
  VALID_CATEGORIES,
  SERVER_CATEGORY_MAP,
};