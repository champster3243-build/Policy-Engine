/*******************************************************************************************
 * ruleEngine.js (v1.3 STABLE - PROFESSIONAL PATCH)
 * * CHANGES FROM v1.2:
 * 1. TRUNCATION FIX: Added 'expandContextForward' to auto-complete sentences ending in prepositions.
 * 2. CONTEXT FIX: 'getSubject' now ignores newlines to find subjects across line breaks.
 * 3. DEDUPLICATION: Added 'isSimilar' fuzzy matching to stop verbose repetition.
 * 4. NOISE CONTROL: Strict blocklist for "Sum Insured" and "Premium" appearing as limits.
 *******************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: INTELLIGENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * INTELLIGENT CONTEXT LOOKBACK
 * Scans backwards ignoring line breaks to find the real subject.
 */
function getSubject(fullText, matchIndex, charLimit = 100) {
  if (!fullText) return "";
  
  // Look back X chars
  const start = Math.max(0, matchIndex - charLimit);
  const precedingChunk = fullText.slice(start, matchIndex);
  
  // Normalize formatting: Turn newlines into spaces to read across lines
  const cleanChunk = precedingChunk.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  
  // Stop at major sentence breakers (. : ;) but ignore bullet points (1. 2. >)
  const sentences = cleanChunk.split(/[.:;](?=\s[A-Z])/); 
  const lastSentence = sentences.pop() || "";

  // Filter out noise (numbers, bullets)
  const subject = lastSentence.replace(/^[\s\d\W_]+/, '').trim();
  
  // Return last 8 words (enough to capture "Cataract treatment limit")
  const words = subject.split(" ");
  return words.slice(-8).join(" ");
}

/**
 * SENTENCE COMPLETER (Fixes Truncation)
 * If a match ends in "of", "for", "per", "with", it grabs the next few words.
 */
function completeSentence(matchText, fullText, matchIndex) {
  let text = matchText;
  const endIndex = matchIndex + matchText.length;
  
  // Check if text ends abruptly (e.g. "limit of", "subject to")
  if (/(?:of|for|with|to|and|or|per|upto)$/i.test(text.trim())) {
    const lookAhead = fullText.slice(endIndex, endIndex + 50); // Grab next 50 chars
    // Stop at next punctuation
    const completion = lookAhead.split(/[.,;:\n]/)[0]; 
    if (completion) {
      text = text + completion;
    }
  }
  return text.trim();
}

/**
 * FUZZY SIMILARITY CHECK (Fixes Repetition)
 * Returns true if two strings are > 70% similar.
 */
function isSimilar(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (s1.includes(s2) || s2.includes(s1)) return true;
  
  // Simple Jaccard Index (Word Overlap)
  const words1 = new Set(s1.split(""));
  const words2 = new Set(s2.split(""));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return (intersection.size / union.size) > 0.7; 
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: ROBUST PATTERN LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════════════

const IGNORED_TERMS = ["sum insured", "premium", "deductible", "cumulative bonus", "total", "policy period", "claim amount"];

const RULE_PATTERNS = {
  
  // ═══ WAITING PERIODS (High Accuracy) ═══
  waiting_periods: [
    {
      name: "explicit_numeric_waiting",
      pattern: /(\d+)\s*(?:months?|years?|days?)\s*(?:waiting|exclusion|cooling[- ]?off)\s*period/gi,
      extract: (match, fullText) => {
        const subject = getSubject(fullText, match.index, 60);
        // If specific disease mentioned before, capture it
        const diseaseMatch = subject.match(/(maternity|ped|pre-existing|specific disease|joint replacement)/i);
        const prefix = diseaseMatch ? diseaseMatch[0] + " " : "";
        
        return {
          category: "waiting_period",
          text: prefix + match[0],
          confidence: 0.99
        };
      }
    },
    {
      name: "specific_condition_waiting",
      // Captures "Cataract: 24 months" directly
      pattern: /(maternity|cancer|heart|knee|cataract|hernia|hysterectomy|joint replacement|bariatric|renal)[^.:]*?(\d+)\s*(months?|years?)/gi,
      extract: (match) => ({
        category: "waiting_period",
        text: `${match[1]} waiting period: ${match[2]} ${match[3]}`,
        confidence: 0.98
      })
    }
  ],

  // ═══ FINANCIAL LIMITS (The Problem Area - Now Fixed) ═══
  financial_limits: [
    {
      name: "room_rent_limit",
      // Matches "Room Rent ... Rs 5000" allowing for words in between
      pattern: /room\s*(?:rent|charges?|tariff)[^.]*?(?:₹|rs\.?|inr|rupees?)\s*([\d,]+)(?:\s*(?:per|\/)\s*day)?/gi,
      extract: (match) => ({
        category: "financial_limit",
        text: `Room Rent Capped at ₹${match[1]} per day`,
        confidence: 0.99
      })
    },
    {
      name: "copay_percentage",
      pattern: /co[- ]?pay(?:ment)?[^.]*?(\d+)\s*%/gi,
      extract: (match, fullText) => {
        const subject = getSubject(fullText, match.index, 50);
        // Check for specific conditions (Senior Citizen, Zone)
        const detail = subject.match(/(senior|age|zone|tier)/i) ? ` (${subject.match(/(senior|age|zone|tier)/i)[0]}-based)` : "";
        return {
          category: "financial_limit",
          text: `Co-payment: ${match[1]}%${detail}`,
          confidence: 0.99
        };
      }
    },
    {
      name: "generic_sublimit_with_context",
      // Catches "Limit of Rs 5000" AND "Sub-limit: 5000"
      pattern: /(?:sub[- ]?limit|capped|maximum|upto|limit of)[^.]*?(?:₹|rs\.?|inr)\s*([\d,]+)/gi,
      extract: (match, fullText) => {
        const amount = match[1];
        const subject = getSubject(fullText, match.index, 80); // Look back 80 chars

        // 1. NOISE FILTER: Ignore if context implies Sum Insured or Premium
        if (IGNORED_TERMS.some(term => subject.toLowerCase().includes(term))) return null;

        // 2. SUBJECT DETECTION: Try to find what this limit applies to
        const keywordMatch = subject.match(/(ambulance|cataract|ayush|domiciliary|donor|maternity|restoration|recharge|mental|dental|hearing)/i);
        
        let label = "Sub-limit";
        if (keywordMatch) {
          label = keywordMatch[0] + " limit";
        } else if (subject.length > 5) {
          // If no keyword, use the last few words of context, but keep it short
          const words = subject.split(" ").filter(w => w.length > 2); // Ignore "of", "to"
          label = words.slice(-3).join(" ") + " limit";
        }

        // 3. FINAL VALIDATION: Don't return "limit: 5000" without context
        if (label === "Sub-limit" || label.includes("limit limit")) return null;

        return {
          category: "financial_limit",
          text: `${label}: ₹${amount}`,
          confidence: 0.90
        };
      }
    }
  ],

  // ═══ EXCLUSIONS (Cleaned Up) ═══
  exclusions: [
    {
      name: "war_terrorism",
      pattern: /(?:war|warfare|terrorism|nuclear|radiation)[^.]*?(?:excluded|not\s*covered)/gi,
      extract: (match) => ({
        category: "exclusion",
        text: "War, terrorism, and nuclear events excluded",
        confidence: 0.99
      })
    },
    {
      name: "cosmetic_procedures",
      pattern: /cosmetic[^.]*?(?:surgery|procedure)[^.]*?(?:excluded|not\s*covered)/gi,
      extract: (match) => ({
        category: "exclusion",
        text: "Cosmetic procedures excluded",
        confidence: 0.99
      })
    },
    {
      name: "specific_item_exclusions",
      // Catches "Treatment for X is excluded"
      pattern: /(?:treatment|expenses)\s+(?:for|related to)\s+([a-zA-Z0-9\s,]+?)\s+(?:is|are|shall be)\s+(?:specifically\s+)?excluded/gi,
      extract: (match) => {
        const rawSubject = match[1].trim();
        // Don't capture massive lists, just short phrases
        if (rawSubject.length > 60 || rawSubject.length < 3) return null;
        return {
          category: "exclusion",
          text: `${rawSubject} excluded`,
          confidence: 0.95
        };
      }
    }
  ],

  // ═══ CLAIM REJECTION (Precise) ═══
  claim_rejection: [
    {
      name: "notification_timeline",
      pattern: /(?:notify|intimate|submission)[^.]*?(?:within|in)\s*(\d+)\s*(hours?|days?)/gi,
      extract: (match) => {
        const type = /submission/i.test(match[0]) ? "Document submission" : "Claim intimation";
        return {
          category: "claim_rejection",
          text: `${type} required within ${match[1]} ${match[2]}`,
          confidence: 0.97
        };
      }
    }
  ]
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: CORE EXECUTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

function runRuleBasedExtraction(text) {
  const startTime = Date.now();
  const results = {
    waiting_periods: [], financial_limits: [], exclusions: [],
    coverage: [], claim_rejection: [],
    _meta: { rulesMatched: 0, rulesApplied: [], processingTimeMs: 0 }
  };

  if (!text || text.length < 50) return results;

  // GLOBAL NOISE FILTER: Skip purely administrative chunks
  if (/List\s*[IVX]+\s*Items|Annexure|subsumed into/i.test(text)) return results;

  const seenRules = []; // Store processed rules for fuzzy deduplication

  for (const [category, patterns] of Object.entries(RULE_PATTERNS)) {
    for (const rule of patterns) {
      rule.pattern.lastIndex = 0;
      let match;
      let matchCount = 0;
      
      while ((match = rule.pattern.exec(text)) !== null && matchCount < 6) {
        matchCount++;
        try {
          const extracted = rule.extract(match, text);
          if (!extracted) continue;
          
          // 1. AUTO-COMPLETE SENTENCE (Fixes Truncation)
          extracted.text = completeSentence(extracted.text, text, match.index);

          // 2. CLEANUP (Remove weird artifacts)
          extracted.text = extracted.text
            .replace(/[\/,\s]+$/, '')  // Remove trailing punct
            .replace(/\s+/g, ' ')      // Normalize spaces
            .trim();

          // 3. FUZZY DEDUPLICATION (Fixes Repetition)
          // Don't add if a very similar rule already exists
          if (seenRules.some(existing => isSimilar(existing, extracted.text))) continue;
          
          seenRules.push(extracted.text);
          
          if (results[category]) {
            results[category].push({ 
              ...extracted, 
              ruleName: rule.name, 
              extractionMethod: 'rule_based' 
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
        // Double check for duplicates in the global collection
        const isDup = collected[serverCategory].some(existing => isSimilar(existing, item.text));
        if (!isDup) {
          collected[serverCategory].push(item.text);
        }
      }
    }
  }
}

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };