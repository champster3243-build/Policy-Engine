/*******************************************************************************************
 *
 * SERVER.JS (v1.5 PARANOID MODE)
 * ===========================
 *
 * HISTORY:
 * - v1.4: Integrated Supabase.
 * - v1.5 (CURRENT): "Paranoid Mode" to force extraction of all risks/exclusions.
 *
 *******************************************************************************************/

console.log("=== SERVER.JS FILE LOADED (v1.5 PARANOID MODE) ===");

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

// --- SUPABASE SETUP ---
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
// ZONE 1.5: SUPABASE HELPERS
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
      
      // Simple hint logic
      const hint = raw.toLowerCase().includes("mean") ? "definitions" : "rules";
      
      const glued = repairTextGlue(raw);
      const cleaned = hint === "definitions" ? glued : cleanRuleTextSmart(glued);
      if (cleaned.length < 200) continue;
      chunks.push({ id: ++idCounter, hint, raw, text: cleaned });
    }
  }
  return chunks;
}


// ==========================================================================================
// ZONE 7: GEMINI (UPDATED: PARANOID MODE)
// ==========================================================================================

function getGeminiModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.0-flash", // Updated to latest flash for speed
    generationConfig: { maxOutputTokens: 2000, temperature: 0.1 }
  });
}

// NEW: Aggressive extraction prompt
function buildParanoidPrompt(text) {
  return `
    ROLE: Insurance Auditor hunting for GAPS and RISKS.
    TASK: Extract text VERBATIM from the document snippets below.
    
    TARGETS TO EXTRACT (Raw Text Only):
    1. EXCLUSIONS: Anything saying "Not Covered", "We will not pay", "Excludes", "General Exclusions".
    2. SPECIFIC RISKS: Alcohol, Drugs, Obesity, Cosmetic Surgery, Pregnancy, War, Nuclear, Breach of Law, Hazardous Sports.
    3. WAITING PERIODS: "30 days", "24 months", "36 months", "4 years".
    4. LIMITS: Sub-limits (e.g., "Cataract limit 40k"), Co-payments ("20% co-pay").

    TEXT TO ANALYZE:
    "${text.replace(/"/g, "'").substring(0, 3000)}"

    OUTPUT FORMAT (JSON ONLY, NO MARKDOWN):
    {
      "exclusions": ["raw text from policy..."],
      "waiting_periods": ["raw text..."],
      "financial_limits": ["raw text..."]
    }

    CRITICAL:
    - If you see a list of exclusions, extract ALL OF THEM. Do not summarize.
    - If nothing found, return empty arrays.
  `;
}


// ==========================================================================================
// ZONE 8: MAIN ROUTE (INTEGRATED)
// ==========================================================================================

app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  console.log("UPLOAD ENDPOINT HIT");
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    // --- 1. PERSISTENCE (Supabase) ---
    console.log("1. Uploading to Storage...");
    const publicUrl = await uploadFileToSupabase(req.file);
    console.log("   -> URL:", publicUrl || "Skipped (Local)");

    console.log("2. Creating Job...");
    const job = await createJobRecord(req.file.originalname, publicUrl);
    console.log("   -> Job ID:", job.id);

    // --- 2. PROCESSING ---
    const data = await pdf(req.file.buffer);
    const policyMeta = extractPolicyMetadata(data.text);
    
    // --- 2a. CHUNK & PROCESS DIRECTLY ---
    const chunks = createSemanticChunks(data.text);
    console.log(`TOTAL CHUNKS: ${chunks.length}`);

    const collected = { 
        exclusions: [], 
        waiting_periods: [], 
        financial_limits: [] 
    };

    let processedCount = 0;
    let failedChunks = 0;

    // Simple Worker Function
    const processChunk = async (chunk, index) => {
        // Skip obvious junk (definitions or headers) to save API calls
        if (chunk.hint === 'definitions' && !chunk.text.toLowerCase().includes('exclude')) return;
        
        console.log(`[Worker] Processing Chunk ${index + 1}/${chunks.length}`);
        
        try {
            const model = getGeminiModel();
            const prompt = buildParanoidPrompt(chunk.text);
            
            // Call Gemini
            const result = await withTimeout(model.generateContent(prompt), 25000);
            const responseText = result.response.text();

            // Clean & Parse
            const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);

            // Store Data
            if (parsed.exclusions?.length) collected.exclusions.push(...parsed.exclusions);
            if (parsed.waiting_periods?.length) collected.waiting_periods.push(...parsed.waiting_periods);
            if (parsed.financial_limits?.length) collected.financial_limits.push(...parsed.financial_limits);
            
            processedCount++;
        } catch (err) {
            console.error(`[Chunk ${index} Error]:`, err.message); // Log error but keep going
            failedChunks++;
        }
    };

    // Run in batches of 5 to respect Rate Limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((chunk, idx) => processChunk(chunk, i + idx)));
        await sleep(500); // Tiny breather for the API
    }

    console.log(`PROCESSING DONE. Extracted: ${collected.exclusions.length} exclusions.`);

    // --- 3. FINALIZE ---
    const dedup = (arr) => [...new Set(arr.map(s => String(s).trim()))];
    collected.exclusions = dedup(collected.exclusions);
    collected.waiting_periods = dedup(collected.waiting_periods);
    collected.financial_limits = dedup(collected.financial_limits);

    // Prepare structure for CPDM and Frontend
    const normalized = normalizePolicy([{
        exclusions: collected.exclusions,
        waiting_periods: collected.waiting_periods,
        financials: collected.financial_limits,
        coverage: [], // We focused on risk in this version
        claim_risks: []
    }]);

    const cpdm = buildCPDM(policyMeta, collected);

    // --- 4. SAVE RESULT ---
    console.log("3. Saving Results...");
    await completeJobRecord(job.id, cpdm, policyMeta, { parsedChunks: processedCount, failedChunks });
    console.log("   -> Saved.");

    res.json({
      message: "Analysis Complete",
      jobId: job.id,
      fileUrl: publicUrl,
      meta: { ...policyMeta, totalChunks: chunks.length, parsedChunks: processedCount, failedChunks },
      normalized,
      cpdm
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// ==========================================================================================
// ZONE 9: CPDM BUILDER
// ==========================================================================================
function buildCPDM(policyMeta, collected) {
  const exclusions = collected.exclusions.map(text => ({ category: "exclusion", text }));
  const waitingPeriods = collected.waiting_periods.map(text => ({ category: "waiting_period", text }));
  const limits = collected.financial_limits.map(text => ({ category: "financial_limit", text }));
  
  return {
    meta: policyMeta,
    rules: [ ...exclusions, ...waitingPeriods, ...limits ]
  };
}

// ==========================================================================================
// ZONE 10: SERVER START
// ==========================================================================================
app.listen(3000, () => console.log("Server running on 3000"));