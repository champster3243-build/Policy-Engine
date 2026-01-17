/*******************************************************************************************
 * ruleEngine.js (v5.1 - PRODUCTION-HARDENED)
 * 
 * Key fixes from v5.0:
 * - Safer OCR normalization (no destructive character replacements)
 * - Higher similarity threshold (0.92 default)
 * - Stronger categorization requirements (needs strong signal to override section)
 * - Candidate filtering for O(1) average dedupe lookups
 * - Cross-chunk continuation support via trailingFragment
 * - Better rule boundary detection
 * - Removed over-aggressive garbage blockers
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

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
 * Strong signals can override section context
 * Weak signals only contribute when combined with section context
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
 * Procedure list indicators - these signal enumeration rather than rules
 */
const PROCEDURE_LIST_INDICATORS = {
  headerPatterns: [
    /(?:list\s*of\s*)?(?:covered\s*)?(?:surgeries|procedures|treatments|diseases|ailments)/i,
    /following\s*(?:are|is)\s*(?:covered|included)\s*:/i,
    /coverage\s*(?:includes?|for)\s*:/i,
  ],
  // A "list zone" has many short items without modal verbs
  modalVerbs: /\b(?:shall|will|must|should|may|can|cannot|not)\b/i,
  maxItemLength: 80,
  minItemsForList: 4,
};

/**
 * Garbage patterns - content to completely ignore
 * NOTE: Be conservative here - false positives lose real rules
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

function normalizeText(text) {
  if (!text) return "";
  
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/([a-z])-\n([a-z])/gi, "$1$2")  // Fix hyphenated line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/—|–/g, "-")
    .trim();
}

/**
 * Create dedupe key - CONSERVATIVE normalization
 * No aggressive character substitution that destroys words
 */
function createDedupeKey(text) {
  if (!text) return "";
  
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Remove punctuation but keep word boundaries
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    // Only remove very short words (articles, etc)
    .split(" ")
    .filter(w => w.length > 2)
    .join(" ")
    .trim();
}

/**
 * Extract "anchor tokens" for candidate filtering
 * These are longer, less common tokens that help narrow similarity searches
 */
function extractAnchorTokens(text, count = 3) {
  const key = createDedupeKey(text);
  const tokens = key.split(" ");
  
  // Sort by length descending, take longest tokens
  return tokens
    .filter(t => t.length > 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, count);
}

/**
 * Calculate Jaccard similarity between two strings
 */
function calculateSimilarity(str1, str2) {
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

function detectSectionHeader(line) {
  const clean = String(line || "").trim();
  if (clean.length < 3 || clean.length > 60) return null;
  
  // Headers are typically short and may be uppercase or title case
  const looksLikeHeader = 
    /^[A-Z\s]+$/.test(clean) ||
    /^[A-Z]/.test(clean) && clean.length < 40 ||
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

function isRuleStart(line) {
  const l = String(line || "").trim();
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
 * Improved continuation detection with hard boundaries
 */
function isContinuation(line, previousLine, ruleBuffer) {
  const l = String(line || "").trim();
  const prev = String(previousLine || "").trim();
  
  if (!l || !prev) return false;
  
  // HARD BOUNDARIES - never continue across these
  // Previous line ends with terminal punctuation AND next line is a new rule start
  if (/[.!?]\s*$/.test(prev) && isRuleStart(l)) return false;
  
  // Next line looks like a header
  if (detectSectionHeader(l)) return false;
  
  // SOFT CONTINUATION SIGNALS
  // Line starts with lowercase = likely continuation
  if (/^[a-z]/.test(l)) return true;
  
  // Previous line ends with conjunction or incomplete phrase
  if (/(?:and|or|but|that|which|where|when|if|unless|provided|including|excluding|such\s+as|,)\s*$/i.test(prev)) {
    return true;
  }
  
  // Previous line ends mid-sentence
  if (!/[.!?:;]\s*$/.test(prev) && prev.length > 15) {
    return true;
  }
  
  return false;
}

/**
 * Check if we're likely in a procedure list zone
 * Returns { inList: boolean, confidence: number }
 */
function detectProcedureListZone(lines, startIndex) {
  // Look ahead for list-like patterns
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
  
  // High density of short items without modal verbs = likely a list
  const density = shortItemCount / checkCount;
  const noModalRatio = itemsWithoutModals / Math.max(shortItemCount, 1);
  
  const isLikelyList = density > 0.7 && noModalRatio > 0.6 && shortItemCount >= PROCEDURE_LIST_INDICATORS.minItemsForList;
  
  return {
    inList: isLikelyList,
    confidence: density * noModalRatio
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: CONTENT-AWARE CATEGORIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Categorize content with STRICT requirements for overriding section context
 * 
 * Rules:
 * - To STAY in section: weak signals + section context is enough
 * - To OVERRIDE section: must have at least 1 strong signal
 */
function categorizeByContent(text, sectionContext = null) {
  const cleanText = String(text || "").trim();
  if (!cleanText || cleanText.length < 10) return null;
  
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
    
    // Score calculation:
    // - Strong signal: 10 points each
    // - Weak signal: 3 points each
    // - Section context match: 5 points
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
  
  // STRICT OVERRIDE RULE:
  // If best category differs from section context, require at least 1 strong signal
  if (bestCategory && bestCategory !== sectionContext && sectionContext) {
    if (bestDetails.strongCount === 0) {
      // Not strong enough to override - fall back to section context
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
  
  // Minimum threshold: score >= 5
  if (bestScore < 5) {
    // Last resort: use section context if available
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
// SECTION 5: DEDUPLICATION ENGINE WITH CANDIDATE FILTERING
// ═══════════════════════════════════════════════════════════════════════════════════════════

class DeduplicationEngine {
  constructor(similarityThreshold = 0.92) {
    this.threshold = similarityThreshold;
    this.rules = [];
    this.exactKeyIndex = new Map();      // key -> rule
    this.anchorIndex = new Map();        // anchor token -> Set of rule indices
  }
  
  /**
   * Add a rule with O(1) average lookup using anchor-based candidate filtering
   */
  addRule(text, category, confidence, metadata = {}) {
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
    
    // Get candidate rules using anchor tokens (much faster than checking all)
    const anchors = extractAnchorTokens(text);
    const candidateIndices = new Set();
    
    for (const anchor of anchors) {
      const indices = this.anchorIndex.get(anchor);
      if (indices) {
        for (const idx of indices) candidateIndices.add(idx);
      }
    }
    
    // Check similarity only against candidates
    for (const idx of candidateIndices) {
      const existing = this.rules[idx];
      if (!existing) continue;
      
      const similarity = calculateSimilarity(text, existing.text);
      if (similarity >= this.threshold) {
        // Keep longer version if similar confidence
        if (confidence >= existing.confidence - 0.1 && text.length > existing.text.length * 1.2) {
          // Update existing rule
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
    return {
      totalRules: this.rules.length,
      byCategory: Object.fromEntries(
        Object.entries(this.getByCategory()).map(([k, v]) => [k, v.length])
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

function runRuleBasedExtraction(rawText, options = {}) {
  const startTime = Date.now();
  const {
    similarityThreshold = 0.92,  // Higher default - more conservative
    minRuleLength = 15,
    maxRuleLength = 2000,
    prependFragment = null,      // Cross-chunk continuation support
    debug = false
  } = options;
  
  let text = normalizeText(rawText);
  
  // Prepend trailing fragment from previous chunk
  if (prependFragment && typeof prependFragment === "string") {
    text = prependFragment + " " + text;
  }
  
  const dedupe = new DeduplicationEngine(similarityThreshold);
  
  const meta = {
    rulesMatched: 0,
    rulesRejected: 0,
    duplicatesFound: 0,
    processingTimeMs: 0,
    rulesApplied: ["state_machine_v5.1"],
    sectionTransitions: [],
    trailingFragment: null,  // For cross-chunk continuation
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
        extractionMethod: "state_machine_v5.1",
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
      // Not enough items - treat them as individual rules instead
      for (const item of procedureListBuffer) {
        ruleBuffer = item;
        emitRule("coverage");
      }
      procedureListBuffer = [];
      procedureListHeader = "";
      return;
    }
    
    // Group into a single coverage entry
    const header = procedureListHeader || "Coverage includes";
    const combinedText = `${header}: ${procedureListBuffer.join("; ")}`;
    
    const result = dedupe.addRule(
      combinedText,
      "coverage",
      0.7,
      {
        reason: "procedure_list_grouped",
        extractionMethod: "state_machine_v5.1",
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
      // Paragraph break may signal rule end
      if (state === STATE.BUILDING_RULE && ruleBuffer.length > 50) {
        // Only emit if buffer ends with terminal punctuation
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
      
      // Check if following lines form a list
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
        } else if (isContinuation(line, previousLine, ruleBuffer) && ruleBuffer) {
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
        } else if (isContinuation(line, previousLine, ruleBuffer)) {
          ruleBuffer += " " + line;
        } else if (/^[A-Z]/.test(line) && /[.!?]\s*$/.test(ruleBuffer) && line.length > 20) {
          // New sentence starting, previous complete - emit and start new
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
            // Check if item looks like a rule (has modal verbs) - if so, emit list and switch
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
          // Long line = probably end of list
          emitProcedureList();
          ruleBuffer = line;
          state = STATE.BUILDING_RULE;
        } else if (!isRuleStart(line) && line.length < PROCEDURE_LIST_INDICATORS.maxItemLength) {
          // Non-bulleted short item in list zone
          if (!PROCEDURE_LIST_INDICATORS.modalVerbs.test(line) && line.length > 3) {
            procedureListBuffer.push(line);
          }
        }
        break;
    }
    
    previousLine = line;
  }
  
  // Handle trailing fragment for cross-chunk continuation
  if (ruleBuffer && !/[.!?]\s*$/.test(ruleBuffer)) {
    // Buffer doesn't end with terminal punctuation - might continue in next chunk
    meta.trailingFragment = ruleBuffer;
    log(`Trailing fragment: ${ruleBuffer.slice(0, 50)}...`);
  } else {
    emitRule();
  }
  
  emitProcedureList();
  
  return buildResults(dedupe, meta, startTime);
}

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
// SECTION 7: SERVER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

function routeRuleResults(ruleResults, collected) {
  if (!ruleResults || !collected) return;
  
  const categoryMap = {
    waiting_periods: "waiting_periods",
    financial_limits: "financial_limits",
    exclusions: "exclusions",
    coverage: "coverage",
    claim_rejection: "claim_rejection_conditions"
  };
  
  for (const [ruleCat, serverCat] of Object.entries(categoryMap)) {
    const rules = ruleResults?.[ruleCat];
    if (!Array.isArray(rules)) continue;
    
    for (const item of rules) {
      const text = item?.text;
      if (!text || typeof text !== "string") continue;
      
      if (!Array.isArray(collected[serverCat])) {
        collected[serverCat] = [];
      }
      
      if (!collected[serverCat].includes(text)) {
        collected[serverCat].push(text);
      }
    }
  }
}

/**
 * Process multiple chunks with cross-chunk continuation
 * This is the recommended way to process chunked PDFs
 */
function processChunksWithContinuation(chunks, options = {}) {
  const dedupe = new DeduplicationEngine(options.similarityThreshold || 0.92);
  let trailingFragment = null;
  
  const allMeta = {
    totalRulesMatched: 0,
    totalDuplicates: 0,
    chunksProcessed: 0,
    processingTimeMs: 0
  };
  
  for (const chunk of chunks) {
    const result = runRuleBasedExtraction(chunk, {
      ...options,
      prependFragment: trailingFragment
    });
    
    // Add rules to global dedupe
    const categories = ["waiting_periods", "financial_limits", "exclusions", "coverage", "claim_rejection"];
    for (const cat of categories) {
      for (const rule of result[cat] || []) {
        dedupe.addRule(rule.text, rule.category, rule.confidence, {
          extractionMethod: rule.extractionMethod,
          reason: rule.reason
        });
      }
    }
    
    trailingFragment = result._meta.trailingFragment;
    allMeta.totalRulesMatched += result._meta.rulesMatched;
    allMeta.totalDuplicates += result._meta.duplicatesFound;
    allMeta.chunksProcessed++;
    allMeta.processingTimeMs += result._meta.processingTimeMs;
  }
  
  return buildResults(dedupe, {
    ...allMeta,
    rulesMatched: dedupe.getStats().totalRules,
    rulesApplied: ["state_machine_v5.1_multi_chunk"]
  }, Date.now() - allMeta.processingTimeMs);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SECTION 8: EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════════════

const RULE_PATTERNS = {
  SECTION_PATTERNS,
  CONTENT_SIGNALS,
  PROCEDURE_LIST_INDICATORS,
  GARBAGE_PATTERNS
};

export {
  runRuleBasedExtraction,
  routeRuleResults,
  processChunksWithContinuation,
  RULE_PATTERNS,
  // Utilities for testing
  createDedupeKey,
  calculateSimilarity,
  categorizeByContent,
  detectSectionHeader,
  DeduplicationEngine
};