/*******************************************************************************************
 *
 *  definitionRegistry.js
 *  =====================
 *
 *  PURPOSE
 *  -------
 *  Convert RAW extracted definitions (from Gemini) into:
 *    1) Stable canonical keys  (ex: "Room Rent" -> "room_rent")
 *    2) Deduplicated, normalized terms
 *    3) A product-friendly dictionary that UI / comparison / search can rely on
 *
 *  IMPORTANT DESIGN RULES
 *  ----------------------
 *  ❌ No AI calls here
 *  ❌ No probabilistic logic
 *  ❌ No rewriting meaning
 *
 *  ✅ Deterministic
 *  ✅ Cheap
 *  ✅ Cacheable
 *
 *******************************************************************************************/


/* =========================================================================================
 * ZONE 1: TERM NORMALIZATION HELPERS
 * ========================================================================================= */

/**
 * normalizeWhitespace
 * -------------------
 * Collapses multi-space / newlines into single spaces.
 * Makes PDF + Gemini outputs stable for matching.
 */
function normalizeWhitespace(str = "") {
  return String(str)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * normalizeTermForMatching
 * ------------------------
 * Produces a stable "matching form" of a term.
 * Used only for lookup / alias matching.
 *
 * Example:
 *   "ICU (Intensive Care Unit) Charges" -> "icu intensive care unit charges"
 */
function normalizeTermForMatching(term = "") {
  return normalizeWhitespace(term)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ""); // remove punctuation for matching
}

/**
 * slugifyKey
 * ----------
 * Produces a stable key usable as an object key.
 *
 * Example:
 *   "Room Rent" -> "room_rent"
 *   "Myocardial Infarction (First Heart Attack)" -> "myocardial_infarction_first_heart_attack"
 */
function slugifyKey(term = "") {
  return normalizeWhitespace(term)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // keep only alphanumerics/spaces
    .replace(/\s+/g, "_")        // spaces -> underscores
    .replace(/_+/g, "_")         // collapse multiple underscores
    .trim();
}


/* =========================================================================================
 * ZONE 2: CANONICAL DEFINITION MAP (YOUR "SOURCE OF TRUTH")
 * =========================================================================================
 *
 * This registry is the KEY to product stability.
 *
 * Why?
 * - Insurers use different names for the same thing:
 *     "Hospitalized" vs "Hospitalisation"
 *     "Room Rent" vs "Room and Boarding"
 *     "ICU Charges" vs "Intensive Care Unit Charges"
 *
 * We want ONE stable key across all policies:
 *     room_rent
 *     icu_charges
 *     hospitalization
 *
 * Add more aliases over time as you ingest more PDFs.
 */

const CANONICAL_DEFINITIONS = [
  {
    key: "accident",
    canonical_term: "Accident",
    aliases: ["accident", "accident or accidental", "accidental"]
  },
  {
    key: "hospital",
    canonical_term: "Hospital",
    aliases: ["hospital"]
  },
  {
    key: "hospitalization",
    canonical_term: "Hospitalization",
    aliases: ["hospitalization", "hospitalised", "hospitalized"]
  },
  {
    key: "in_patient_care",
    canonical_term: "In-patient Care",
    aliases: ["in-patient care", "in patient care", "inpatient care"]
  },
  {
    key: "day_care_treatment",
    canonical_term: "Day Care Treatment",
    aliases: ["day care treatment"]
  },
  {
    key: "day_care_centre",
    canonical_term: "Day Care Centre",
    aliases: ["day care centre", "day care center"]
  },
  {
    key: "icu",
    canonical_term: "Intensive Care Unit (ICU)",
    aliases: ["intensive care unit", "icu"]
  },
  {
    key: "icu_charges",
    canonical_term: "ICU Charges",
    aliases: ["icu charges", "intensive care unit charges", "icu (intensive care unit) charges"]
  },
  {
    key: "room_rent",
    canonical_term: "Room Rent",
    aliases: ["room rent", "room and boarding", "room & boarding"]
  },
  {
    key: "associated_medical_expenses",
    canonical_term: "Associated Medical Expenses",
    aliases: ["associated medical expenses"]
  },
  {
    key: "pre_existing_disease",
    canonical_term: "Pre-existing Disease",
    aliases: ["pre-existing disease", "pre existing disease", "ped"]
  },
  {
    key: "waiting_period",
    canonical_term: "Waiting Period",
    aliases: ["waiting period"]
  },
  {
    key: "grace_period",
    canonical_term: "Grace Period",
    aliases: ["grace period"]
  },
  {
    key: "co_payment",
    canonical_term: "Co-payment",
    aliases: ["co-payment", "copayment", "co payment"]
  },
  {
    key: "deductible",
    canonical_term: "Deductible",
    aliases: ["deductible"]
  }
];


/* =========================================================================================
 * ZONE 3: LOOKUP INDEX (FAST + DETERMINISTIC)
 * ========================================================================================= */

function buildAliasIndex() {
  const index = new Map();

  for (const entry of CANONICAL_DEFINITIONS) {
    for (const alias of entry.aliases) {
      index.set(normalizeTermForMatching(alias), entry);
    }
  }

  return index;
}

const ALIAS_INDEX = buildAliasIndex();


/* =========================================================================================
 * ZONE 4: MAIN NORMALIZER
 * ========================================================================================= */

/**
 * normalizeDefinitions
 * --------------------
 * INPUT (from server.js):
 *   collected.definitions = {
 *     "Room Rent": "Room Rent means ...",
 *     "ICU (Intensive Care Unit) Charges": "...."
 *   }
 *
 * OUTPUT:
 *   {
 *     by_key: {
 *       room_rent: {
 *         key: "room_rent",
 *         canonical_term: "Room Rent",
 *         raw_terms: ["Room Rent"],
 *         definition: "...",
 *         source: "canonical_registry" | "auto_slug"
 *       },
 *       icu_charges: {...}
 *     },
 *     unmapped: [
 *       { term: "Weird Term", key: "weird_term", definition: "..." }
 *     ]
 *   }
 *
 * IMPORTANT:
 * - We do NOT delete anything.
 * - We do NOT rewrite definitions.
 * - We only standardize keys + group duplicates.
 */
export function normalizeDefinitions(rawDefinitionsObj = {}) {
  const by_key = {};
  const unmapped = [];

  for (const [rawTerm, rawDefinition] of Object.entries(rawDefinitionsObj)) {
    const term = normalizeWhitespace(rawTerm);
    const definition = normalizeWhitespace(rawDefinition);

    if (!term || definition.length < 5) continue;

    const matchKey = normalizeTermForMatching(term);
    const registryEntry = ALIAS_INDEX.get(matchKey);

    // CASE 1: term matches our canonical registry
    if (registryEntry) {
      const key = registryEntry.key;

      if (!by_key[key]) {
        by_key[key] = {
          key,
          canonical_term: registryEntry.canonical_term,
          raw_terms: [],
          definition,
          source: "canonical_registry"
        };
      }

      // Store all raw variants we saw in the PDF (useful for debugging)
      if (!by_key[key].raw_terms.includes(term)) {
        by_key[key].raw_terms.push(term);
      }

      // Prefer the LONGER definition if multiple appear
      if (definition.length > by_key[key].definition.length) {
        by_key[key].definition = definition;
      }

      continue;
    }

    // CASE 2: Not in registry → still keep it, but under an auto key
    const autoKey = slugifyKey(term);

    // If autoKey already exists, merge terms
    if (!by_key[autoKey]) {
      by_key[autoKey] = {
        key: autoKey,
        canonical_term: term,
        raw_terms: [term],
        definition,
        source: "auto_slug"
      };

      unmapped.push({
        term,
        key: autoKey,
        definition
      });
    } else {
      if (!by_key[autoKey].raw_terms.includes(term)) {
        by_key[autoKey].raw_terms.push(term);
      }
      if (definition.length > by_key[autoKey].definition.length) {
        by_key[autoKey].definition = definition;
      }
    }
  }

  return { by_key, unmapped };
}
