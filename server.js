/*******************************************************************************************
 * SERVER.JS (v1.8 - REFINED HYBRID ENGINE)
 * ==================================================================================
 * CHANGES FROM v1.7:
 * - Fixed race condition in cross-chunk continuation (sequential rule engine pass)
 * - Fixed fuzzy dedup "keep longer" bug
 * - Added cross-source deduplication (rule engine vs Gemini)
 * - Improved error boundaries
 * - Added processing mode selection (fast/balanced/thorough)
 * - Better logging with timing breakdowns
 *******************************************************************************************/

console.log("=== SERVER.JS FILE LOADED (v1.8 REFINED HYBRID) ===");

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import pdf from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { normalizePolicy } from "./services/normalizePolicy.js";
import { 
  runRuleBasedExtraction, 
  routeRuleResults,
  createDedupeKey,
  calculateSimilarity 
} from "./services/ruleEngine.js";
import { syncToDatabase } from "./services/dbSync.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
  },
  processing: {
    // Processing modes: 'fast', 'balanced', 'thorough'
    defaultMode: 'balanced',
    modes: {
      fast: {
        geminiConcurrency: 8,
        enablePass2: false,
        geminiTimeout: 15000,
        skipLowSignalChunks: true,
      },
      balanced: {
        geminiConcurrency: 5,
        enablePass2: true,
        geminiTimeout: 25000,
        skipLowSignalChunks: false,
      },
      thorough: {
        geminiConcurrency: 3,
        enablePass2: true,
        geminiTimeout: 40000,
        skipLowSignalChunks: false,
      },
    },
  },
  dedup: {
    similarityThreshold: 0.92,
    minRuleLength: 10,
  },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.upload.maxFileSize },
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: EXTERNAL SERVICE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.warn("⚠️  WARNING: Supabase credentials missing. Persistence disabled.");
}

const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repairTextGlue(text) {
  if (!text) return "";
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Timer utility for performance tracking
 */
class Timer {
  constructor() {
    this.marks = {};
    this.start = Date.now();
  }
  
  mark(name) {
    this.marks[name] = Date.now() - this.start;
  }
  
  elapsed() {
    return Date.now() - this.start;
  }
  
  report() {
    return { ...this.marks, total: this.elapsed() };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4.1: IMPROVED FUZZY DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Fuzzy deduplicate an array of strings
 * FIXED: Properly handles "keep longer version" logic
 */
function fuzzyDedup(arr, threshold = CONFIG.dedup.similarityThreshold) {
  if (!Array.isArray(arr)) return [];
  
  const items = [];  // Array of { key, text, index }
  
  // First pass: collect all valid items with their keys
  for (let i = 0; i < arr.length; i++) {
    const text = String(arr[i] || "").trim();
    if (!text || text.length < CONFIG.dedup.minRuleLength) continue;
    
    const key = createDedupeKey(text);
    if (key.length < CONFIG.dedup.minRuleLength) continue;
    
    items.push({ key, text, index: i });
  }
  
  // Second pass: mark duplicates
  const dominated = new Set();  // Indices that are duplicates of something better
  
  for (let i = 0; i < items.length; i++) {
    if (dominated.has(i)) continue;
    
    for (let j = i + 1; j < items.length; j++) {
      if (dominated.has(j)) continue;
      
      // Check exact key match
      if (items[i].key === items[j].key) {
        // Keep longer text
        if (items[j].text.length > items[i].text.length * 1.1) {
          dominated.add(i);
          break;  // i is dominated, stop comparing
        } else {
          dominated.add(j);
        }
        continue;
      }
      
      // Check fuzzy similarity
      const similarity = calculateSimilarity(items[i].text, items[j].text);
      if (similarity >= threshold) {
        // Keep longer text, or first one if similar length
        if (items[j].text.length > items[i].text.length * 1.1) {
          dominated.add(i);
          break;
        } else {
          dominated.add(j);
        }
      }
    }
  }
  
  // Return non-dominated items in original order
  return items
    .filter((_, idx) => !dominated.has(idx))
    .sort((a, b) => a.index - b.index)
    .map(item => item.text);
}

/**
 * Check if a new rule is a duplicate of existing rules
 * Used for cross-source deduplication
 */
function isDuplicateOf(newText, existingTexts, threshold = CONFIG.dedup.similarityThreshold) {
  const newKey = createDedupeKey(newText);
  if (newKey.length < CONFIG.dedup.minRuleLength) return true;  // Too short = skip
  
  for (const existing of existingTexts) {
    const existingKey = createDedupeKey(existing);
    
    // Exact match
    if (newKey === existingKey) return true;
    
    // Fuzzy match
    if (calculateSimilarity(newText, existing) >= threshold) return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 5: SUPABASE PERSISTENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════

async function uploadFileToSupabase(file) {
  if (!supabase) return null;

  try {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { error } = await supabase.storage
      .from("raw-pdfs")
      .upload(safeName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from("raw-pdfs").getPublicUrl(safeName);
    return publicUrl;
  } catch (err) {
    console.error("Storage Error:", err.message);
    return null;
  }
}

async function createJobRecord(filename, fileUrl) {
  if (!supabase) return { id: "local-" + Date.now() };

  try {
    const { data, error } = await supabase
      .from("jobs")
      .insert([{ filename, file_url: fileUrl, status: "PROCESSING" }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error("DB Error:", err.message);
    return { id: "local-" + Date.now() };
  }
}

async function completeJobRecord(jobId, result, meta, stats) {
  if (!supabase || String(jobId).startsWith("local")) return;

  try {
    const { error } = await supabase
      .from("jobs")
      .update({
        status: "COMPLETED",
        result: result,
        meta: { ...meta, stats },
      })
      .eq("id", jobId);

    if (error) throw error;
  } catch (err) {
    console.error("DB Update Error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 6: METADATA EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════════════

function firstNonEmptyLine(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[0] : null;
}

function looksLikeTitleLine(line) {
  if (!line || line.length < 15) return false;
  const lower = line.toLowerCase();
  if (lower.startsWith("exclusions") || lower.startsWith("terms of")) return false;
  return (
    line.includes("|") ||
    /uin[:\s]/i.test(line) ||
    /terms\s*&\s*conditions/i.test(line)
  );
}

function cleanInsurerName(s) {
  if (!s) return null;
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/^insurer\s+(means|mean)\s+/i, "")
    .replace(/^insurer\s+shall\s+mean\s+/i, "")
    .trim();
}

function extractInsurer(text) {
  const top = text.slice(0, 3000);
  const match =
    top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Health Insurance Company Limited)/i) ||
    top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Insurance Company Limited)/i);
  return match?.[1] ? cleanInsurerName(match[1]) : null;
}

function extractPolicyMetadata(text) {
  const firstLine = firstNonEmptyLine(text);
  const policy_name = looksLikeTitleLine(firstLine)
    ? firstLine
    : text.match(/^(.*Policy.*)$/im)?.[1]?.trim() || null;

  return {
    policy_name,
    insurer: extractInsurer(text),
    uin: text.match(/UIN[:\s]*([A-Z0-9]+)/i)?.[1] || null,
    document_type: text.includes("Terms & Conditions") ? "Terms & Conditions" : "Prospectus",
    policy_year: text.match(/(20\d{2})/)?.[1] || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 7: INTELLIGENT CHUNKING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════════

const SECTION_HEADERS = [
  "DEFINITION", "DEFINITIONS", "COVER", "COVERAGE", "BENEFITS",
  "EXCLUSIONS", "WAITING PERIOD", "PRE-EXISTING", "LIMITS",
  "CLAIMS", "CONDITIONS", "TERMS AND CONDITIONS",
];

function splitIntoSections(text) {
  const sections = [];
  const regex = new RegExp(`\\n\\s*(${SECTION_HEADERS.join("|")})[^\\n]*`, "gi");
  let lastIndex = 0, match;
  
  while ((match = regex.exec(text)) !== null) {
    const part = text.slice(lastIndex, match.index).trim();
    if (part.length > 500) sections.push(part);
    lastIndex = match.index;
  }
  sections.push(text.slice(lastIndex).trim());
  return sections;
}

function subChunk(text, size = 1400, overlap = 100) {
  const chunks = [];
  const step = size - overlap;
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function isStructuralLine(line) {
  const t = line.trim();
  if (/^[\s]*[•\-\*]/.test(line)) return true;
  if (/^[\s]*(\d+\.|[a-z]\)|\([a-z]\)|[ivx]+\.)/i.test(line)) return true;
  if (t.startsWith("|") || t.endsWith(":")) return true;
  return false;
}

function cleanRuleTextSmart(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if ((/^[\d\W]+$/.test(t) && t.length < 5) || t.length < 3) continue;
    if (isStructuralLine(line) || t.length > 60 || /[.;!?]$/.test(t)) {
      kept.push(t);
    }
  }
  return kept.join(" ");
}

function createSemanticChunks(text) {
  const sections = splitIntoSections(text);
  const chunks = [];
  let idCounter = 0;
  
  for (const section of sections) {
    for (const piece of subChunk(section, 1400, 100)) {
      const raw = piece.trim();
      if (raw.length < 300) continue;
      
      const hint = classifyChunkHint(raw);
      const glued = repairTextGlue(raw);
      const cleaned = hint === "definitions" ? glued : cleanRuleTextSmart(glued);
      
      if (cleaned.length < 200) continue;
      chunks.push({ id: ++idCounter, hint, raw, text: cleaned });
    }
  }
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 8: CHUNK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════════════

function isDefinitionChunk(text) {
  const t = text.toLowerCase();
  const earlyText = t.slice(0, 150);
  return (
    earlyText.includes(" means ") ||
    earlyText.includes(" is defined as ") ||
    t.includes("definitions")
  );
}

function isHighSignalRuleChunk(text) {
  const signals = ["we will cover", "excluded", "waiting period", "deductible", "limit", "sum insured"];
  return signals.some((s) => text.toLowerCase().includes(s));
}

function classifyChunkHint(text) {
  const t = text.toLowerCase();
  const defScore = (t.match(/means/g) || []).length;
  const ruleScore = (t.match(/cover|exclude|limit/g) || []).length;
  if (defScore >= 2 && defScore >= ruleScore) return "definitions";
  if (ruleScore >= 2) return "rules";
  return "mixed";
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 9: JSON PARSING & VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════════════

function safeJsonParse(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  
  try {
    return JSON.parse(cleaned);
  } catch {}
  
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 10: QUALITY GATES
// ═══════════════════════════════════════════════════════════════════════════════════════

function isJunkRule(text) {
  const t = String(text || "").trim();
  if (t.length < 10) return true;
  if (/^[\d\W]+$/.test(t)) return true;
  if (t.toLowerCase().includes("upload pdf")) return true;
  return false;
}

function isGoodDefinitionPair(term, definition) {
  const t = String(term).trim();
  const d = String(definition).trim();
  if (t.length < 3 || d.length < 10) return false;
  if (t.toLowerCase().includes("accident accident")) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 11: GEMINI AI ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════════════

function getGeminiModel(definitionMode, maxTokens) {
  return genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0,
    },
  });
}

function buildPrompt(mode, text, isBatch = false) {
  if (mode) {
    if (isBatch) {
      return `Extract up to 4 definitions. JSON ONLY. {"type":"definition_batch","definitions":[{"term":"...","definition":"..."}]}. TEXT: ${text}`;
    }
    return `Extract ONE definition. JSON ONLY. {"type":"definition","term":"...","definition":"..."}. TEXT: ${text}`;
  }

  const ruleInstructions = `
  Extract insurance rules. Return valid JSON.
  VALID CATEGORIES:
  - "coverage" (What is covered)
  - "exclusion" (What is NOT covered)
  - "waiting_period" (Time before cover starts)
  - "financial_limit" (Sub-limits, Co-pay, Deductibles, Sum Insured reduction)
  - "claim_rejection" (Reasons for claim denial, fraud, documentation)`;

  if (isBatch) {
    return `${ruleInstructions}\nExtract up to 4 rules.\nFormat: {"type":"rule_batch","rules":[{"type":"CATEGORY","text":"FULL RULE TEXT"}]}\nTEXT: ${text}`;
  }
  return `${ruleInstructions}\nExtract ONE rule. Format: {"type":"CATEGORY","rule":"FULL RULE TEXT"}\nTEXT: ${text}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 12: ROUTING & COLLECTION (WITH CROSS-SOURCE DEDUP)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Route Gemini-parsed results to collected, WITH cross-source deduplication
 */
function routeParsedWithDedup(parsed, collected) {
  if (!parsed || parsed.type === "none") return { storedAny: false, skippedDupes: 0 };

  let stored = false;
  let skippedDupes = 0;

  const addDef = (t, d) => {
    if (isGoodDefinitionPair(t, d)) {
      collected.definitions[t] = d;
      stored = true;
    }
  };

  const addRule = (type, txt) => {
    if (isJunkRule(txt)) return;
    
    // Determine target array
    let targetArray;
    if (type === "coverage") targetArray = collected.coverage;
    else if (type === "exclusion") targetArray = collected.exclusions;
    else if (type === "waiting_period") targetArray = collected.waiting_periods;
    else if (type === "financial_limit") targetArray = collected.financial_limits;
    else if (type === "claim_rejection") targetArray = collected.claim_rejection_conditions;
    else targetArray = collected.coverage;
    
    // Check for duplicates across ALL categories (cross-source dedup)
    const allExisting = [
      ...collected.coverage,
      ...collected.exclusions,
      ...collected.waiting_periods,
      ...collected.financial_limits,
      ...collected.claim_rejection_conditions,
    ];
    
    if (isDuplicateOf(txt, allExisting)) {
      skippedDupes++;
      return;
    }
    
    targetArray.push(txt);
    stored = true;
  };

  if (Array.isArray(parsed.definitions)) {
    parsed.definitions.forEach((d) => addDef(d.term, d.definition));
  } else if (parsed.term) {
    addDef(parsed.term, parsed.definition);
  }

  if (Array.isArray(parsed.rules)) {
    parsed.rules.forEach((r) => addRule(r.type, r.text || r.rule));
  } else if (parsed.rule) {
    addRule(parsed.type, parsed.rule);
  }

  return { storedAny: stored, skippedDupes };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 13: TWO-PHASE EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Phase 1: Sequential rule engine pass (for cross-chunk continuation)
 * This MUST be sequential to maintain fragment continuity
 */
async function runRuleEnginePass(chunks, collected) {
  const stats = {
    totalMatched: 0,
    totalDuplicates: 0,
    processingTimeMs: 0,
    chunksProcessed: 0,
  };
  
  let trailingFragment = null;
  
  console.log("   [Rule Engine] Starting sequential pass...");
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Skip definition chunks
    if (chunk.hint === "definitions" || isDefinitionChunk(chunk.text)) {
      continue;
    }
    
    const ruleResults = runRuleBasedExtraction(chunk.text, {
      similarityThreshold: CONFIG.dedup.similarityThreshold,
      prependFragment: trailingFragment,
      debug: false,
    });
    
    // Capture trailing fragment for next chunk
    trailingFragment = ruleResults?._meta?.trailingFragment || null;
    
    // Safe access to meta
    const meta = ruleResults?._meta || {};
    const rulesMatched = meta.rulesMatched || 0;
    
    if (rulesMatched > 0) {
      routeRuleResults(ruleResults, collected);
      stats.totalMatched += rulesMatched;
      stats.totalDuplicates += meta.duplicatesFound || 0;
    }
    
    stats.processingTimeMs += meta.processingTimeMs || 0;
    stats.chunksProcessed++;
  }
  
  console.log(`   [Rule Engine] Done: ${stats.totalMatched} rules from ${stats.chunksProcessed} chunks (${stats.processingTimeMs}ms)`);
  
  return stats;
}

/**
 * Phase 2: Parallel Gemini pass (definitions + AI rule extraction)
 */
async function runGeminiPass(chunks, collected, modeConfig, isPass2 = false) {
  const stats = {
    parsedChunks: 0,
    failedChunks: 0,
    skippedDupes: 0,
  };
  
  const pass2Candidates = [];
  let index = 0;
  
  const worker = async (workerId) => {
    while (true) {
      const i = index++;
      if (i >= chunks.length) break;
      
      const chunk = chunks[i];
      const defMode = chunk.hint === "definitions" || isDefinitionChunk(chunk.text);
      
      // In fast mode, skip low-signal rule chunks
      if (modeConfig.skipLowSignalChunks && !defMode && !isHighSignalRuleChunk(chunk.text)) {
        continue;
      }
      
      const logPrefix = `[${isPass2 ? "P2" : "P1"} W${workerId}]`;
      console.log(`${logPrefix} Chunk ${i + 1}/${chunks.length} | ${defMode ? "DEF" : "RULE"}`);
      
      const model = getGeminiModel(defMode, isPass2 ? 4096 : 1024);
      const prompt = buildPrompt(defMode, chunk.text, isPass2);
      
      try {
        const result = await withTimeout(
          model.generateContent(prompt),
          modeConfig.geminiTimeout
        );
        const parsed = safeJsonParse(result.response.text());
        
        if (!parsed || parsed.type === "none") {
          if (!isPass2 && (defMode || isHighSignalRuleChunk(chunk.text))) {
            pass2Candidates.push(chunk);
          }
        } else {
          const { storedAny, skippedDupes } = routeParsedWithDedup(parsed, collected);
          if (storedAny) stats.parsedChunks++;
          stats.skippedDupes += skippedDupes;
          
          if (!isPass2 && storedAny && isHighSignalRuleChunk(chunk.text)) {
            pass2Candidates.push(chunk);
          }
        }
      } catch (e) {
        console.error(`${logPrefix} Error: ${e.message}`);
        stats.failedChunks++;
      }
      
      // Small delay to avoid rate limiting
      await sleep(50);
    }
  };
  
  // Run workers in parallel
  const workers = [];
  for (let w = 0; w < modeConfig.geminiConcurrency; w++) {
    workers.push(worker(w + 1));
  }
  await Promise.all(workers);
  
  return { stats, pass2Candidates };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 14: MAIN API ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════════════

app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  console.log("\n" + "═".repeat(70));
  console.log("UPLOAD ENDPOINT HIT");
  console.log("═".repeat(70));
  
  const timer = new Timer();

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF uploaded" });
    }
    
    // Get processing mode from query param or use default
    const mode = req.query.mode || CONFIG.processing.defaultMode;
    const modeConfig = CONFIG.processing.modes[mode] || CONFIG.processing.modes.balanced;
    console.log(`Processing mode: ${mode}`);

    // Step 1: Upload to storage
    console.log("\n1. Uploading to Storage...");
    const publicUrl = await uploadFileToSupabase(req.file);
    console.log(`   -> URL: ${publicUrl || "Skipped (Local)"}`);
    timer.mark("upload");

    // Step 2: Create job record
    console.log("\n2. Creating Job...");
    const job = await createJobRecord(req.file.originalname, publicUrl);
    console.log(`   -> Job ID: ${job.id}`);
    timer.mark("job_created");

    // Step 3: Parse PDF
    console.log("\n3. Parsing PDF...");
    const data = await pdf(req.file.buffer);
    const policyMeta = extractPolicyMetadata(data.text);
    const chunks = createSemanticChunks(data.text);
    console.log(`   -> ${chunks.length} chunks created`);
    console.log(`   -> Policy: ${policyMeta.policy_name || "Unknown"}`);
    timer.mark("pdf_parsed");

    // Initialize collected results
    const collected = {
      definitions: {},
      coverage: [],
      exclusions: [],
      waiting_periods: [],
      financial_limits: [],
      claim_rejection_conditions: [],
    };

    // Step 4: Rule Engine Pass (Sequential for cross-chunk continuation)
    console.log("\n4. Rule Engine Pass (Sequential)...");
    const ruleEngineStats = await runRuleEnginePass(chunks, collected);
    timer.mark("rule_engine");
    
    const afterRuleEngine = {
      coverage: collected.coverage.length,
      exclusions: collected.exclusions.length,
      waiting_periods: collected.waiting_periods.length,
      financial_limits: collected.financial_limits.length,
      claim_rejection: collected.claim_rejection_conditions.length,
    };
    console.log(`   -> After rule engine:`, afterRuleEngine);

    // Step 5: Gemini Pass 1 (Parallel)
    console.log("\n5. Gemini Pass 1 (Parallel)...");
    const { stats: geminiStats1, pass2Candidates } = await runGeminiPass(
      chunks, collected, modeConfig, false
    );
    timer.mark("gemini_pass1");
    console.log(`   -> Parsed: ${geminiStats1.parsedChunks}, Failed: ${geminiStats1.failedChunks}, Dupes skipped: ${geminiStats1.skippedDupes}`);

    // Step 6: Gemini Pass 2 (if enabled and candidates exist)
    let geminiStats2 = { parsedChunks: 0, failedChunks: 0, skippedDupes: 0 };
    
    if (modeConfig.enablePass2 && pass2Candidates.length > 0) {
      console.log(`\n6. Gemini Pass 2 (${pass2Candidates.length} candidates)...`);
      const uniqueCandidates = [...new Map(pass2Candidates.map(c => [c.id, c])).values()];
      const result = await runGeminiPass(uniqueCandidates, collected, modeConfig, true);
      geminiStats2 = result.stats;
      timer.mark("gemini_pass2");
      console.log(`   -> Parsed: ${geminiStats2.parsedChunks}, Failed: ${geminiStats2.failedChunks}`);
    } else {
      console.log("\n6. Gemini Pass 2 skipped");
      timer.mark("gemini_pass2");
    }

    // Step 7: Final fuzzy deduplication
    console.log("\n7. Final Fuzzy Deduplication...");
    const beforeDedup = {
      coverage: collected.coverage.length,
      exclusions: collected.exclusions.length,
      waiting_periods: collected.waiting_periods.length,
      financial_limits: collected.financial_limits.length,
      claim_rejection_conditions: collected.claim_rejection_conditions.length,
    };

    collected.coverage = fuzzyDedup(collected.coverage);
    collected.exclusions = fuzzyDedup(collected.exclusions);
    collected.waiting_periods = fuzzyDedup(collected.waiting_periods);
    collected.financial_limits = fuzzyDedup(collected.financial_limits);
    collected.claim_rejection_conditions = fuzzyDedup(collected.claim_rejection_conditions);

    const afterDedup = {
      coverage: collected.coverage.length,
      exclusions: collected.exclusions.length,
      waiting_periods: collected.waiting_periods.length,
      financial_limits: collected.financial_limits.length,
      claim_rejection_conditions: collected.claim_rejection_conditions.length,
    };

    const totalRemoved = Object.keys(beforeDedup).reduce(
      (sum, key) => sum + (beforeDedup[key] - afterDedup[key]), 0
    );
    console.log(`   -> Removed ${totalRemoved} near-duplicates`);
    timer.mark("dedup");

    // Step 8: Build output structures
    console.log("\n8. Building Output...");
    const cpdm = buildCPDM(policyMeta, collected);
    const normalized = normalizePolicy([{
      coverage: collected.coverage,
      exclusions: collected.exclusions,
      waiting_periods: collected.waiting_periods,
      financials: collected.financial_limits,
      claim_risks: collected.claim_rejection_conditions,
    }]);
    timer.mark("build_output");

    // Step 9: Save results
    console.log("\n9. Saving Results...");
    const allStats = {
      ruleEngine: ruleEngineStats,
      geminiPass1: geminiStats1,
      geminiPass2: geminiStats2,
      dedup: { before: beforeDedup, after: afterDedup, removed: totalRemoved },
      timing: timer.report(),
    };
    
    await completeJobRecord(job.id, cpdm, policyMeta, allStats);

    // Calculate health score
    const exclusionCount = cpdm.rules.filter(r => r.category === "exclusion").length;
    const riskCount = cpdm.rules.filter(r => r.category === "claim_rejection").length;
    const coverageCount = cpdm.rules.filter(r => r.category === "coverage").length;
    
    const rawScore = 100 + coverageCount * 1.5 - exclusionCount * 2 - riskCount * 1.5;
    const healthScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Sync to database
    syncToDatabase(job.id, policyMeta, cpdm, healthScore);
    timer.mark("saved");

    // Final summary
    console.log("\n" + "═".repeat(70));
    console.log("PROCESSING COMPLETE");
    console.log("═".repeat(70));
    console.log(`Total time: ${timer.elapsed()}ms`);
    console.log(`Rules extracted: ${cpdm.rules.length}`);
    console.log(`Definitions: ${Object.keys(collected.definitions).length}`);
    console.log(`Health score: ${healthScore}`);
    console.log("═".repeat(70) + "\n");

    res.json({
      message: "Analysis Complete",
      jobId: job.id,
      fileUrl: publicUrl,
      meta: {
        ...policyMeta,
        processingMode: mode,
        totalChunks: chunks.length,
        stats: allStats,
      },
      definitions: collected.definitions,
      normalized,
      cpdm,
      healthScore,
    });

  } catch (e) {
    console.error("\n❌ ERROR:", e);
    console.error(e.stack);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 15: CPDM BUILDER
// ═══════════════════════════════════════════════════════════════════════════════════════

function buildCPDM(policyMeta, collected) {
  const definitions = Object.entries(collected.definitions).map(([term, definition]) => ({
    term,
    definition,
  }));

  const rules = [
    ...collected.coverage.map(text => ({ category: "coverage", text })),
    ...collected.exclusions.map(text => ({ category: "exclusion", text })),
    ...collected.waiting_periods.map(text => ({ category: "waiting_period", text })),
    ...collected.financial_limits.map(text => ({ category: "financial_limit", text })),
    ...collected.claim_rejection_conditions.map(text => ({ category: "claim_rejection", text })),
  ];

  return {
    meta: policyMeta,
    definitions,
    rules,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 16: HEALTH CHECK & START SERVER
// ═══════════════════════════════════════════════════════════════════════════════════════

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.8",
    supabase: !!supabase,
    gemini: !!process.env.GEMINI_API_KEY,
  });
});

app.listen(3000, () => {
  console.log("\n" + "═".repeat(70));
  console.log("SERVER STARTED");
  console.log("═".repeat(70));
  console.log("Port: 3000");
  console.log("Version: 1.8 (Refined Hybrid)");
  console.log("Supabase:", supabase ? "Connected" : "Disabled");