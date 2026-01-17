/*******************************************************************************************
 * ruleEngine.js (v1.2 CONTEXT-AWARE)
 * Improvements: 
 * - Context Lookback: Grabs the "Subject" before the limit (e.g. "Ambulance" before "Limit")
 * - Smart Labeling: Replaces generic "Sub-limit" with specific category names
 * - Noise Filtering: Ignores "Sum Insured" or "Premium" appearing as limits
 *******************************************************************************************/

// ════ HELPER: GET PRECEDING CONTEXT ════
/**
 * Looks backward from the match to find what the number refers to.
 * Stops at punctuation or newlines.
 */
function getPrecedingContext(text, matchIndex, charLimit = 60) {
  if (!text) return "";
  const start = Math.max(0, matchIndex - charLimit);
  const preceding = text.slice(start, matchIndex);
  
  // 1. Split by sentence breakers (., :, ;, \n) to get the immediate phrase
  const phrase = preceding.split(/[\.\n\r:;]/).pop() || "";
  
  // 2. Clean up leading bullets, numbers, or nonsense
  // Removes "1. ", "> ", "- " etc.
  const cleanPhrase = phrase.replace(/^[\s\d\W_]+/, '').trim();
  
  // 3. Return the last 4-6 words which usually contain the subject
  // e.g. "expenses incurred for Cataract" -> "Cataract"
  const words = cleanPhrase.split(/\s+/);
  return words.slice(-6).join(" ");
}

const RULE_PATTERNS = {
  // ═══ WAITING PERIOD PATTERNS ═══
  waiting_periods: [
    {
      name: "explicit_numeric_waiting",
      pattern: /(\d+)\s*(?:months?|years?|days?)\s*(?:waiting|exclusion|cooling[- ]?off)\s*period/gi,
      extract: (match, fullText) => {
        // Context isn't usually needed for "24 months waiting period" as the phrase is self-contained
        // But we check if it mentions a specific disease right before
        const context = getPrecedingContext(fullText, match.index, 40);
        const subject = context.match(/(maternity|ped|pre-existing|specific disease)/i)?.[0];
        
        const label = subject 
          ? `${subject} waiting period` 
          : match[0].replace(/[\.,;]$/, '').trim();

        return {
          category: "waiting_period",
          text: label,
          confidence: 0.99,
          source: "rule_explicit_waiting"
        };
      }
    },
    {
      name: "specific_condition_waiting",
      pattern: /(maternity|cancer|heart|knee|cataract|hernia|hysterectomy|joint replacement|bariatric|renal)[^.]*?(\d+)\s*(months?|years?)\s*(?:waiting|from|after)/gi,
      extract: (match) => ({
        category: "waiting_period",
        text: `${match[1]} waiting period: ${match[2]} ${match[3]}`,
        confidence: 0.98,
        source: "rule_condition_waiting"
      })
    }
  ],

  // ═══ FINANCIAL LIMIT PATTERNS (The Problem Area) ═══
  financial_limits: [
    // 1. Dual Limits (e.g. "25% or Rs 40,000")
    {
      name: "dual_limit_percentage_or_amount",
      pattern: /(\d+%)\s*(?:of sum insured|of SI).*?(?:or|subject to).*?(?:rs\.?|₹)\s*([\d,]+)/gi,
      extract: (match, fullText) => {
        const context = getPrecedingContext(fullText, match.index, 50);
        const label = context.length > 4 ? context : "Specific Procedure";
        
        return {
          category: "financial_limit",
          text: `${label} limit: ${match[1]} or ₹${match[2]} (whichever is lower)`,
          confidence: 0.99,
          source: "rule_dual_limit"
        };
      }
    },
    // 2. Room Rent (Self-contained, usually reliable)
    {
      name: "room_rent_limit",
      pattern: /room\s*(?:rent|charges?|tariff)[^.]*?(?:₹|rs\.?|inr|rupees?)\s*([\d,]+)(?:\s*(?:per|\/)\s*day)?/gi,
      extract: (match) => ({
        category: "financial_limit",
        text: `Room Rent Capped at ₹${match[1]} per day`,
        confidence: 0.99,
        source: "rule_room_rent"
      })
    },
    // 3. Generic Sub-limits (The ones that were returning "Sub-limit: 5000")
    // FIX: We now look backward to see WHAT has the sub-limit
    {
      name: "generic_sublimit",
      pattern: /(?:sub[- ]?limit|capped|maximum|upto|limit of)[^.]*?(?:₹|rs\.?|inr)\s*([\d,]+)/gi,
      extract: (match, fullText) => {
        const amount = match[1];
        
        // Look back for the "Subject" (e.g. Ambulance, Cataract, Ayush)
        let context = getPrecedingContext(fullText, match.index, 70);
        
        // Filter: If context is just "subject to", it's useless. Look further back? 
        // Or if it's "Sum Insured", ignore it (it's not a sub-limit).
        if (/sum insured|policy limit|premium/i.test(context)) return null;

        // Clean context to be a nice label
        // We prioritize known keywords if present
        const keywordMatch = context.match(/(ambulance|cataract|ayush|domiciliary|donor|maternity|restoration|recharge)/i);
        const label = keywordMatch 
          ? keywordMatch[0] + " limit" 
          : (context.length > 5 ? context : "General sub-limit");

        return {
          category: "financial_limit",
          text: `${label}: ₹${amount}`,
          confidence: 0.95,
          source: "rule_sublimit_context"
        };
      }
    },
    // 4. Co-payments
    {
      name: "copay_percentage",
      pattern: /co[- ]?pay(?:ment)?[^.]*?(\d+)\s*%/gi,
      extract: (match, fullText) => {
        const percent = match[1];
        const context = getPrecedingContext(fullText, match.index, 50);
        
        // Detect if it's for specific age or zone
        let detail = "";
        if (context.match(/senior|age/i)) detail = " (Age-based)";
        if (context.match(/zone|tier/i)) detail = " (Zone-based)";

        return {
          category: "financial_limit",
          text: `Co-payment: ${percent}%${detail}`,
          confidence: 0.99,
          source: "rule_copay"
        };
      }
    }
  ],

  // ═══ EXCLUSION PATTERNS ═══
  exclusions: [
    {
      name: "war_terrorism",
      pattern: /(?:war|warfare|terrorism|nuclear|radiation|hostilities)[^.]*?(?:excluded|not\s*covered)/gi,
      extract: (match) => ({
        category: "exclusion",
        text: "War, terrorism, and nuclear events excluded",
        confidence: 0.99,
        source: "rule_war_exclusion"
      })
    },
    {
      name: "cosmetic_procedures",
      pattern: /cosmetic[^.]*?(?:surgery|procedure|treatment)[^.]*?(?:excluded|not\s*covered)/gi,
      extract: (match) => ({
        category: "exclusion",
        text: "Cosmetic procedures excluded",
        confidence: 0.99,
        source: "rule_cosmetic_exclusion"
      })
    },
    {
      name: "generic_exclusions",
      // Catches "Treatment for X, Y, Z is excluded"
      pattern: /(?:treatment for|expenses related to)\s+([a-zA-Z0-9\s,]+?)\s+(?:is|are|shall be)\s+excluded/gi,
      extract: (match) => {
        const subject = match[1].trim();
        if (subject.length > 50 || subject.length < 3) return null; // Too long or short
        return {
          category: "exclusion",
          text: `${subject} excluded`,
          confidence: 0.90,
          source: "rule_generic_exclusion"
        };
      }
    }
  ],

  // ═══ CLAIM REJECTION PATTERNS ═══
  claim_rejection: [
    {
      name: "notification_timeline",
      pattern: /(?:notify|intimate|submission)[^.]*?(?:within|in)\s*(\d+)\s*(hours?|days?)/gi,
      extract: (match, fullText) => {
        const type = /submission/i.test(match[0]) ? "Document submission" : "Claim intimation";
        return {
          category: "claim_rejection",
          text: `${type} required within ${match[1]} ${match[2]}`,
          confidence: 0.97,
          source: "rule_notification_timeline"
        };
      }
    }
  ]
};

// ════ CORE FUNCTIONS ════

function runRuleBasedExtraction(text) {
  const startTime = Date.now();
  const results = {
    waiting_periods: [], financial_limits: [], exclusions: [],
    coverage: [], claim_rejection: [],
    _meta: { rulesMatched: 0, rulesApplied: [], processingTimeMs: 0 }
  };

  if (!text || text.length < 50) return results;

  // NOISE FILTER: Skip administrative tables
  if (/List\s*[IVX]+\s*Items|Annexure|subsumed into/i.test(text)) {
     return results; 
  }

  const seenTexts = new Set();

  for (const [category, patterns] of Object.entries(RULE_PATTERNS)) {
    for (const rule of patterns) {
      rule.pattern.lastIndex = 0;
      let match;
      let matchCount = 0;
      
      while ((match = rule.pattern.exec(text)) !== null && matchCount < 5) {
        matchCount++;
        try {
          // PASS FULL TEXT for context lookups
          const extracted = rule.extract(match, text);
          if (!extracted) continue;
          
          // Cleanup output
          extracted.text = extracted.text
            .replace(/[\/,\s]+$/, '') // Remove trailing punct
            .replace(/\s+/g, ' ')     // Normalize spaces
            .trim();

          // Deduplication
          const normalizedText = extracted.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seenTexts.has(normalizedText)) continue;
          seenTexts.add(normalizedText);
          
          if (results[category]) {
            results[category].push({ ...extracted, ruleName: rule.name, extractionMethod: 'rule_based' });
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
        if (!collected[serverCategory].includes(item.text)) {
          collected[serverCategory].push(item.text);
        }
      }
    }
  }
}

export { runRuleBasedExtraction, routeRuleResults, RULE_PATTERNS };