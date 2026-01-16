/*******************************************************************************************
 *
 * SERVER.JS (v1.5 INTEGRATED - CACHING & PROGRESS)
 * ===============================================
 *
 * HISTORY:
 * - v1.4: Added Supabase Persistence (Storage + DB).
 * - v1.5 (CURRENT): Added Duplicate Check (Feature 3) and optimized worker pool.
 *
 *******************************************************************************************/

console.log("=== SERVER.JS FILE LOADED (v1.5 INTEGRATED) ===");

// ==========================================================================================
// ZONE 0: IMPORTS & CONFIGURATION
// ==========================================================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import pdf from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from '@supabase/supabase-js'; 
import { normalizePolicy } from "./services/normalizePolicy.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- SUPABASE SETUP (NEW) ---
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.warn("⚠️  WARNING: Supabase credentials missing. Persistence disabled.");
}
const supabase = process.env.SUPABASE_URL 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) 
  : null;


// ==========================================================================================
// ZONE 1: UTILITIES
// ==========================================================================================

function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), ms))
  ]);
}

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function repairTextGlue(text) {
  if (!text) return "";
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ==========================================================================================
// ZONE 1.5: SUPABASE HELPERS (NEW)
// ==========================================================================================

async function uploadFileToSupabase(file) {
  if (!supabase) return null;
  try {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('raw-pdfs')
      .upload(safeName, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from('raw-pdfs').getPublicUrl(safeName);
    return publicUrl;
  } catch (err) {
    console.error("Storage Error:", err.message);
    return null;
  }
}

async function createJobRecord(filename, fileUrl) {
  if (!supabase) return { id: 'local-' + Date.now() };
  try {
    const { data, error } = await supabase
      .from('jobs')
      .insert([{ filename, file_url: fileUrl, status: 'PROCESSING' }])
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("DB Error:", err.message);
    return { id: 'local-' + Date.now() };
  }
}

async function completeJobRecord(jobId, result, meta, stats) {
  if (!supabase || jobId.startsWith('local')) return;
  try {
    const { error } = await supabase
      .from('jobs')
      .update({ 
        status: 'COMPLETED',
        result: result, 
        meta: { ...meta, stats }
      })
      .eq('id', jobId);
    if (error) throw error;
  } catch (err) {
    console.error("DB Update Error:", err.message);
  }
}


// ==========================================================================================
// ZONE 2: METADATA EXTRACTION
// ==========================================================================================

function firstNonEmptyLine(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.length ? lines[0] : null;
}

function looksLikeTitleLine(line) {
  if (!line || line.length < 15) return false;
  const lower = line.toLowerCase();
  if (lower.startsWith("exclusions") || lower.startsWith("terms of")) return false;
  return line.includes("|") || /uin[:\s]/i.test(line) || /terms\s*&\s*conditions/i.test(line);
}

function cleanInsurerName(s) {
  if (!s) return null;
  return String(s).replace(/\s+/g, " ")
    .replace(/^insurer\s+(means|mean)\s+/i, "")
    .replace(/^insurer\s+shall\s+mean\s+/i, "")
    .trim();
}

function extractInsurer(text) {
  const top = text.slice(0, 3000);
  const match = top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Health Insurance Company Limited)/i) ||
                top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Insurance Company Limited)/i);
  return match?.[1] ? cleanInsurerName(match[1]) : null;
}

function extractPolicyMetadata(text) {
  const firstLine = firstNonEmptyLine(text);
  const policy_name = looksLikeTitleLine(firstLine) ? firstLine : (text.match(/^(.*Policy.*)$/im)?.[1]?.trim() || null);
  return {
    policy_name,
    insurer: extractInsurer(text),
    uin: text.match(/UIN[:\s]*([A-Z0-9]+)/i)?.[1] || null,
    document_type: text.includes("Terms & Conditions") ? "Terms & Conditions" : "Prospectus",
    policy_year: text.match(/(20\d{2})/)?.[1] || null
  };
}


// ==========================================================================================
// ZONE 3: CHUNKING
// ==========================================================================================

const SECTION_HEADERS = [
  "DEFINITION", "DEFINITIONS", "COVER", "COVERAGE", "BENEFITS", "EXCLUSIONS",
  "WAITING PERIOD", "PRE-EXISTING", "LIMITS", "CLAIMS", "CONDITIONS", "TERMS AND CONDITIONS"
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
    if (isStructuralLine(line) || t.length > 60 || /[.;!?]$/.test(t)) kept.push(t);
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


// ==========================================================================================
// ZONE 4: CLASSIFICATION
// ==========================================================================================

function isDefinitionChunk(text) {
  const t = text.toLowerCase();
  const earlyText = t.slice(0, 150); 
  return earlyText.includes(" means ") || earlyText.includes(" is defined as ") || t.includes("definitions");
}

function isHighSignalRuleChunk(text) {
  const signals = ["we will cover", "excluded", "waiting period", "deductible", "limit", "sum insured"];
  return signals.some(s => text.toLowerCase().includes(s));
}

function classifyChunkHint(text) {
  const t = text.toLowerCase();
  const defScore = (t.match(/means/g) || []).length;
  const ruleScore = (t.match(/cover|exclude|limit/g) || []).length;
  if (defScore >= 2 && defScore >= ruleScore) return "definitions";
  if (ruleScore >= 2) return "rules";
  return "mixed";
}


// ==========================================================================================
// ZONE 5: JSON PARSING
// ==========================================================================================

function safeJsonParse(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const firstBrace = cleaned.indexOf("{"), lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch { return null; }
}


// ==========================================================================================
// ZONE 6: QUALITY GATES
// ==========================================================================================

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


// ==========================================================================================
// ZONE 7: GEMINI
// ==========================================================================================

function getGeminiModel(definitionMode, maxTokens) {
  return genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0 }
  });
}

function buildPrompt(mode, text, isBatch = false) {
  if (mode) {
    if (isBatch) return `Extract up to 4 definitions. JSON ONLY. {"type":"definition_batch","definitions":[{"term":"...","definition":"..."}]}. TEXT: ${text}`;
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

  if (isBatch) return `${ruleInstructions}\nExtract up to 4 rules.\nFormat: {"type":"rule_batch","rules":[{"type":"CATEGORY","text":"FULL RULE TEXT"}]}\nTEXT: ${text}`;
  return `${ruleInstructions}\nExtract ONE rule. Format: {"type":"CATEGORY","rule":"FULL RULE TEXT"}\nTEXT: ${text}`;
}

function routeParsed(parsed, collected) {
  if (!parsed || parsed.type === "none") return { storedAny: false };
  let stored = false;

  const addDef = (t, d) => { if (isGoodDefinitionPair(t, d)) { collected.definitions[t] = d; stored = true; }};
  const addRule = (type, txt) => {
    if (isJunkRule(txt)) return;
    stored = true;
    if (type === "coverage") collected.coverage.push(txt);
    else if (type === "exclusion") collected.exclusions.push(txt);
    else if (type === "waiting_period") collected.waiting_periods.push(txt);
    else if (type === "financial_limit") collected.financial_limits.push(txt);
    else if (type === "claim_rejection") collected.claim_rejection_conditions.push(txt);
    else collected.coverage.push(txt);
  };

  if (Array.isArray(parsed.definitions)) parsed.definitions.forEach(d => addDef(d.term, d.definition));
  else if (parsed.term) addDef(parsed.term, parsed.definition);
  if (Array.isArray(parsed.rules)) parsed.rules.forEach(r => addRule(r.type, r.text || r.rule));
  else if (parsed.rule) addRule(parsed.type, parsed.rule);

  return { storedAny: stored };
}


// ==========================================================================================
// ZONE 8: MAIN ROUTE (INTEGRATED)
// ==========================================================================================

app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  console.log("UPLOAD ENDPOINT HIT");
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    // --- FEATURE 3: CACHING / DUPLICATE CHECK ---
    if (supabase) {
      const { data: existing } = await supabase
        .from('jobs')
        .select('*')
        .eq('filename', req.file.originalname)
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        console.log("CACHE HIT: Returning existing report for", req.file.originalname);
        return res.json({
          message: "Report available in library",
          isCached: true,
          ...existing[0].result,
          meta: existing[0].meta
        });
      }
    }

    // --- 1. PERSISTENCE ---
    console.log("1. Uploading raw PDF to Supabase...");
    const publicUrl = await uploadFileToSupabase(req.file);
    console.log("   -> Raw URL:", publicUrl);

    console.log("2. Creating database record...");
    const job = await createJobRecord(req.file.originalname, publicUrl);
    console.log("   -> Record ID:", job.id);

    // --- 2. PROCESSING ---
    console.log("3. Parsing PDF text...");
    const data = await pdf(req.file.buffer);
    const policyMeta = extractPolicyMetadata(data.text);
    console.log("   -> Metadata extracted:", policyMeta.policy_name);
    
    const chunks = createSemanticChunks(data.text);
    console.log(`TOTAL SEMANTIC CHUNKS GENERATED: ${chunks.length}`);

    const collected = { definitions: {}, coverage: [], exclusions: [], waiting_periods: [], financial_limits: [], claim_rejection_conditions: [] };
    let parsedChunks = 0, failedChunks = 0;
    const pass2Candidates = [];

    const runWorkerPool = async (tasks, concurrency, isPass2 = false) => {
      let index = 0;
      const workers = [];
      const worker = async (id) => {
        while (true) {
          const i = index++;
          if (i >= tasks.length) break;
          const task = tasks[i];
          const defMode = task.hint === "definitions" || isDefinitionChunk(task.text);
          console.log(`[${isPass2 ? 'P2' : 'P1'} Worker ${id}] Processing ${i+1}/${tasks.length} | Mode: ${defMode ? 'DEF' : 'RULE'}`);
          
          const model = getGeminiModel(defMode, isPass2 ? 4096 : 1024);
          const prompt = buildPrompt(defMode, task.text, isPass2);
          try {
            const result = await withTimeout(model.generateContent(prompt), 30000);
            const parsed = safeJsonParse(result.response.text());
            if (!parsed || parsed.type === "none") {
              if (!isPass2 && (defMode || isHighSignalRuleChunk(task.text))) pass2Candidates.push(task);
            } else {
              const { storedAny } = routeParsed(parsed, collected);
              if (storedAny) parsedChunks++;
              if (!isPass2 && storedAny && isHighSignalRuleChunk(task.text)) pass2Candidates.push(task);
            }
          } catch (e) {
            console.error(`[Worker ${id}] Chunk Failed:`, e.message);
            failedChunks++;
          }
          await sleep(50);
        }
      };
      for (let w = 0; w < concurrency; w++) workers.push(worker(w + 1));
      await Promise.all(workers);
    };

    console.log("4. Starting Worker Pool (Pass 1)...");
    await runWorkerPool(chunks, 5); 
    console.log(`PASS 1 DONE. Success: ${parsedChunks}, Fail: ${failedChunks}, Candidates for P2: ${pass2Candidates.length}`);

    if (pass2Candidates.length > 0) {
      const uniqueTasks = [...new Map(pass2Candidates.map(item => [item.id, item])).values()];
      console.log(`5. Starting High-Intensity Pass 2 with ${uniqueTasks.length} candidates...`);
      await runWorkerPool(uniqueTasks, 5, true);
    }

    // --- 3. FINALIZE ---
    console.log("6. Finalizing and Deduplicating Rules...");
    const dedup = (arr) => [...new Set(arr.map(s => String(s).trim()))];
    collected.coverage = dedup(collected.coverage);
    collected.exclusions = dedup(collected.exclusions);
    collected.waiting_periods = dedup(collected.waiting_periods);
    collected.financial_limits = dedup(collected.financial_limits);
    collected.claim_rejection_conditions = dedup(collected.claim_rejection_conditions);

    console.log("7. Normalizing Policy Structure...");
    const cpdm = buildCPDM(policyMeta, collected);
    const normalized = normalizePolicy([{
        coverage: collected.coverage,
        exclusions: collected.exclusions,
        waiting_periods: collected.waiting_periods,
        financials: collected.financial_limits,
        claim_risks: collected.claim_rejection_conditions
    }]);

    // --- 4. SAVE RESULT ---
    console.log("8. Saving final result to database...");
    await completeJobRecord(job.id, { cpdm, normalized, definitions: collected.definitions }, policyMeta, { parsedChunks, failedChunks });
    console.log("🚀 JOB COMPLETE.");

    res.json({
      message: "Analysis Complete",
      jobId: job.id,
      isCached: false,
      meta: { ...policyMeta, totalChunks: chunks.length, parsedChunks, failedChunks },
      definitions: collected.definitions,
      normalized,
      cpdm
    });

  } catch (e) {
    console.error("⛔ EXTREME FAILURE:", e.stack);
    res.status(500).json({ error: e.message });
  }
});

function buildCPDM(policyMeta, collected) {
  const definitions = Object.entries(collected.definitions).map(([term, definition]) => ({ term, definition }));
  const rules = [
    ...collected.coverage.map(text => ({ category: "coverage", text })),
    ...collected.exclusions.map(text => ({ category: "exclusion", text })),
    ...collected.waiting_periods.map(text => ({ category: "waiting_period", text })),
    ...collected.financial_limits.map(text => ({ category: "financial_limit", text })),
    ...collected.claim_rejection_conditions.map(text => ({ category: "claim_rejection", text }))
  ];
  return { meta: policyMeta, definitions, rules };
}

app.listen(3000, () => console.log("Server running on port 3000. Listening for PDF audits..."));