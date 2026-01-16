# AI Web App: Copilot Instructions

## Project Overview
Insurance Policy AI Analyzer — A Node.js/Express backend that extracts structured intelligence (definitions, coverage rules, exclusions) from PDF policy documents using Google's Gemini API.

**Design Philosophy**: AI is a *tool*, not the product. Determinism + structure + normalization ARE the product.

## Architecture: Three-Tier Processing Pipeline

### Tier 1: Metadata Extraction (Deterministic, No AI)
[server.js](server.js#L120-L165) — Extracts policy identity without AI:
- Policy name (from title detection)
- Insurer name (regex pattern matching: "X Insurance Company Limited")
- UIN, document type, policy year

See: `extractPolicyMetadata()`, `extractInsurer()`

### Tier 2: Semantic Chunking (Deterministic, No AI)
[server.js](server.js#L175-L270) — Splits policy into overlapping chunks optimized for AI:
- **Section-based splitting**: Detects major sections (DEFINITIONS, COVERAGE, EXCLUSIONS, LIMITS, CLAIMS, etc.)
- **Sub-chunking with overlap** (1400 chars, 100-char overlap) — fixes truncation bugs where definitions get cut off
- **Smart garbage filtering**: Removes OCR artifacts (isolated digits, page numbers "5.", "12")
- **Text glue repair**: Fixes "typicalclinical" → "typical clinical" (PDF font-style merge artifacts)

See: `createSemanticChunks()`, `subChunk()`, `cleanRuleTextSmart()`, `repairTextGlue()`

**Why overlap?** Insurance text isn't neatly aligned with chunks. Overlap prevents losing critical info at boundaries.

### Tier 3: AI Extraction (Two-Pass Concurrent Strategy)

#### **Pass 1: Worker Pool Extraction** (5 concurrent workers)
[server.js](server.js#L580-L680) — High-throughput, single-item extraction:
- Each worker grabs chunks from atomic queue (no duplicates)
- Per-chunk classification: definitions vs. rules
- **Single-item extraction** (1 definition OR 1 rule per call)
- Per-chunk timeout: 30 seconds; global throttle: 100ms between calls

Models used:
- Definitions: Gemini 2.5 Flash, 1536 max tokens
- Rules: Gemini 2.5 Flash, 1024 max tokens

#### **Pass 2: Targeted Batch Extraction**
[server.js](server.js#L695-L725) — Higher-signal, serial batch mode:
- Only runs on chunks that yielded results in Pass 1
- Also on high-signal chunks (even if Pass 1 failed)
- Batch extraction: up to 4 items per prompt
- Higher token limits (4096 for defs, 2048 for rules)

**Why two passes?** Pass 1 is fast (5 workers), Pass 2 catches missed definitions without re-scanning the entire policy.

### Tier 4: Normalization (Deterministic, No AI)
[normalizePolicy.js](services/normalizePolicy.js) — Post-AI processing:
- **Deduplication**: Fuzzy deterministic (lowercased + punctuation stripped for matching)
- **Category bucketing**: coverage, exclusions, waiting_periods, financial_limits, claim_rejection_conditions
- **No rewriting**: Just merging and filtering

[definitionRegistry.js](services/definitionRegistry.js) — Definition canonicalization:
- Maps variant terms to stable keys: "Room Rent" → `room_rent`
- **Canonical map** (hand-curated): Aliases for insurance synonyms (hospitalised/hospitalized, etc.)
- Slugified keys for UI/database safety

## Critical Patterns & Workflows

### Chunking Strategy (Server-Specific)
```javascript
// NOT: sentence-by-sentence (loses context)
// NOT: random page breaks (cuts definitions in half)
// YES: section-based → semantic overlap

createSemanticChunks(text) {
  const sections = splitIntoSections(text);      // By section headers
  for (const section of sections) {
    for (const piece of subChunk(section, 1400, 100)) {  // 100-char overlap
      // ... classify and clean
    }
  }
}
```

### AI Prompt Design (Minimal, Deterministic JSON Output)
[server.js](server.js#L490-L560):
- **No markdown in output**: `"Return ONLY valid JSON. Do NOT use markdown."`
- **Explicit type field**: `{"type":"definition","term":"...","definition":"..."}`
- **Fail-safe defaults**: `{"type":"none"}` for unparseable chunks

Gemini tends to wrap JSON in markdown. We strip it aggressively in `safeJsonParse()`.

### Quality Gates (Post-Extraction)
[server.js](server.js#L405-L440) — Before storing AI output:
- `looksLikeBrokenOCRTerm()`: Rejects terms < 3 chars, or suspicious suffixes ("farction" for "infarction")
- `isGoodDefinitionPair()`: Requires definition ≥ 12 chars + context signals (contains "means", "is", etc.)
- Dedup by **normalized key** (lowercase, no punct)

## Running the Project

### Setup
```bash
npm install
# Create .env with: GEMINI_API_KEY=your_api_key
npm start
# Server runs on http://localhost:3000
```

### Endpoints
- **POST `/upload-pdf`**: Form-data with `pdf` file → JSON response
  - Response includes: `meta`, `definitions`, `normalized`, `cpdm`, metrics
- **POST `/analyze`** (in index.html): text → AI analysis (basic, not primary flow)

### Testing Flow
1. Open [upload.html](upload.html) → select a PDF
2. Server logs timing: "PASS 1 COMPLETE", "PASS 2 START", "PASS 2 COMPLETE"
3. Check metrics: `parsedChunks`, `failedChunks`, `skippedChunks`, `pass2Candidates`

## Common Gotchas & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Definitions cut off mid-sentence | Chunks too small, no overlap | Increased chunk overlap to 100 chars (v1.2) |
| "typicalclinical" instead of "typical clinical" | PDF font style change merges words | `repairTextGlue()` fixes camelCase artifacts |
| Garbage like "5." as extracted text | OCR page numbers bleed into chunks | `cleanRuleTextSmart()` filters lines matching `^[\d\W]+$` |
| Gemini wraps JSON in markdown | Model defaults | `safeJsonParse()` strips ```json``` markers |
| Duplicate definitions (different cases) | Definitions stored with original case | Dedup by normalized key in `normalizePolicy.js` |

## Expansion Points for Contributors

1. **Add definitions to registry**: [definitionRegistry.js](services/definitionRegistry.js#L95+) — New aliases auto-map to canonical keys
2. **Tweak concurrency**: Change `CONCURRENCY_LIMIT` in [server.js](server.js#L611) (default: 5 workers)
3. **Adjust chunk size**: `subChunk(section, 1400, 100)` — increase if losing context, decrease for speed
4. **Add rule categories**: Add switch case in `routeParsedIntoBuckets()` for new `parsed.type` values
5. **Disable Pass 2**: Set `PASS2_ENABLED = false` if time-constrained (loses coverage)

## Canonical Data Model (CPDM)
[server.js](server.js#L450-L463) — Final output structure:
```javascript
{
  meta: { policy_name, insurer, uin, document_type, policy_year, pages, ... },
  definitions: [{ term, definition }, ...],
  rules: [
    { category: "coverage", text: "..." },
    { category: "exclusion", text: "..." },
    { category: "waiting_period", text: "..." },
    { category: "financial_limit", text: "..." },
    { category: "claim_rejection", text: "..." }
  ]
}
```

This is the contract between backend and UI/database layers.
