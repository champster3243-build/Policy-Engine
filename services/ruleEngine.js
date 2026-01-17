/*******************************************************************************************
 * ruleEngine.js (v3.1 - STABLE FAMILY REUNION)
 * =========================================================================================
 * PURPOSE: Extracts structured rules by reconstructing the "Parent-Child" hierarchy.
 * FIXES: Solved SyntaxError in regex replacements. Safe handling of special characters.
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: TEXT NORMALIZATION & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * CLEAN & FLATTEN TEXT
 * Prepares the raw PDF stream for hierarchical analysis.
 */
function normalizeTextStream(text) {
  if (!text) return "";
  
  return text
    // 1. Standardize newlines
    .replace(/\r\n/g, "\n")
    // 2. Fix hyphenated words across lines (e.g. "hos-\npital" -> "hospital")
    .replace(/([a-z])-\n([a-z])/ig, "$1$2") 
    // 3. Remove "Source" tags if present (e.g. )
    .replace(/\/g, "")
    // 4. Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DETECTS IF A LINE IS A "GROUP LEADER" (HEADER)
 * Returns true if the line implies a list is following.
 */
function isGroupLeader(line) {
  const l = line.toLowerCase().trim();
  if (l.length < 10) return false;
  
  const LEADER_TRIGGERS = [
    "following are excluded", 
    "expenses related to", 
    "treatment for the following", 
    "subject to the following", 
    "waiting period shall apply", 
    "limits as specified below",
    "sub-limits applicable",
    "not cover", 
    "payable only if"
  ];

  return l.endsWith(":") || LEADER_TRIGGERS.some(t => l.includes(t));
}

/**
 * DETECTS IF A LINE IS A "FAMILY MEMBER" (LIST ITEM)
 * Returns true if the line looks like a bullet point or continuation.
 */
function isFamilyMember(line) {
  const l = line.trim();
  // Starts with Bullet, Number, or Letter (e.g., "1.", "a)", ">", "-")
  // Regex safety: explicitly match common list markers
  return /^(\d+\.|[a-zA-Z]\)|\>|\-|•|vii\.|ix\.|iv\.)/.test(l);
}

/**
 * GARBAGE FILTER
 */
function isGarbage(text) {
  const t = text.toLowerCase();
  const BLOCKLIST = [
    "total rules", "page", "annexure", "list i", "list ii", "irda", "reg no", 
    "cin:", "uin:", "corporate office", "registered office", "sum insured", 
    "premium", "policy period", "schedule of benefits", "contents"
  ];
  if (t.length < 15) return true;
  if (BLOCKLIST.some(term => t.includes(term))) return true;
  return /^[\d\W]+$/.test(t); // Returns true if text is only numbers/symbols
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: THE PATTERN LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════════════

const RULE_PATTERNS = {
  
  // ═══ WAITING PERIODS ═══
  waiting_periods: [
    {
      name: "explicit_waiting",
      pattern: /(\d+)\s*(?:months?|years?|days?)/i,
      validate: (text) => /waiting period|exclusion|after continuous|prior to/i.test(text),
      confidence: 0.99
    },
    {
      name: "disease_waiting",
      pattern: /(maternity|cataract|hernia|hysterectomy|joint replacement|ped|pre-existing).*?(\d+)\s*(months?|years?)/i,
      validate: () => true,
      confidence: 0.98
    }
  ],

  // ═══ FINANCIAL LIMITS ═══
  financial_limits: [
    {
      name: "monetary_limit",
      // Catches "Rs. 5000", "₹ 5000"
      pattern: /(?:rs\.?|₹|inr)\s*([\d,]+)/i,
      validate: (text) => 
        !/sum insured|premium|total|deductible/i.test(text) && 
        /limit|capped|upto|maximum|sub-limit|restricted|co-pay/i.test(text),
      confidence: 0.95
    },
    {
      name: "percentage_limit",
      // Catches "20%"
      pattern: /(\d+)\s*%/i,
      validate: (text) => 
        !/health score|average|total|rate/i.test(text) && 
        /co-pay|limit|capped|upto|claim|payable/i.test(text),
      confidence: 0.95
    }
  ],

  // ═══ EXCLUSIONS ═══
  exclusions: [
    {
      name: "exclusion_keyword",
      pattern: /(excluded|not covered|not payable|not admissible)/i,
      validate: (text) => text.length > 20 && !/claim arising/i.test(text),
      confidence: 0.92
    },
    {
      name: "hard_exclusion_terms",
      pattern: /(war|terrorism|nuclear|cosmetic|obesity|infertility|hazardous sports|breach of law|alcohol|drug abuse)/i,
      validate: (text) => /excluded|not covered/i.test(text),
      confidence: 0.98
    }
  ],

  // ═══ CLAIM REJECTION ═══
  claim_rejection: [
    {
      name: "timeline_rejection",
      pattern: /(?:within|in)\s*(\d+)\s*(hours?|days?)/i,
      validate: (text) => /notify|intimate|submit|claim form|documents/i.test(text),
      confidence: 0.95
    }
  ]
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: THE FAMILY REUNION ALGORITHM (CORE LOGIC)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * RECONSTRUCTS SENTENCES FROM HIERARCHY
 * Turns the raw stream into a list of "Context-Complete" sentences.
 */
function reconstructHierarchy(rawText) {
  // Split by newline but keep integrity
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const sentences = [];
  
  let currentLeader = ""; // The "Group Leader" (Active Context)
  let buffer = "";        // For stitching broken lines

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. IS IT A NEW LEADER?
    if (isGroupLeader(line)) {
      currentLeader = line.replace(/[:;]$/, ""); // Store leader without colon
      buffer = ""; // Clear buffer
      continue;
    }

    // 2. IS IT A FAMILY MEMBER? (List Item)
    if (currentLeader && isFamilyMember(line)) {
      // Merge Leader + Member
      const combined = `${currentLeader} ${line}`.replace(/[>•\-]/g, "").trim();
      sentences.push(combined);
      continue;
    }

    // 3. IS IT A STOPPER? (New Section)
    if (/section|part \w|definitions/i.test(line) && line.length < 30) {
      currentLeader = ""; // Reset context
    }

    // 4. STANDARD LINE
    if (/[.:;]$/.test(line)) {
      sentences.push(buffer + " " + line);
      buffer = "";
    } else {
      buffer += " " + line;
    }
  }
  
  return sentences;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: EXECUTION & DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * FUZZY SIMILARITY (DEDUPLICATION)
 */
function isSimilar(str1, str2) {
  // Safe alphanumeric normalization
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (s1.includes(s2) || s2.includes(s1)) return true;
  
  // Jaccard Token Logic
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return (intersection.size / union.size) > 0.70;
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

  const text = normalizeTextStream(rawText);
  if (text.length < 50) return results;

  // STEP 1: RECONSTRUCT HIERARCHY
  const reconstructedSentences = reconstructHierarchy(text);
  
  // STEP 2: ALSO USE RAW STREAM (For inline rules)
  // Split by common sentence delimiters, safely escaped
  const rawSentences = text.split(/[.:;]/); 
  
  const allCandidates = [...reconstructedSentences, ...rawSentences];
  const seenRules = [];

  // STEP 3: APPLY PATTERNS
  for (const sentence of allCandidates) {
    if (isGarbage(sentence)) continue;

    for (const [category, patterns] of Object.entries(RULE_PATTERNS)) {
      for (const rule of patterns) {
        const match = sentence.match(rule.pattern);
        
        if (match) {
          // Validate logic (Context Check)
          if (!rule.validate(sentence)) continue;

          // Clean Rule Text (Safe regex)
          let cleanRule = sentence
            .replace(/[>•\-]/g, "")
            .replace(/\s+/g, " ")
            .trim();

          // Deduplication
          if (seenRules.some(existing => isSimilar(existing, cleanRule))) continue;

          seenRules.push(cleanRule);
          
          if (results[category]) {
            results[category].push({ 
              category: category,
              text: cleanRule, 
              ruleName: rule.name, 
              extractionMethod: 'rule_based_family_reunion',
              confidence: rule.confidence
            });
            results._meta.rulesMatched++;
            if (!results._meta.rulesApplied.includes(rule.name)) results._meta.rulesApplied.push(rule.name);
          }
          break; 
        }
      }
    }
  }

  results._meta.processingTimeMs = Date.now() - startTime;
  return results;
}

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
        const isDup = collected[serverCategory].some(existing => isSimilar(existing, item.text));
        if (!isDup) {
          collected[serverCategory].push(item.text);
        }
      }
    }
  }
}

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };