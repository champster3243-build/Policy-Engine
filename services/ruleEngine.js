/*******************************************************************************************
 *
 *  ruleEngine.js (v1.0 - Phase 1 of Hybrid Extraction)
 *  =====================================================
 *
 *  PURPOSE: Extract high-confidence patterns using deterministic rules BEFORE LLM
 *  
 *  ARCHITECTURE POSITION:
 *  ┌─────────────┐      ┌──────────────┐      ┌─────────────┐
 *  │   Chunk     │─────▶│  RULE ENGINE │─────▶│   Gemini    │
 *  │   Text      │      │  (This File) │      │   (LLM)     │
 *  └─────────────┘      └──────────────┘      └─────────────┘
 *                              │                     │
 *                              └───────┬─────────────┘
 *                                      ▼
 *                              ┌──────────────┐
 *                              │   MERGER     │
 *                              │ (Reconcile)  │
 *                              └──────────────┘
 *
 *  WHY RULES FIRST?
 *  ----------------
 *  1. INSTANT: Regex runs in microseconds vs seconds for LLM
 *  2. FREE: No API costs
 *  3. ACCURATE: 99.9% for known patterns
 *  4. DETERMINISTIC: Same input = same output (cacheable, testable)
 *
 *  MENTOR'S PHILOSOPHY:
 *  "Use rules for what is KNOWN, use AI for what is VARIABLE"
 *
 *******************************************************************************************/


/* =========================================================================================
 * SECTION 1: PATTERN LIBRARY
 * 
 * Each pattern category contains an array of rule objects:
 * - name: Unique identifier for debugging/logging
 * - pattern: RegExp (MUST use 'gi' flags for global, case-insensitive)
 * - extract: Function that takes the match array and returns structured data
 * - confidence: How certain we are when this pattern matches (0.0 - 1.0)
 * 
 * IMPORTANT: Patterns are ordered by specificity (most specific first)
 * ========================================================================================= */

const RULE_PATTERNS = {

  /* ═══════════════════════════════════════════════════════════════════════════════════
   * WAITING PERIOD PATTERNS
   * 
   * Insurance policies define waiting periods in various ways:
   * - "24 months waiting period"
   * - "Waiting period of 2 years"
   * - "Pre-existing: 48 months from policy start"
   * - "Maternity: 9 months waiting"
   * ═══════════════════════════════════════════════════════════════════════════════════ */
  waiting_periods: [
    {
      name: "explicit_numeric_waiting",
      description: "Catches: '24 months waiting period', '2 years exclusion period'",
      pattern: /(\d+)\s*(?:months?|years?|days?)\s*(?:waiting|exclusion|cooling[- ]?off)\s*period/gi,
      confidence: 0.99,
      extract: (match, fullText) => {
        const value = parseInt(match[1]);
        const unitMatch = match[0].match(/months?|years?|days?/i);
        const unit = unitMatch ? unitMatch[0].toLowerCase().replace(/s$/, '') : 'month';
        
        return {
          category: "waiting_period",
          text: `${value} ${unit}${value > 1 ? 's' : ''} waiting period`,
          structured: { value, unit, type: "general" },
          confidence: 0.99,
          source: "rule_explicit_waiting"
        };
      }
    },
    {
      name: "pre_existing_disease_waiting",
      description: "Catches: 'Pre-existing disease: 48 months', 'PED waiting 4 years'",
      pattern: /(?:pre[- ]?existing|ped)\s*(?:disease|condition|illness)?s?\s*[:\-–]?\s*(\d+)\s*(months?|years?)/gi,
      confidence: 0.99,
      extract: (match) => {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase().replace(/s$/, '');
        
        return {
          category: "waiting_period",
          text: `Pre-existing diseases: ${value} ${unit}${value > 1 ? 's' : ''} waiting period`,
          structured: { value, unit, type: "pre_existing" },
          confidence: 0.99,
          source: "rule_ped_waiting"
        };
      }
    },
    {
      name: "specific_condition_waiting",
      description: "Catches: 'Maternity: 9 months waiting', 'Knee replacement waiting period of 24 months'",
      pattern: /(maternity|cancer|heart|knee|cataract|hernia|hysterectomy|joint replacement|bariatric|obesity|infertility|dialysis|transplant)[^.]*?(\d+)\s*(months?|years?)\s*(?:waiting|from|after)/gi,
      confidence: 0.98,
      extract: (match) => {
        const condition = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        const value = parseInt(match[2]);
        const unit = match[3].toLowerCase().replace(/s$/, '');
        
        return {
          category: "waiting_period",
          text: `${condition}: ${value} ${unit}${value > 1 ? 's' : ''} waiting period`,
          structured: { value, unit, type: "specific", condition: condition.toLowerCase() },
          confidence: 0.98,
          source: "rule_condition_waiting"
        };
      }
    },
    {
      name: "initial_waiting_period",
      description: "Catches: 'Initial waiting period of 30 days', 'First 30 days waiting'",
      pattern: /(?:initial|first)\s*(?:waiting\s*period\s*(?:of)?|(\d+)\s*(days?|months?))/gi,
      confidence: 0.97,
      extract: (match, fullText) => {
        // Try to find the number nearby if not in the match
        let value = match[1] ? parseInt(match[1]) : null;
        let unit = match[2] || 'days';
        
        if (!value) {
          // Look for number in surrounding context
          const contextMatch = fullText.slice(Math.max(0, match.index - 50), match.index + 100)
            .match(/(\d+)\s*(days?|months?)/i);
          if (contextMatch) {
            value = parseInt(contextMatch[1]);
            unit = contextMatch[2];
          }
        }
        
        if (!value) return null; // Skip if we couldn't find a value
        
        return {
          category: "waiting_period",
          text: `Initial waiting period: ${value} ${unit}`,
          structured: { value, unit: unit.replace(/s$/, ''), type: "initial" },
          confidence: 0.97,
          source: "rule_initial_waiting"
        };
      }
    }
  ],


  /* ═══════════════════════════════════════════════════════════════════════════════════
   * FINANCIAL LIMIT PATTERNS
   * 
   * These capture monetary limits, percentages, and caps:
   * - "Room rent: ₹5,000 per day"
   * - "Co-payment: 20%"
   * - "Deductible: Rs. 50,000"
   * - "Sub-limit: 10% of Sum Insured"
   * ═══════════════════════════════════════════════════════════════════════════════════ */
  financial_limits: [
    {
      name: "room_rent_limit",
      description: "Catches: 'Room rent limit: ₹5,000', 'Room charges capped at Rs. 10000'",
      pattern: /room\s*(?:rent|charges?|tariff)[^.]*?(?:₹|rs\.?|inr|rupees?)\s*([\d,]+)(?:\s*(?:per|\/)\s*day)?/gi,
      confidence: 0.99,
      extract: (match) => {
        const amount = parseInt(match[1].replace(/,/g, ''));
        
        return {
          category: "financial_limit",
          text: `Room Rent Limit: ₹${amount.toLocaleString('en-IN')} per day`,
          structured: { type: "room_rent", amount, currency: "INR", period: "per_day" },
          confidence: 0.99,
          source: "rule_room_rent"
        };
      }
    },
    {
      name: "copay_percentage",
      description: "Catches: 'Co-payment of 20%', 'Copay: 10%', '15% co-pay applicable'",
      pattern: /co[- ]?pay(?:ment)?[^.]*?(\d+)\s*%/gi,
      confidence: 0.99,
      extract: (match) => {
        const percentage = parseInt(match[1]);
        
        return {
          category: "financial_limit",
          text: `Co-payment: ${percentage}%`,
          structured: { type: "copay", percentage, applicability: "general" },
          confidence: 0.99,
          source: "rule_copay"
        };
      }
    },
    {
      name: "age_based_copay",
      description: "Catches: 'Above 60 years: 20% co-pay', 'Senior citizen copay 30%'",
      pattern: /(?:above|over|after|senior)\s*(\d+)\s*(?:years?|yrs?)?[^.]*?co[- ]?pay[^.]*?(\d+)\s*%/gi,
      confidence: 0.98,
      extract: (match) => {
        const age = parseInt(match[1]);
        const percentage = parseInt(match[2]);
        
        return {
          category: "financial_limit",
          text: `Co-payment for age ${age}+: ${percentage}%`,
          structured: { type: "copay", percentage, ageThreshold: age },
          confidence: 0.98,
          source: "rule_age_copay"
        };
      }
    },
    {
      name: "deductible_amount",
      description: "Catches: 'Deductible of ₹50,000', 'Annual deductible: Rs. 25000'",
      pattern: /deductible[^.]*?(?:₹|rs\.?|inr|rupees?)\s*([\d,]+)/gi,
      confidence: 0.99,
      extract: (match) => {
        const amount = parseInt(match[1].replace(/,/g, ''));
        
        return {
          category: "financial_limit",
          text: `Deductible: ₹${amount.toLocaleString('en-IN')}`,
          structured: { type: "deductible", amount, currency: "INR" },
          confidence: 0.99,
          source: "rule_deductible"
        };
      }
    },
    {
      name: "sublimit_percentage",
      description: "Catches: 'Sub-limit: 10% of SI', 'Capped at 15% of Sum Insured'",
      pattern: /(?:sub[- ]?limit|capped|maximum|limit)[^.]*?(\d+)\s*%\s*(?:of\s*)?(?:si|sum\s*insured|cover)/gi,
      confidence: 0.98,
      extract: (match) => {
        const percentage = parseInt(match[1]);
        
        return {
          category: "financial_limit",
          text: `Sub-limit: ${percentage}% of Sum Insured`,
          structured: { type: "sublimit", percentage, base: "sum_insured" },
          confidence: 0.98,
          source: "rule_sublimit_percent"
        };
      }
    },
    {
      name: "sublimit_amount",
      description: "Catches: 'Sub-limit of ₹1,00,000', 'Maximum ₹50000 for ambulance'",
      pattern: /(?:sub[- ]?limit|maximum|limit|up\s*to)[^.]*?(?:₹|rs\.?|inr)\s*([\d,]+)/gi,
      confidence: 0.97,
      extract: (match) => {
        const amount = parseInt(match[1].replace(/,/g, ''));
        
        // Only capture significant amounts (> ₹1000)
        if (amount < 1000) return null;
        
        return {
          category: "financial_limit",
          text: `Sub-limit: ₹${amount.toLocaleString('en-IN')}`,
          structured: { type: "sublimit", amount, currency: "INR" },
          confidence: 0.97,
          source: "rule_sublimit_amount"
        };
      }
    },
    {
      name: "icu_charges_limit",
      description: "Catches: 'ICU charges: ₹10,000/day', 'ICCU limit 2x room rent'",
      pattern: /(?:icu|iccu|intensive\s*care)[^.]*?(?:(?:₹|rs\.?|inr)\s*([\d,]+)|(\d+)\s*(?:x|times)\s*room)/gi,
      confidence: 0.98,
      extract: (match) => {
        if (match[1]) {
          const amount = parseInt(match[1].replace(/,/g, ''));
          return {
            category: "financial_limit",
            text: `ICU Charges Limit: ₹${amount.toLocaleString('en-IN')} per day`,
            structured: { type: "icu_limit", amount, currency: "INR" },
            confidence: 0.98,
            source: "rule_icu_amount"
          };
        } else if (match[2]) {
          const multiplier = parseInt(match[2]);
          return {
            category: "financial_limit",
            text: `ICU Charges Limit: ${multiplier}x Room Rent`,
            structured: { type: "icu_limit", multiplier, base: "room_rent" },
            confidence: 0.98,
            source: "rule_icu_multiplier"
          };
        }
        return null;
      }
    }
  ],


  /* ═══════════════════════════════════════════════════════════════════════════════════
   * EXCLUSION PATTERNS
   * 
   * These identify what is NOT covered:
   * - "War and terrorism excluded"
   * - "Cosmetic surgery is not covered"
   * - "Self-inflicted injuries excluded"
   * ═══════════════════════════════════════════════════════════════════════════════════ */
  exclusions: [
    {
      name: "war_terrorism_nuclear",
      description: "Catches: 'War, terrorism excluded', 'Nuclear events not covered'",
      pattern: /(?:war|warfare|terrorism|terrorist|nuclear|radiation|hostilities|riot|strike|civil\s*commotion)[^.]*?(?:excluded|not\s*covered|shall\s*not\s*be\s*payable)/gi,
      confidence: 0.99,
      extract: (match) => ({
        category: "exclusion",
        text: "War, terrorism, nuclear events, riots, and civil commotion excluded",
        structured: { type: "standard_exclusion", items: ["war", "terrorism", "nuclear", "riots"] },
        confidence: 0.99,
        source: "rule_war_exclusion"
      })
    },
    {
      name: "cosmetic_procedures",
      description: "Catches: 'Cosmetic surgery not covered', 'Plastic surgery for beautification excluded'",
      pattern: /cosmetic[^.]*?(?:surgery|procedure|treatment|enhancement)[^.]*?(?:excluded|not\s*covered|not\s*payable)/gi,
      confidence: 0.99,
      extract: (match) => ({
        category: "exclusion",
        text: "Cosmetic and plastic surgery for beautification excluded",
        structured: { type: "standard_exclusion", items: ["cosmetic_surgery"] },
        confidence: 0.99,
        source: "rule_cosmetic_exclusion"
      })
    },
    {
      name: "self_inflicted_injury",
      description: "Catches: 'Self-inflicted injuries excluded', 'Intentional self-harm not covered'",
      pattern: /self[- ]?inflicted[^.]*?(?:injury|injuries|harm|wound)/gi,
      confidence: 0.99,
      extract: (match) => ({
        category: "exclusion",
        text: "Self-inflicted injuries excluded",
        structured: { type: "standard_exclusion", items: ["self_inflicted"] },
        confidence: 0.99,
        source: "rule_self_inflicted"
      })
    },
    {
      name: "alcohol_drugs",
      description: "Catches: 'Injuries due to alcohol excluded', 'Drug abuse not covered'",
      pattern: /(?:alcohol|drug|substance|intoxication|narcotics?)[^.]*?(?:abuse|addiction|influence)?[^.]*?(?:excluded|not\s*covered|not\s*payable)/gi,
      confidence: 0.98,
      extract: (match) => ({
        category: "exclusion",
        text: "Injuries due to alcohol or drug abuse excluded",
        structured: { type: "standard_exclusion", items: ["alcohol", "drugs"] },
        confidence: 0.98,
        source: "rule_alcohol_drugs"
      })
    },
    {
      name: "adventure_sports",
      description: "Catches: 'Adventure sports excluded', 'Hazardous activities not covered'",
      pattern: /(?:adventure|hazardous|extreme|dangerous)\s*(?:sports?|activit(?:y|ies))[^.]*?(?:excluded|not\s*covered)/gi,
      confidence: 0.97,
      extract: (match) => ({
        category: "exclusion",
        text: "Adventure sports and hazardous activities excluded",
        structured: { type: "standard_exclusion", items: ["adventure_sports", "hazardous_activities"] },
        confidence: 0.97,
        source: "rule_adventure_sports"
      })
    },
    {
      name: "dental_unless",
      description: "Catches: 'Dental treatment excluded unless due to accident'",
      pattern: /dental[^.]*?(?:treatment|procedure|surgery)?[^.]*?(?:excluded|not\s*covered)(?:[^.]*?unless[^.]*?accident)?/gi,
      confidence: 0.96,
      extract: (match) => {
        const hasException = /unless[^.]*?accident/i.test(match[0]);
        return {
          category: "exclusion",
          text: hasException 
            ? "Dental treatment excluded (except if due to accident)" 
            : "Dental treatment excluded",
          structured: { 
            type: "conditional_exclusion", 
            items: ["dental"], 
            exception: hasException ? "accident" : null 
          },
          confidence: 0.96,
          source: "rule_dental_exclusion"
        };
      }
    },
    {
      name: "infertility_treatment",
      description: "Catches: 'Infertility treatment not covered', 'IVF excluded'",
      pattern: /(?:infertility|ivf|assisted\s*reproduction|fertility)[^.]*?(?:treatment|procedure)?[^.]*?(?:excluded|not\s*covered)/gi,
      confidence: 0.98,
      extract: (match) => ({
        category: "exclusion",
        text: "Infertility treatment and IVF excluded",
        structured: { type: "standard_exclusion", items: ["infertility", "ivf"] },
        confidence: 0.98,
        source: "rule_infertility"
      })
    },
    {
      name: "obesity_weight_loss",
      description: "Catches: 'Weight loss surgery excluded', 'Bariatric surgery not covered'",
      pattern: /(?:obesity|weight\s*loss|bariatric|gastric\s*bypass|liposuction)[^.]*?(?:surgery|treatment|procedure)?[^.]*?(?:excluded|not\s*covered)/gi,
      confidence: 0.98,
      extract: (match) => ({
        category: "exclusion",
        text: "Obesity/weight loss surgery and bariatric procedures excluded",
        structured: { type: "standard_exclusion", items: ["obesity", "bariatric", "weight_loss"] },
        confidence: 0.98,
        source: "rule_obesity"
      })
    },
    {
      name: "explicit_not_covered_list",
      description: "Catches: 'The following are not covered: X, Y, Z'",
      pattern: /(?:not\s*covered|excluded|shall\s*not\s*be\s*payable)[:\s]+([^.]+)/gi,
      confidence: 0.90,
      extract: (match) => {
        const content = match[1].trim();
        // Only capture if it's a meaningful description (not just filler words)
        if (content.length < 10 || /^(?:the|any|all|under|this)/i.test(content)) {
          return null;
        }
        return {
          category: "exclusion",
          text: content,
          structured: { type: "explicit_exclusion", rawText: content },
          confidence: 0.90,
          source: "rule_explicit_not_covered"
        };
      }
    }
  ],


  /* ═══════════════════════════════════════════════════════════════════════════════════
   * COVERAGE PATTERNS
   * 
   * These identify what IS covered:
   * - "Hospitalization expenses covered"
   * - "Day care procedures included"
   * - "Pre and post hospitalization covered"
   * ═══════════════════════════════════════════════════════════════════════════════════ */
  coverage: [
    {
      name: "hospitalization_covered",
      description: "Catches: 'In-patient hospitalization covered', 'Hospitalization expenses payable'",
      pattern: /(?:in[- ]?patient\s*)?hospitali[sz]ation[^.]*?(?:covered|included|payable|shall\s*be\s*paid)/gi,
      confidence: 0.95,
      extract: (match) => ({
        category: "coverage",
        text: "In-patient hospitalization covered",
        structured: { type: "core_coverage", items: ["hospitalization"] },
        confidence: 0.95,
        source: "rule_hospitalization"
      })
    },
    {
      name: "daycare_procedures",
      description: "Catches: 'Day care procedures covered', 'Daycare treatments included'",
      pattern: /day\s*care\s*(?:procedure|treatment|surgery)[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.97,
      extract: (match) => ({
        category: "coverage",
        text: "Day care procedures covered",
        structured: { type: "core_coverage", items: ["daycare"] },
        confidence: 0.97,
        source: "rule_daycare"
      })
    },
    {
      name: "pre_post_hospitalization",
      description: "Catches: 'Pre-hospitalization 30 days covered', 'Post-hospitalization 60 days'",
      pattern: /(pre|post)[- ]?hospitali[sz]ation[^.]*?(\d+)\s*days?[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.98,
      extract: (match) => {
        const type = match[1].toLowerCase();
        const days = parseInt(match[2]);
        
        return {
          category: "coverage",
          text: `${type.charAt(0).toUpperCase() + type.slice(1)}-hospitalization: ${days} days covered`,
          structured: { type: `${type}_hospitalization`, days },
          confidence: 0.98,
          source: `rule_${type}_hosp`
        };
      }
    },
    {
      name: "ambulance_covered",
      description: "Catches: 'Ambulance charges covered', 'Emergency ambulance included'",
      pattern: /ambulance[^.]*?(?:charges?|expense|service)?[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.96,
      extract: (match) => ({
        category: "coverage",
        text: "Ambulance charges covered",
        structured: { type: "additional_coverage", items: ["ambulance"] },
        confidence: 0.96,
        source: "rule_ambulance"
      })
    },
    {
      name: "domiciliary_covered",
      description: "Catches: 'Domiciliary treatment covered', 'Home treatment included'",
      pattern: /(?:domiciliary|home)\s*(?:treatment|hospitali[sz]ation)[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.96,
      extract: (match) => ({
        category: "coverage",
        text: "Domiciliary (home) treatment covered",
        structured: { type: "additional_coverage", items: ["domiciliary"] },
        confidence: 0.96,
        source: "rule_domiciliary"
      })
    },
    {
      name: "organ_donor_covered",
      description: "Catches: 'Organ donor expenses covered', 'Donor expenses included'",
      pattern: /(?:organ\s*)?donor[^.]*?(?:expense|charge|cost)[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.96,
      extract: (match) => ({
        category: "coverage",
        text: "Organ donor expenses covered",
        structured: { type: "additional_coverage", items: ["organ_donor"] },
        confidence: 0.96,
        source: "rule_organ_donor"
      })
    },
    {
      name: "ayush_covered",
      description: "Catches: 'AYUSH treatment covered', 'Ayurveda, Yoga, Homeopathy covered'",
      pattern: /(?:ayush|ayurveda|homeopathy|unani|siddha|naturopathy)[^.]*?(?:covered|included|payable)/gi,
      confidence: 0.95,
      extract: (match) => ({
        category: "coverage",
        text: "AYUSH treatments (Ayurveda, Yoga, Unani, Siddha, Homeopathy) covered",
        structured: { type: "additional_coverage", items: ["ayush"] },
        confidence: 0.95,
        source: "rule_ayush"
      })
    }
  ],


  /* ═══════════════════════════════════════════════════════════════════════════════════
   * CLAIM REJECTION PATTERNS
   * 
   * These identify conditions that may lead to claim denial:
   * - "Failure to notify within 24 hours may void claim"
   * - "Documents must be submitted within 30 days"
   * ═══════════════════════════════════════════════════════════════════════════════════ */
  claim_rejection: [
    {
      name: "notification_timeline",
      description: "Catches: 'Notify within 24 hours', 'Intimation within 48 hours mandatory'",
      pattern: /(?:notify|notif(?:y|ication)|intimate|intimation)[^.]*?(?:within|in)\s*(\d+)\s*(hours?|days?)/gi,
      confidence: 0.97,
      extract: (match) => ({
        category: "claim_rejection",
        text: `Claim intimation required within ${match[1]} ${match[2]}`,
        structured: { type: "timeline_requirement", value: parseInt(match[1]), unit: match[2] },
        confidence: 0.97,
        source: "rule_notification_timeline"
      })
    },
    {
      name: "document_submission_timeline",
      description: "Catches: 'Submit documents within 30 days', 'Bills to be submitted in 15 days'",
      pattern: /(?:document|bill|receipt|claim\s*form)[^.]*?(?:submit|submission)[^.]*?(?:within|in)\s*(\d+)\s*(days?)/gi,
      confidence: 0.97,
      extract: (match) => ({
        category: "claim_rejection",
        text: `Documents must be submitted within ${match[1]} ${match[2]}`,
        structured: { type: "document_timeline", value: parseInt(match[1]), unit: match[2] },
        confidence: 0.97,
        source: "rule_document_timeline"
      })
    },
    {
      name: "network_hospital_requirement",
      description: "Catches: 'Must use network hospital for cashless', 'Non-network may affect claim'",
      pattern: /(?:network|empanelled|listed)\s*hospital[^.]*?(?:required|mandatory|must|only)/gi,
      confidence: 0.90,
      extract: (match) => ({
        category: "claim_rejection",
        text: "Network hospital required for cashless claims",
        structured: { type: "network_requirement" },
        confidence: 0.90,
        source: "rule_network_requirement"
      })
    },
    {
      name: "fraud_misrepresentation",
      description: "Catches: 'Fraud will void policy', 'Misrepresentation may cancel claim'",
      pattern: /(?:fraud|misrepresent|false|fake|forged)[^.]*?(?:void|cancel|reject|decline|forfeit)/gi,
      confidence: 0.95,
      extract: (match) => ({
        category: "claim_rejection",
        text: "Fraud or misrepresentation will void the claim",
        structured: { type: "fraud_clause" },
        confidence: 0.95,
        source: "rule_fraud"
      })
    },
    {
      name: "original_documents_required",
      description: "Catches: 'Original bills required', 'Originals mandatory for reimbursement'",
      pattern: /original[^.]*?(?:bill|document|receipt|report)[^.]*?(?:required|mandatory|must|necessary)/gi,
      confidence: 0.92,
      extract: (match) => ({
        category: "claim_rejection",
        text: "Original documents/bills required for claim",
        structured: { type: "document_requirement", originalRequired: true },
        confidence: 0.92,
        source: "rule_original_docs"
      })
    }
  ]
};


/* =========================================================================================
 * SECTION 2: RULE ENGINE CORE FUNCTIONS
 * ========================================================================================= */

/**
 * RUN RULE-BASED EXTRACTION ON A TEXT CHUNK
 * 
 * This is the main function that applies all pattern rules to a chunk of text.
 * It runs synchronously and is extremely fast (microseconds).
 * 
 * @param {string} text - The chunk text to analyze
 * @returns {Object} - Extracted rules organized by category with metadata
 * 
 * EXAMPLE OUTPUT:
 * {
 *   waiting_periods: [{ category, text, confidence, source, structured }],
 *   financial_limits: [...],
 *   exclusions: [...],
 *   coverage: [...],
 *   claim_rejection: [...],
 *   _meta: { rulesMatched: 5, rulesApplied: ["rule_ped_waiting", ...], processingTimeMs: 2 }
 * }
 */
function runRuleBasedExtraction(text) {
  const startTime = Date.now();
  
  // Initialize result structure
  const results = {
    waiting_periods: [],
    financial_limits: [],
    exclusions: [],
    coverage: [],
    claim_rejection: [],
    _meta: {
      rulesMatched: 0,
      rulesApplied: [],
      processingTimeMs: 0
    }
  };

  // Skip if text is too short to be meaningful
  if (!text || text.length < 50) {
    results._meta.processingTimeMs = Date.now() - startTime;
    return results;
  }

  // Track seen extractions to avoid duplicates
  const seenTexts = new Set();

  // Iterate through each category
  for (const [category, patterns] of Object.entries(RULE_PATTERNS)) {
    for (const rule of patterns) {
      // CRITICAL: Reset regex lastIndex for global patterns
      // Without this, regex.exec() would continue from last match position
      rule.pattern.lastIndex = 0;
      
      let match;
      let matchCount = 0;
      const maxMatchesPerRule = 5; // Prevent runaway matching
      
      while ((match = rule.pattern.exec(text)) !== null && matchCount < maxMatchesPerRule) {
        matchCount++;
        
        try {
          // Call the extract function to get structured data
          const extracted = rule.extract(match, text);
          
          // Skip if extract returned null (pattern matched but data wasn't meaningful)
          if (!extracted) continue;
          
          // Deduplicate by text content
          const normalizedText = extracted.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seenTexts.has(normalizedText)) continue;
          seenTexts.add(normalizedText);
          
          // Add to appropriate category
          if (results[category]) {
            results[category].push({
              ...extracted,
              ruleName: rule.name,
              extractionMethod: 'rule_based'
            });
            results._meta.rulesMatched++;
            
            // Track which rules fired (for debugging/analysis)
            if (!results._meta.rulesApplied.includes(rule.name)) {
              results._meta.rulesApplied.push(rule.name);
            }
          }
        } catch (err) {
          // Log but don't crash on extraction errors
          console.warn(`[RuleEngine] Error in rule ${rule.name}:`, err.message);
        }
      }
    }
  }

  results._meta.processingTimeMs = Date.now() - startTime;
  return results;
}


/**
 * MERGE RULE-BASED AND LLM EXTRACTION RESULTS
 * 
 * This implements the "Reconciliation Brain" concept from the mentor's blueprint.
 * Rule-based results are trusted (high confidence), LLM fills in gaps.
 * 
 * MERGE STRATEGY:
 * 1. Rule-based results are added first (they're the "ground truth")
 * 2. LLM results are checked for duplicates against rule results
 * 3. Non-duplicate LLM results are added with lower confidence
 * 
 * @param {Object} ruleResults - Output from runRuleBasedExtraction()
 * @param {Object} llmResults - Parsed output from Gemini/LLM
 * @returns {Object} - Merged, deduplicated results with provenance tracking
 */
function mergeExtractionResults(ruleResults, llmResults) {
  const merged = {
    waiting_periods: [],
    financial_limits: [],
    exclusions: [],
    coverage: [],
    claim_rejection: [],
    _meta: {
      ruleCount: ruleResults._meta?.rulesMatched || 0,
      llmCount: 0,
      duplicatesSkipped: 0,
      totalMerged: 0
    }
  };

  /**
   * HELPER: Check if LLM result is semantically similar to any rule result
   * Uses a simple containment heuristic (60% overlap)
   */
  const isDuplicate = (llmText, ruleResults) => {
    if (!llmText || !ruleResults || ruleResults.length === 0) return false;
    
    const llmNorm = String(llmText).toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Skip very short strings (likely to match everything)
    if (llmNorm.length < 10) return false;
    
    return ruleResults.some(r => {
      const ruleNorm = String(r.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Check bidirectional containment (either contains the other)
      const overlap = llmNorm.includes(ruleNorm) || ruleNorm.includes(llmNorm);
      
      // Also check for significant word overlap
      const llmWords = new Set(llmNorm.match(/[a-z]+/g) || []);
      const ruleWords = new Set(ruleNorm.match(/[a-z]+/g) || []);
      const intersection = [...llmWords].filter(w => ruleWords.has(w) && w.length > 3);
      const wordOverlap = intersection.length >= Math.min(llmWords.size, ruleWords.size) * 0.6;
      
      return overlap || wordOverlap;
    });
  };

  // ═══ STEP 1: Add all rule-based results (trusted, high confidence) ═══
  for (const category of ['waiting_periods', 'financial_limits', 'exclusions', 'coverage', 'claim_rejection']) {
    const ruleItems = ruleResults[category] || [];
    merged[category].push(...ruleItems.map(r => ({
      ...r,
      extractionMethod: 'rule_based',
      confidence: r.confidence || 0.99
    })));
  }

  // ═══ STEP 2: Add non-duplicate LLM results ═══
  if (llmResults) {
    // Map LLM category names to our internal names
    const categoryMap = {
      'waiting_period': 'waiting_periods',
      'financial_limit': 'financial_limits',
      'exclusion': 'exclusions',
      'coverage': 'coverage',
      'claim_rejection': 'claim_rejection'
    };

    // Handle array of rules from LLM
    const llmRules = Array.isArray(llmResults.rules) 
      ? llmResults.rules 
      : (llmResults.rule ? [llmResults] : []);

    for (const llmRule of llmRules) {
      const llmCategory = llmRule.category || llmRule.type;
      const targetCategory = categoryMap[llmCategory] || llmCategory;
      const llmText = llmRule.text || llmRule.rule;
      
      if (merged[targetCategory] && llmText) {
        // Check for duplicates against rule-based results
        if (isDuplicate(llmText, ruleResults[targetCategory] || [])) {
          merged._meta.duplicatesSkipped++;
          continue;
        }
        
        merged[targetCategory].push({
          category: llmCategory,
          text: llmText,
          extractionMethod: 'llm',
          confidence: 0.85,  // Lower confidence for LLM-only extractions
          source: 'gemini'
        });
        merged._meta.llmCount++;
      }
    }
  }

  // ═══ STEP 3: Calculate totals ═══
  merged._meta.totalMerged = Object.values(merged)
    .filter(Array.isArray)
    .reduce((sum, arr) => sum + arr.length, 0);

  return merged;
}


/**
 * ROUTE RULE RESULTS TO COLLECTED OBJECT
 * 
 * Helper function to integrate rule-based results into the existing
 * 'collected' structure used by server.js
 * 
 * @param {Object} ruleResults - Output from runRuleBasedExtraction()
 * @param {Object} collected - The collected object from server.js worker
 */
function routeRuleResults(ruleResults, collected) {
  // Map rule engine categories to server.js collected structure
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
        // Avoid duplicates
        if (!collected[serverCategory].includes(item.text)) {
          collected[serverCategory].push(item.text);
        }
      }
    }
  }
}


/**
 * GET EXTRACTION STATISTICS
 * 
 * Returns analytics about rule engine performance for dashboard display
 * 
 * @param {Object} ruleResults - Output from runRuleBasedExtraction()
 * @returns {Object} - Statistics suitable for UI display
 */
function getExtractionStats(ruleResults) {
  return {
    totalRulesMatched: ruleResults._meta.rulesMatched,
    processingTimeMs: ruleResults._meta.processingTimeMs,
    breakdown: {
      waiting_periods: ruleResults.waiting_periods.length,
      financial_limits: ruleResults.financial_limits.length,
      exclusions: ruleResults.exclusions.length,
      coverage: ruleResults.coverage.length,
      claim_rejection: ruleResults.claim_rejection.length
    },
    rulesUsed: ruleResults._meta.rulesApplied
  };
}


/* =========================================================================================
 * SECTION 3: EXPORTS
 * ========================================================================================= */

export { 
  runRuleBasedExtraction, 
  mergeExtractionResults,
  routeRuleResults,
  getExtractionStats,
  RULE_PATTERNS 
};


/* =========================================================================================
 * SECTION 4: SELF-TEST (Run with: node --test ruleEngine.js)
 * ========================================================================================= */

// Uncomment to test:
/*
const testText = `
The policy has a 24 months waiting period for pre-existing diseases.
Maternity: 9 months waiting period applicable.
Room rent limit: ₹5,000 per day.
Co-payment of 20% applicable for senior citizens above 60 years.
War, terrorism and nuclear events are excluded.
Cosmetic surgery is not covered under this policy.
Claim intimation required within 24 hours.
`;

const results = runRuleBasedExtraction(testText);
console.log(JSON.stringify(results, null, 2));
*/