/*******************************************************************************************
 *
 *  reconciliationBrain.js (v1.5 NEW FILE)
 *  =======================================
 *
 *  PURPOSE: Detect and resolve conflicts in extracted policy data
 *
 *  WHY THIS EXISTS:
 *  ----------------
 *  Insurance policies are complex documents. Sometimes they:
 *  - Contradict themselves (rare, but happens)
 *  - Mention the same item in multiple sections with different wording
 *  - Have exceptions that look like contradictions
 *  
 *  EXAMPLE CONFLICT:
 *  Section 1: "Maternity expenses are covered"
 *  Section 5: "Maternity expenses excluded for first 9 months"
 *  
 *  These aren't contradictions! The second is a waiting period, not an exclusion.
 *  But naive deduplication might remove one or flag incorrectly.
 *  
 *  This file is the "reconciliation brain" from mentor's architecture.
 *
 *  WHAT IT DOES:
 *  -------------
 *  1. Detects potential conflicts (same topic covered AND excluded)
 *  2. Categorizes conflicts by severity
 *  3. Attempts auto-resolution using heuristics
 *  4. Flags unresolvable conflicts for human review
 *
 *******************************************************************************************/

/* =========================================================================================
 * CONFLICT DETECTION - Finding Contradictions
 * =========================================================================================
 */

/**
 * EXTRACT KEYWORDS FROM TEXT
 * 
 * PURPOSE: Get meaningful words for comparison
 * 
 * ALGORITHM:
 * - Remove common words (stop words)
 * - Remove very short words (< 3 chars)
 * - Lowercase for case-insensitive comparison
 * 
 * EXAMPLE:
 * Input: "Maternity expenses are covered after waiting period"
 * Output: ["maternity", "expenses", "covered", "waiting", "period"]
 * 
 */
function extractKeywords(text) {
  // Common English stop words (words we ignore)
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with', 'shall', 'may', 'can', 'this', 'these',
    'those', 'not', 'been', 'have', 'but', 'or', 'if', 'into', 'all',
    'any', 'per', 'such', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 'well', 'also'
  ]);
  
  return text
    .toLowerCase()
    .split(/\s+/)                       // Split on whitespace
    .map(word => word.replace(/[^a-z0-9]/g, ''))  // Remove punctuation
    .filter(word => word.length >= 3)   // Remove short words
    .filter(word => !stopWords.has(word)); // Remove stop words
}


/**
 * CALCULATE SEMANTIC OVERLAP
 * 
 * PURPOSE: Determine how similar two texts are
 * 
 * ALGORITHM (Jaccard Similarity):
 * - Extract keywords from both texts
 * - Count how many keywords they share
 * - Similarity = (shared keywords) / (total unique keywords)
 * 
 * EXAMPLE:
 * Text 1: "War is excluded"           → ["war", "excluded"]
 * Text 2: "War-related injuries excluded" → ["war", "related", "injuries", "excluded"]
 * 
 * Shared: ["war", "excluded"] = 2
 * Total unique: ["war", "excluded", "related", "injuries"] = 4
 * Similarity: 2/4 = 0.50
 * 
 * RETURNS: Number between 0.0 (no overlap) and 1.0 (identical)
 */
function calculateSemanticOverlap(text1, text2) {
  const keywords1 = new Set(extractKeywords(text1));
  const keywords2 = new Set(extractKeywords(text2));
  
  // Handle empty sets
  if (keywords1.size === 0 || keywords2.size === 0) {
    return 0.0;
  }
  
  // Count shared keywords
  const intersection = [...keywords1].filter(k => keywords2.has(k));
  
  // Count total unique keywords
  const union = new Set([...keywords1, ...keywords2]);
  
  // Jaccard similarity coefficient
  return intersection.length / union.size;
}


/**
 * DETECT CONFLICTS BETWEEN COVERAGE AND EXCLUSIONS
 * 
 * PURPOSE: Find items that appear in BOTH coverage and exclusion lists
 * 
 * CONFLICT TYPES:
 * 1. TRUE CONFLICT: Item genuinely contradicted
 *    Example: "War covered" AND "War excluded" (rare but possible)
 * 
 * 2. FALSE ALARM: Not actually a conflict
 *    Example: "Maternity covered" AND "Pre-existing maternity excluded"
 *    (Second is more specific, not a contradiction)
 * 
 * ALGORITHM:
 * - Compare each coverage item with each exclusion item
 * - Calculate semantic overlap
 * - If overlap > threshold, flag as potential conflict
 * 
 */
function detectCoverageExclusionConflicts(coverage, exclusions) {
  const conflicts = [];
  
  // Threshold for considering items "about the same thing"
  // 0.40 = 40% keyword overlap
  const OVERLAP_THRESHOLD = 0.40;
  
  for (const coveredItem of coverage) {
    for (const excludedItem of exclusions) {
      const overlap = calculateSemanticOverlap(coveredItem, excludedItem);
      
      if (overlap >= OVERLAP_THRESHOLD) {
        // Potential conflict detected!
        conflicts.push({
          type: "coverage_vs_exclusion",
          coverage: coveredItem,
          exclusion: excludedItem,
          overlap_score: Math.round(overlap * 100) / 100,
          severity: categorizeConflictSeverity(overlap),
          auto_resolvable: attemptAutoResolution(coveredItem, excludedItem)
        });
      }
    }
  }
  
  return conflicts;
}


/**
 * CATEGORIZE CONFLICT SEVERITY
 * 
 * PURPOSE: Determine how serious a conflict is
 * 
 * SEVERITY LEVELS:
 * - CRITICAL: Very high overlap (>0.70) - likely genuine contradiction
 * - HIGH: High overlap (0.55-0.70) - needs attention
 * - MEDIUM: Moderate overlap (0.40-0.55) - might be specificity difference
 * 
 */
function categorizeConflictSeverity(overlapScore) {
  if (overlapScore >= 0.70) return "CRITICAL";
  if (overlapScore >= 0.55) return "HIGH";
  return "MEDIUM";
}


/**
 * ATTEMPT AUTO-RESOLUTION
 * 
 * PURPOSE: Use heuristics to resolve conflicts automatically
 * 
 * HEURISTIC RULES:
 * 1. If exclusion mentions "pre-existing", it's more specific → Not a conflict
 * 2. If exclusion mentions "waiting period", it's temporary → Not a conflict
 * 3. If coverage is general and exclusion is specific → Trust the specific one
 * 
 * RETURNS: Object with resolution or null if can't auto-resolve
 */
function attemptAutoResolution(coverage, exclusion) {
  const coverageLower = coverage.toLowerCase();
  const exclusionLower = exclusion.toLowerCase();
  
  // RULE 1: Pre-existing qualifier
  if (exclusionLower.includes("pre-existing") || exclusionLower.includes("pre existing")) {
    return {
      resolvable: true,
      resolution: "exclusion_is_more_specific",
      explanation: "Exclusion applies only to pre-existing conditions, not a contradiction",
      recommended_action: "keep_both"
    };
  }
  
  // RULE 2: Waiting period qualifier
  if (exclusionLower.includes("waiting") || exclusionLower.includes("first")) {
    return {
      resolvable: true,
      resolution: "temporary_exclusion",
      explanation: "Exclusion is temporary (waiting period), coverage applies after",
      recommended_action: "keep_both_add_note"
    };
  }
  
  // RULE 3: Specificity difference
  // If exclusion is longer, it's likely more specific
  if (exclusion.length > coverage.length * 1.5) {
    return {
      resolvable: true,
      resolution: "exclusion_is_more_specific",
      explanation: "Exclusion provides specific exception to general coverage",
      recommended_action: "keep_both"
    };
  }
  
  // Can't auto-resolve
  return {
    resolvable: false,
    explanation: "Cannot determine relationship automatically",
    recommended_action: "flag_for_human_review"
  };
}


/* =========================================================================================
 * CROSS-VALIDATION - Checking for Internal Consistency
 * =========================================================================================
 */

/**
 * DETECT DUPLICATE WAITING PERIODS
 * 
 * PURPOSE: Find if same condition mentioned with different waiting periods
 * 
 * EXAMPLE CONFLICT:
 * - "30 days waiting period for maternity"
 * - "9 months waiting period for maternity"
 * 
 * This is a genuine conflict that needs resolution.
 */
function detectWaitingPeriodConflicts(waitingPeriods) {
  const conflicts = [];
  const conditionMap = new Map(); // condition → periods
  
  for (const period of waitingPeriods) {
    const keywords = extractKeywords(period).join(' ');
    
    if (conditionMap.has(keywords)) {
      // Same condition mentioned twice!
      conflicts.push({
        type: "duplicate_waiting_period",
        first: conditionMap.get(keywords),
        second: period,
        severity: "HIGH",
        explanation: "Same condition has multiple waiting periods mentioned"
      });
    } else {
      conditionMap.set(keywords, period);
    }
  }
  
  return conflicts;
}


/**
 * DETECT CONFLICTING FINANCIAL LIMITS
 * 
 * PURPOSE: Find if same limit type has different amounts
 * 
 * EXAMPLE CONFLICT:
 * - "Room rent limited to Rs. 5000"
 * - "Room rent limit: Rs. 10,000"
 * 
 */
function detectFinancialLimitConflicts(financialLimits) {
  const conflicts = [];
  const limitMap = new Map(); // limit type → amounts
  
  for (const limit of financialLimits) {
    // Simple heuristic: extract first number
    const amountMatch = limit.match(/[\d,]+/);
    const typeKeywords = extractKeywords(limit).slice(0, 3).join(' ');
    
    if (limitMap.has(typeKeywords)) {
      const existingLimit = limitMap.get(typeKeywords);
      // Check if amounts differ
      const existingAmount = existingLimit.match(/[\d,]+/);
      
      if (amountMatch && existingAmount && amountMatch[0] !== existingAmount[0]) {
        conflicts.push({
          type: "conflicting_financial_limit",
          first: existingLimit,
          second: limit,
          severity: "CRITICAL",
          explanation: "Same limit type has different amounts"
        });
      }
    } else {
      limitMap.set(typeKeywords, limit);
    }
  }
  
  return conflicts;
}


/* =========================================================================================
 * MAIN EXPORT: reconcilePolicy
 * =========================================================================================
 * 
 * PURPOSE: Run all conflict detection and resolution logic
 * 
 * INPUT: Cleaned policy data from normalizePolicy
 * OUTPUT: Original data + conflicts array + resolution recommendations
 * 
 */
export function reconcilePolicy(cleanedData) {
  console.log("\n🧠 Starting Reconciliation Brain...");
  
  const allConflicts = [];
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFLICT CHECK 1: Coverage vs Exclusions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("  🔍 Checking Coverage vs Exclusions...");
  const coverageConflicts = detectCoverageExclusionConflicts(
    cleanedData.coverage || [],
    cleanedData.exclusions || []
  );
  
  if (coverageConflicts.length > 0) {
    console.log(`  ⚠️  Found ${coverageConflicts.length} potential conflicts`);
    allConflicts.push(...coverageConflicts);
  } else {
    console.log(`  ✅ No coverage/exclusion conflicts detected`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFLICT CHECK 2: Waiting Period Duplicates
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("  🔍 Checking Waiting Period Conflicts...");
  const wpConflicts = detectWaitingPeriodConflicts(
    cleanedData.waiting_periods || []
  );
  
  if (wpConflicts.length > 0) {
    console.log(`  ⚠️  Found ${wpConflicts.length} waiting period conflicts`);
    allConflicts.push(...wpConflicts);
  } else {
    console.log(`  ✅ No waiting period conflicts detected`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFLICT CHECK 3: Financial Limit Conflicts
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("  🔍 Checking Financial Limit Conflicts...");
  const flConflicts = detectFinancialLimitConflicts(
    cleanedData.financials || []
  );
  
  if (flConflicts.length > 0) {
    console.log(`  ⚠️  Found ${flConflicts.length} financial limit conflicts`);
    allConflicts.push(...flConflicts);
  } else {
    console.log(`  ✅ No financial limit conflicts detected`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUMMARIZE RESULTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const criticalConflicts = allConflicts.filter(c => c.severity === "CRITICAL");
  const autoResolvable = allConflicts.filter(c => c.auto_resolvable?.resolvable);
  const needsReview = allConflicts.filter(c => !c.auto_resolvable?.resolvable);
  
  console.log("\n📊 Reconciliation Summary:");
  console.log(`   Total conflicts detected: ${allConflicts.length}`);
  console.log(`   Critical conflicts: ${criticalConflicts.length}`);
  console.log(`   Auto-resolvable: ${autoResolvable.length}`);
  console.log(`   Needs human review: ${needsReview.length}`);
  
  return {
    // Original data (unchanged)
    data: cleanedData,
    
    // Conflict analysis
    conflicts: allConflicts,
    conflict_summary: {
      total: allConflicts.length,
      critical: criticalConflicts.length,
      auto_resolvable: autoResolvable.length,
      needs_review: needsReview.length
    },
    
    // Quality flags
    has_conflicts: allConflicts.length > 0,
    has_critical_conflicts: criticalConflicts.length > 0,
    requires_human_review: needsReview.length > 0 || criticalConflicts.length > 0
  };
}


/* =========================================================================================
 * UTILITY: Format Conflict Report
 * =========================================================================================
 * 
 * PURPOSE: Generate human-readable conflict report
 * 
 * USE CASE: Display in review queue UI
 * 
 */
export function formatConflictReport(conflicts) {
  if (conflicts.length === 0) {
    return "✅ No conflicts detected. Policy data is internally consistent.";
  }
  
  let report = "⚠️  CONFLICT REPORT\n";
  report += "═".repeat(60) + "\n\n";
  
  conflicts.forEach((conflict, i) => {
    report += `${i + 1}. ${conflict.type.toUpperCase()}\n`;
    report += `   Severity: ${conflict.severity}\n`;
    
    if (conflict.coverage && conflict.exclusion) {
      report += `   Coverage: "${conflict.coverage}"\n`;
      report += `   Exclusion: "${conflict.exclusion}"\n`;
      report += `   Overlap: ${(conflict.overlap_score * 100).toFixed(0)}%\n`;
    }
    
    if (conflict.auto_resolvable) {
      const res = conflict.auto_resolvable;
      report += `   Auto-resolve: ${res.resolvable ? "YES" : "NO"}\n`;
      report += `   Explanation: ${res.explanation}\n`;
      report += `   Action: ${res.recommended_action}\n`;
    }
    
    report += "\n";
  });
  
  return report;
}


/* =========================================================================================
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * END OF reconciliationBrain.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * JUNIOR DEVELOPER NOTES:
 * -----------------------
 * 
 * 1. TUNING THE OVERLAP THRESHOLD:
 *    - Currently: 0.40 (40% keyword overlap triggers conflict check)
 *    - Too many false alarms? Increase to 0.50
 *    - Missing real conflicts? Decrease to 0.35
 *    - Test on real policy data to tune
 * 
 * 2. ADDING NEW AUTO-RESOLUTION RULES:
 *    - Add new heuristics in attemptAutoResolution()
 *    - Example: If coverage says "after 30 days" → not a conflict
 *    - Each rule should have clear explanation
 * 
 * 3. HANDLING FALSE POSITIVES:
 *    - Some "conflicts" are actually refinements
 *    - Example: "Hospital covered" + "Non-network hospitals excluded"
 *    - The second refines the first, not contradicts
 *    - Add heuristics to detect these patterns
 * 
 * 4. TESTING CONFLICT DETECTION:
 *    ```javascript
 *    import { reconcilePolicy } from './reconciliationBrain.js';
 *    
 *    const testData = {
 *      coverage: ["Maternity covered"],
 *      exclusions: ["Maternity excluded for first 9 months"]
 *    };
 *    
 *    const result = reconcilePolicy(testData);
 *    console.log(result.conflicts);
 *    ```
 * 
 * 5. FUTURE ENHANCEMENTS:
 *    - Use ML to detect conflicts (train on labeled examples)
 *    - Add severity scoring based on dollar impact
 *    - Cross-reference with regulatory requirements
 *    - Suggest specific resolution actions
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */