/*******************************************************************************************
 *
 *  normalizePolicy.js
 *  ==================
 *
 *  THIS FILE IS THE **MOST IMPORTANT NON-AI FILE** IN THE ENTIRE PROJECT.
 *
 *  ROLE IN THE SYSTEM
 *  ------------------
 *  This module converts RAW AI OUTPUT into PRODUCT-GRADE INTELLIGENCE.
 *
 *  CRITICAL RULES
 *  --------------
 *  ❌ NO AI calls in this file
 *  ❌ NO probabilistic logic
 *  ❌ NO side effects
 *
 *  ✅ Deterministic
 *  ✅ Explainable
 *  ✅ Cheap to run
 *  ✅ Safe to cache
 *
 *******************************************************************************************/


/* =========================================================================================
 * UTILITY 1: STRING NORMALIZATION
 * ========================================================================================= */
function normalizeString(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================================================
 * UTILITY 2: DEDUPLICATE STRINGS (FUZZY-BUT-DETERMINISTIC)
 * ========================================================================================= */
function deduplicateStrings(strings = []) {
  const seen = new Set();
  const result = [];

  for (const item of strings) {
    // Skip null/undefined/non-meaningful values safely
    if (typeof item !== "string") continue;

    const cleaned = item.trim();
    if (cleaned.length < 3) continue;

    const key = normalizeString(cleaned);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}


/* =========================================================================================
 * STEP 1: MERGE RAW AI OUTPUT BY CATEGORY
 * ========================================================================================= */
function mergeByCategory(rawChunks = []) {
  const merged = {
    coverage: [],
    financials: [],
    waiting_periods: [],
    exclusions: [],
    claim_risks: []
  };

  for (const chunk of rawChunks) {
    if (chunk?.coverage) merged.coverage.push(...chunk.coverage);
    if (chunk?.financials) merged.financials.push(...chunk.financials);
    if (chunk?.waiting_periods) merged.waiting_periods.push(...chunk.waiting_periods);
    if (chunk?.exclusions) merged.exclusions.push(...chunk.exclusions);
    if (chunk?.claim_risks) merged.claim_risks.push(...chunk.claim_risks);
  }

  return merged;
}


/* =========================================================================================
 * STEP 2: CLEAN & DEDUPLICATE EACH CATEGORY
 * ========================================================================================= */
function cleanMergedData(merged) {
  return {
    coverage: deduplicateStrings(merged.coverage),
    financials: deduplicateStrings(merged.financials),
    waiting_periods: deduplicateStrings(merged.waiting_periods),
    exclusions: deduplicateStrings(merged.exclusions),
    claim_risks: deduplicateStrings(merged.claim_risks)
  };
}


/* =========================================================================================
 * MAIN EXPORT: normalizePolicy
 * ========================================================================================= */
export function normalizePolicy(rawChunkResults = []) {
  const merged = mergeByCategory(rawChunkResults);
  const cleaned = cleanMergedData(merged);
  return cleaned;
}
