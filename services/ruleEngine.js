/*******************************************************************************************
 * ruleEngine.js (v2.0 - ELASTIC ANCHOR ALGORITHM)
 * =========================================================================================
 * * PURPOSE: 
 * Extracts structured insurance rules with high precision by treating text as a 
 * spatial stream rather than just strings.
 * * * KEY INNOVATIONS:
 * 1. PRE-PROCESSOR: Flattens PDF "visual formatting" (newlines, hyphenation) into logical streams.
 * 2. ELASTIC ANCHORING: Finds a value (e.g. "5000") and expands left/right to find context.
 * 3. SEMANTIC BOUNDARIES: Uses logic to stop expanding when it hits a new rule (bullets, periods).
 * 4. FUZZY DEDUPLICATION: Prevents "Room Rent: 5000" and "Room Rent capped at 5000" duplicates.
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: TEXT NORMALIZATION & PRE-PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * CLEAN & FLATTEN TEXT
 * Removes PDF artifacts like random newlines, hyphenated words at line breaks,
 * and weird spacing. This creates a "Logical Stream" for the engine.
 */
function normalizeTextStream(text) {
  if (!text) return "";
  
  return text
    .replace(/\r\n/g, "\n")
    // Fix hyphenated words across lines (e.g. "hos-\npital" -> "hospital")
    .replace(/([a-z])-\n([a-z])/ig, "$1$2") 
    // Turn newlines into spaces to allow regex to match across lines
    .replace(/\n+/g, " ") 
    // Collapse multiple spaces
    .replace(/\s+/g, " ") 
    .trim();
}

/**
 * GARBAGE FILTER
 * Returns TRUE if the text is likely administrative noise (headers, footers, lists).
 */
function isGarbage(text) {
  const t = text.toLowerCase();
  
  // Blocklist of administrative terms that confuse the engine
  const BLOCKLIST = [
    "total rules", "page", "annexure", "list i", "list ii", "list iii", 
    "irda", "reg no", "cin:", "uin:", "corporate office", "registered office",
    "sum insured", "premium", "deductible", "cumulative bonus", 
    "policy period", "date of inception", "schedule of benefits", "total rules"
  ];

  if (t.length < 15) return true; // Too short to be a meaningful rule
  if (BLOCKLIST.some(term => t.includes(term))) return true;
  if (/^[\d\W]+$/.test(t)) return true; // Only numbers/symbols
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: THE ELASTIC EXPANSION LOGIC (THE BRAIN)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * EXPAND CONTEXT AROUND ANCHOR
 * Walks backwards and forwards from a match to build a complete sentence.
 * * @param {string} fullText - The normalized text stream
 * @param {object} match - The regex match object
 * @param {number} leftChars - Max characters to look back (Subject Search)
 * @param {number} rightChars - Max characters to look forward (Condition Search)
 */
function elasticExpand(fullText, match, leftChars = 120, rightChars = 120) {
  const startIdx = match.index;
  const endIdx = startIdx + match[0].length;

  // 1. EXPAND LEFT (Find the Subject)
  // Look back X chars, but stop at major punctuation (. : ;) or Bullet points
  let leftContext = fullText.slice(Math.max(0, startIdx - leftChars), startIdx);
  
  // Find the last "Sentence Breaker" to ensure we don't bleed into the previous rule.
  // Breakers: Period, Colon, Semicolon, Bullet (•, -, >), or Numbered List (1.)
  const leftBreakerRegex = /[.:;!?•\->]|\d+\.\s/; 
  
  // Search for the *last* breaker in the left chunk
  // We reverse the string to find the "closest" breaker moving backwards
  const reversedLeft = leftContext.split("").reverse().join("");
  const firstBreakerIndex = reversedLeft.search(leftBreakerRegex);
  
  if (firstBreakerIndex !== -1) {
    // Cut off everything before the breaker
    const cutIndex = leftContext.length - firstBreakerIndex;
    leftContext = leftContext.slice(cutIndex); 
  }
  
  // 2. EXPAND RIGHT (Find the Condition)
  // Look forward X chars, but stop at next sentence end
  let rightContext = fullText.slice(endIdx, Math.min(fullText.length, endIdx + rightChars));
  const rightBreaker = rightContext.search(/[.:;!?•\->]|\d+\.\s/);
  
  if (rightBreaker !== -1) {
    rightContext = rightContext.slice(0, rightBreaker); // Take everything up to the breaker
  }

  // 3. ASSEMBLE
  let completeRule = (leftContext + match[0] + rightContext).trim();
  
  // 4. CLEANUP (Remove leading non-alphanumeric chars left by split)
  completeRule = completeRule.replace(/^[^a-zA-Z0-9"(]+/, "");

  return completeRule;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: PATTERN LIBRARY (ANCHOR-BASED)
// ═══════════════════════════════════════════════════════════════════════════════════════

const RULE_PATTERNS = {
  
  // ═══ WAITING PERIODS ═══
  waiting_periods: [
    {
      name: "anchor_waiting_period",
      // Anchor: "24 months" or "2 years"
      pattern: /(\d+)\s*(?:months?|years?|days?)/gi,
      extract: (match, fullText) => {
        // Use Elastic Expand to find "Maternity" before "9 months"
        const rule = elasticExpand(fullText, match, 100, 60);
        
        // Strict Validation: Must look like a waiting period rule
        if (!/waiting period|exclusion|after continuous|prior to|before coverage/i.test(rule)) return null;
        
        return {
          category: "waiting_period",
          text: rule,
          confidence: 0.99
        };
      }
    },
    {
      name: "specific_disease_anchor",
      // Anchor: List of diseases followed by time
      pattern: /(maternity|cataract|hernia|hysterectomy|joint replacement|bariatric|ped|pre-existing)[^.:]*?(\d+)\s*(months?|years?)/gi,
      extract: (match, fullText) => {
        const rule = elasticExpand(fullText, match, 30, 50);
        return {
          category: "waiting_period",
          text: rule,
          confidence: 0.99
        };
      }
    }
  ],

  // ═══ FINANCIAL LIMITS ═══
  financial_limits: [
    {
      name: "anchor_monetary_limit",
      // Anchor: "Rs. 5000" or "₹ 5000"
      pattern: /(?:rs\.?|₹|inr)\s*([\d,]+)/gi,
      extract: (match, fullText) => {
        const rule = elasticExpand(fullText, match, 120, 80);
        
        // NOISE FILTER: Ignore if it's "Sum Insured" or "Premium"
        if (/sum insured|premium|total|deductible|balance/i.test(rule)) return null;
        
        // VALIDATION: Must imply a limit
        if (!/limit|capped|upto|maximum|sub-limit|restricted to|co-pay|subject to/i.test(rule)) return null;

        return {
          category: "financial_limit",
          text: rule,
          confidence: 0.95
        };
      }
    },
    {
      name: "anchor_percentage_limit",
      // Anchor: "20%" or "50 %"
      pattern: /(\d+)\s*%/gi,
      extract: (match, fullText) => {
        const rule = elasticExpand(fullText, match, 120, 80);
        
        // NOISE FILTER
        if (/health score|average|total|sum insured|rate/i.test(rule)) return null;
        
        // VALIDATION: Look for limit keywords
        if (!/co-pay|limit|capped|upto|of sum insured|claim|payable/i.test(rule)) return null;

        return {
          category: "financial_limit",
          text: rule,
          confidence: 0.95
        };
      }
    }
  ],

  // ═══ EXCLUSIONS ═══
  exclusions: [
    {
      name: "anchor_exclusion_phrase",
      // Anchor: "is excluded", "not covered"
      pattern: /(?:is|are|shall be)\s+(?:specifically\s+)?(excluded|not covered|not payable|not admissible)/gi,
      extract: (match, fullText) => {
        // Look FAR back (150 chars) because "Subject ... long description ... is excluded"
        const rule = elasticExpand(fullText, match, 150, 30); 
        
        // NOISE FILTER: Don't capture generic "claims are excluded" without a subject
        if (/claim arising|expenses related to/i.test(rule) && rule.length < 30) return null;

        return {
          category: "exclusion",
          text: rule,
          confidence: 0.92
        };
      }
    },
    {
      name: "anchor_specific_exclusion",
      // Anchor: Robust keywords that are ALWAYS exclusions
      pattern: /(war|terrorism|nuclear|cosmetic|obesity|infertility|hazardous sports|breach of law|alcohol|drug abuse)/gi,
      extract: (match, fullText) => {
        const rule = elasticExpand(fullText, match, 60, 100);
        
        // Validate it's an exclusion statement
        if (!/excluded|not covered|not payable|not admissible/i.test(rule)) return null;

        return {
          category: "exclusion",
          text: rule,
          confidence: 0.98
        };
      }
    }
  ],

  // ═══ CLAIM REJECTION ═══
  claim_rejection: [
    {
      name: "anchor_timeline",
      // Anchor: "24 hours", "15 days"
      pattern: /(\d+)\s*(hours?|days?)/gi,
      extract: (match, fullText) => {
        const rule = elasticExpand(fullText, match, 100, 60);
        
        // Only capture if related to notification/submission
        if (!/notify|intimate|submit|claim form|documents|report/i.test(rule)) return null;

        return {
          category: "claim_rejection",
          text: rule,
          confidence: 0.95
        };
      }
    }
  ]
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: CORE EXECUTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * FUZZY SIMILARITY CHECK (Jaccard Index)
 * Returns true if strings are >75% similar.
 * Solves: "Room rent 5000" vs "Room rent limit 5000"
 */
function isSimilar(str1, str2) {
  // Normalize: lowercase, remove non-alphanumeric
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // Optimization: Check substring inclusion first
  if (s1.includes(s2) || s2.includes(s1)) return true;
  
  // Jaccard Token Logic (Set Overlap)
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return (intersection.size / union.size) > 0.75;
}

/**
 * MAIN EXTRACTION FUNCTION
 */
function runRuleBasedExtraction(rawText) {
  const startTime = Date.now();
  const results = {
    waiting_periods: [], financial_limits: [], exclusions: [],
    coverage: [], claim_rejection: [],
    _meta: { rulesMatched: 0, rulesApplied: [], processingTimeMs: 0 }
  };

  // 1. NORMALIZE TEXT STREAM
  const text = normalizeTextStream(rawText);
  if (text.length < 50) return results;

  const seenRules = [];

  // 2. RUN PATTERNS
  for (const [category, patterns] of Object.entries(RULE_PATTERNS)) {
    for (const rule of patterns) {
      rule.pattern.lastIndex = 0;
      let match;
      let matchCount = 0;
      
      // Limit matches per rule to prevent infinite loops on bad regex
      while ((match = rule.pattern.exec(text)) !== null && matchCount < 10) {
        matchCount++;
        try {
          const extracted = rule.extract(match, text);
          
          // 3. GATEKEEPING
          if (!extracted || !extracted.text) continue;
          if (isGarbage(extracted.text)) continue;
          
          // 4. DEDUPLICATION
          if (seenRules.some(existing => isSimilar(existing, extracted.text))) continue;
          
          // Accept Rule
          seenRules.push(extracted.text);
          if (results[category]) {
            results[category].push({ 
              ...extracted, 
              ruleName: rule.name, 
              extractionMethod: 'rule_based_elastic' 
            });
            results._meta.rulesMatched++;
            if (!results._meta.rulesApplied.includes(rule.name)) results._meta.rulesApplied.push(rule.name);
          }
        } catch (err) { console.warn(`Error in rule ${rule.name}:`, err.message); }
      }
    }
  }
  results._meta.processingTimeMs = Date.now() - startTime;
  return results;
}

/**
 * ROUTER: CONNECTS ENGINE TO SERVER
 */
function routeRuleResults(ruleResults, collected) {
  const categoryMap = {
    'waiting_periods': 'waiting_periods',
    'financial_limits': 'financial_limits',
    'exclusions': 'exclusions',
    'coverage': 'coverage',
    'claim_rejection': 'claim_rejection_conditions'
  };

  for (const [ruleCategory, serverCategory] of Object.entries(categoryMap)) {
    const items = ruleResults[ruleCategory] || [];
    for (const item of items) {
      if (collected[serverCategory] && item.text) {
        // Double check dedup against existing collection
        const isDup = collected[serverCategory].some(existing => isSimilar(existing, item.text));
        if (!isDup) {
          collected[serverCategory].push(item.text);
        }
      }
    }
  }
}

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };