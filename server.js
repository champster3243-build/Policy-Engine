/*******************************************************************************************
 * SERVER.JS (v1.6 - HYBRID ENGINE + KNOWLEDGE GRAPH SYNC)
 * ==================================================================================
 * * PURPOSE: Backend for Policy Analysis with Rule Engine & SQL Normalization.
 * * ARCHITECTURE OVERVIEW:
 * ┌─────────────┐      ┌──────────────┐      ┌─────────────┐      ┌──────────────┐
 * │   Client    │─────▶│   Express    │─────▶│   Gemini    │─────▶│   Supabase   │
 * │ (Next.js)   │◀─────│   Server     │◀─────│  AI Model   │◀─────│  (DB + SQL)  │
 * └─────────────┘      └──────────────┘      └─────────────┘      └──────────────┘
 * * * FEATURES:
 * 1. HYBRID EXTRACTION: Regex Rules (Fast) + Gemini AI (Smart)
 * 2. TWO-PASS LOGIC: Cost-efficient scanning and deep analysis
 * 3. DB SYNC: Normalizes results into 'policies' and 'policy_rules' tables for querying
 * *******************************************************************************************/

console.log("=== SERVER.JS FILE LOADED (v1.6 HYBRID + DB SYNC) ===");

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors"; // Allows cross-origin requests from frontend
import dotenv from "dotenv"; // Loads environment variables from .env file
import multer from "multer"; // Handles file uploads (PDFs in our case)
import pdf from "pdf-parse"; // Extracts raw text from PDF files
import { GoogleGenerativeAI } from "@google/generative-ai"; // Gemini AI SDK
import { createClient } from "@supabase/supabase-js"; // Database & Storage
import { normalizePolicy } from "./services/normalizePolicy.js"; // Custom normalization logic
import { runRuleBasedExtraction, routeRuleResults } from "./services/ruleEngine.js"; // Rule Engine
import { syncToDatabase } from "./services/dbSync.js"; // Knowledge Graph Sync

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: FILE UPLOAD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
      setTimeout(() => reject(new Error("Gemini timeout")), ms)
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 5: SUPABASE PERSISTENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════

async function uploadFileToSupabase(file) {
  if (!supabase) return null;

  try {
    const safeName = `${Date.now()}-${file.originalname.replace(
      /[^a-zA-Z0-9.-]/g,
      "_"
    )}`;

    const { error } = await supabase.storage
      .from("raw-pdfs")
      .upload(safeName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from("raw-pdfs").getPublicUrl(safeName);

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
  if (!supabase || jobId.startsWith("local")) return;

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
    top.match(
      /([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Health Insurance Company Limited)/i
    ) ||
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
    document_type: text.includes("Terms & Conditions")
      ? "Terms & Conditions"
      : "Prospectus",
    policy_year: text.match(/(20\d{2})/)?.[1] || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 7: INTELLIGENT CHUNKING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════════

const SECTION_HEADERS = [
  "DEFINITION",
  "DEFINITIONS",
  "COVER",
  "COVERAGE",
  "BENEFITS",
  "EXCLUSIONS",
  "WAITING PERIOD",
  "PRE-EXISTING",
  "LIMITS",
  "CLAIMS",
  "CONDITIONS",
  "TERMS AND CONDITIONS",
];

function splitIntoSections(text) {
  const sections = [];
  const regex = new RegExp(`\\n\\s*(${SECTION_HEADERS.join("|")})[^\\n]*`, "gi");
  let lastIndex = 0,
    match;
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
  const signals = [
    "we will cover",
    "excluded",
    "waiting period",
    "deductible",
    "limit",
    "sum insured",
  ];
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
// SECTION 12: ROUTING & COLLECTION
// ═══════════════════════════════════════════════════════════════════════════════════════

function routeParsed(parsed, collected) {
  if (!parsed || parsed.type === "none") return { storedAny: false };

  let stored = false;

  const addDef = (t, d) => {
    if (isGoodDefinitionPair(t, d)) {
      collected.definitions[t] = d;
      stored = true;
    }
  };

  const addRule = (type, txt) => {
    if (isJunkRule(txt)) return;
    stored = true;
    if (type === "coverage") collected.coverage.push(txt);
    else if (type === "exclusion") collected.exclusions.push(txt);
    else if (type === "waiting_period") collected.waiting_periods.push(txt);
    else if (type === "financial_limit") collected.financial_limits.push(txt);
    else if (type === "claim_rejection")
      collected.claim_rejection_conditions.push(txt);
    else collected.coverage.push(txt);
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

  return { storedAny: stored };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 13: MAIN API ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════════════

app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  console.log("UPLOAD ENDPOINT HIT");

  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    console.log("1. Uploading to Storage...");
    const publicUrl = await uploadFileToSupabase(req.file);
    console.log(`   -> URL: ${publicUrl || "Skipped (Local)"}`);

    console.log("2. Creating Job...");
    const job = await createJobRecord(req.file.originalname, publicUrl);
    console.log(`   -> Job ID: ${job.id}`);

    const data = await pdf(req.file.buffer);
    const policyMeta = extractPolicyMetadata(data.text);
    const chunks = createSemanticChunks(data.text);
    console.log(`TOTAL CHUNKS: ${chunks.length}`);

    const collected = {
      definitions: {},
      coverage: [],
      exclusions: [],
      waiting_periods: [],
      financial_limits: [],
      claim_rejection_conditions: [],
    };

    let parsedChunks = 0;
    let failedChunks = 0;
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

          console.log(
            `[${isPass2 ? "P2" : "P1"} Worker ${id}] Processing ${i + 1}/${tasks.length} | Mode: ${
              defMode ? "DEF" : "RULE"
            }`
          );

          // ════ HYBRID STRATEGY (Phase 1) ════
          // 1. RUN RULE ENGINE FIRST (Instant, Free)
          if (!defMode) {
            const ruleResults = runRuleBasedExtraction(task.text);

            if (ruleResults?._meta?.rulesMatched > 0) {
              // ✅ FIX: rulesApplied may be undefined, so never call .join() blindly
              const applied = Array.isArray(ruleResults._meta.rulesApplied)
                ? ruleResults._meta.rulesApplied.join(", ")
                : "state_machine_v4";

              console.log(`   -> ⚡ Rules Found: ${ruleResults._meta.rulesMatched} (${applied})`);

              routeRuleResults(ruleResults, collected);
            }
          }

          // 2. RUN AI ENGINE (Gemini)
          const model = getGeminiModel(defMode, isPass2 ? 4096 : 1024);
          const prompt = buildPrompt(defMode, task.text, isPass2);

          try {
            const result = await withTimeout(model.generateContent(prompt), 30000);
            const parsed = safeJsonParse(result.response.text());

            if (!parsed || parsed.type === "none") {
              if (!isPass2 && (defMode || isHighSignalRuleChunk(task.text))) {
                pass2Candidates.push(task);
              }
            } else {
              const { storedAny } = routeParsed(parsed, collected);
              if (storedAny) parsedChunks++;
              if (!isPass2 && storedAny && isHighSignalRuleChunk(task.text)) {
                pass2Candidates.push(task);
              }
            }
          } catch (e) {
            console.error(`[Worker ${id}] Error:`, e.message);
            failedChunks++;
          }

          await sleep(100);
        }
      };

      for (let w = 0; w < concurrency; w++) workers.push(worker(w + 1));
      await Promise.all(workers);
    };

    await runWorkerPool(chunks, 5);
    console.log(`PASS 1 DONE. Candidates for P2: ${pass2Candidates.length}`);

    if (pass2Candidates.length > 0) {
      const uniqueTasks = [...new Map(pass2Candidates.map((item) => [item.id, item])).values()];
      console.log(`STARTING PASS 2 with ${uniqueTasks.length} chunks...`);
      await runWorkerPool(uniqueTasks, 5, true);
    }

    const dedup = (arr) => [...new Set(arr.map((s) => String(s).trim()))];
    collected.coverage = dedup(collected.coverage);
    collected.exclusions = dedup(collected.exclusions);
    collected.waiting_periods = dedup(collected.waiting_periods);
    collected.financial_limits = dedup(collected.financial_limits);
    collected.claim_rejection_conditions = dedup(collected.claim_rejection_conditions);

    const cpdm = buildCPDM(policyMeta, collected);
    const normalized = normalizePolicy([
      {
        coverage: collected.coverage,
        exclusions: collected.exclusions,
        waiting_periods: collected.waiting_periods,
        financials: collected.financial_limits,
        claim_risks: collected.claim_rejection_conditions,
      },
    ]);

    console.log("3. Saving Results...");

    await completeJobRecord(job.id, cpdm, policyMeta, { parsedChunks, failedChunks });

    const totalRules = cpdm.rules.length || 1;
    const exclusions = cpdm.rules.filter((r) => r.category === "exclusion").length;
    const risks = cpdm.rules.filter((r) => r.category === "claim_rejection").length;
    const coverage = cpdm.rules.filter((r) => r.category === "coverage").length;

    let rawScore = 100 + coverage * 1.5 - exclusions * 2 - risks * 1.5;
    const healthScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    syncToDatabase(job.id, policyMeta, cpdm, healthScore);

    console.log("   -> Saved & Syncing...");

    res.json({
      message: "Analysis Complete",
      jobId: job.id,
      fileUrl: publicUrl,
      meta: { ...policyMeta, totalChunks: chunks.length, parsedChunks, failedChunks },
      definitions: collected.definitions,
      normalized,
      cpdm,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 14: CPDM BUILDER
// ═══════════════════════════════════════════════════════════════════════════════════════

function buildCPDM(policyMeta, collected) {
  const definitions = Object.entries(collected.definitions).map(([term, definition]) => ({
    term,
    definition,
  }));

  const coverages = collected.coverage.map((text) => ({ category: "coverage", text }));
  const exclusions = collected.exclusions.map((text) => ({ category: "exclusion", text }));
  const waitingPeriods = collected.waiting_periods.map((text) => ({ category: "waiting_period", text }));
  const limits = collected.financial_limits.map((text) => ({ category: "financial_limit", text }));
  const claimRisks = collected.claim_rejection_conditions.map((text) => ({
    category: "claim_rejection",
    text,
  }));

  return {
    meta: policyMeta,
    definitions,
    rules: [...coverages, ...exclusions, ...waitingPeriods, ...limits, ...claimRisks],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 15: START SERVER
// ═══════════════════════════════════════════════════════════════════════════════════════

app.listen(3000, () => console.log("Server running on 3000"));
