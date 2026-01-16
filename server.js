/*******************************************************************************************
 * * SERVER.JS (v1.4 STABLE - HEAVILY ANNOTATED FOR JUNIOR DEVELOPERS)
 * ==================================================================================
 * * PURPOSE: This backend performs AI-powered policy analysis using a TWO-PASS system.
 * * ARCHITECTURE OVERVIEW:
 * ┌─────────────┐      ┌──────────────┐      ┌─────────────┐      ┌──────────────┐
 * │   Client    │─────▶│   Express    │─────▶│   Gemini    │─────▶│   Supabase   │
 * │ (Next.js)   │◀─────│   Server     │◀─────│  AI Model   │◀─────│  (Storage +  │
 * │             │ JSON │              │ JSON │             │ JSON │   Database)  │
 * └─────────────┘      └──────────────┘      └─────────────┘      └──────────────┘
 * * TWO-PASS LOGIC EXPLANATION:
 * - PASS 1: Scan all chunks with LOW token count (fast & cheap) to identify high-signal content
 * - PASS 2: Re-process only "promising" chunks with HIGH token count for deep extraction
 * * WHY TWO PASSES?
 * - Cost optimization: We don't waste expensive tokens on irrelevant text
 * - Accuracy: High-signal chunks get a second, more thorough analysis
 * - Speed: First pass filters out ~70% of chunks quickly
 * *******************************************************************************************/

console.log("=== SERVER.JS FILE LOADED (v1.4 STABLE) ===");

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors";           // Allows cross-origin requests from frontend
import dotenv from "dotenv";       // Loads environment variables from .env file
import multer from "multer";       // Handles file uploads (PDFs in our case)
import pdf from "pdf-parse";       // Extracts raw text from PDF files
import { GoogleGenerativeAI } from "@google/generative-ai";  // Gemini AI SDK
import { createClient } from '@supabase/supabase-js';        // Database & Storage
import { normalizePolicy } from "./services/normalizePolicy.js";  // Custom normalization logic

// Load environment variables (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY)
dotenv.config();

// Initialize Express app
const app = express();

// Enable CORS for all origins (In production, restrict this to your frontend domain)
app.use(cors());

// Parse incoming JSON requests
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 2: FILE UPLOAD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * MULTER CONFIGURATION
 * * WHY MEMORY STORAGE?
 * - We don't need to save files to disk temporarily
 * - Keeps the file in RAM as a Buffer for immediate processing
 * - Cleaner for serverless/cloud deployments (no disk I/O)
 * * FILE SIZE LIMIT: 10MB
 * - Most insurance policy PDFs are 2-5 MB
 * - 10MB provides buffer for larger documents
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }  // 10MB in bytes
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 3: EXTERNAL SERVICE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * GEMINI AI INITIALIZATION
 * * We're using Google's Gemini 2.5 Flash model because:
 * - Fast response times (< 3 seconds per chunk)
 * - Cost-effective for bulk processing
 * - Good accuracy for structured extraction tasks
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * SUPABASE INITIALIZATION (WITH FALLBACK)
 * * WHY THE CONDITIONAL CHECK?
 * - Allows local development without Supabase credentials
 * - Graceful degradation: if credentials missing, app still works (but no persistence)
 * - Production: ALWAYS set these variables
 */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.warn("⚠️  WARNING: Supabase credentials missing. Persistence disabled.");
}

const supabase = process.env.SUPABASE_URL 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) 
  : null;

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 4: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * TIMEOUT WRAPPER FOR GEMINI CALLS
 * * WHY NEEDED?
 * - Gemini API can occasionally hang or be slow
 * - Without timeout, the server would wait indefinitely
 * - 25 seconds is generous (most calls finish in 2-5s)
 * * HOW IT WORKS:
 * - Promise.race() returns whichever promise resolves first
 * - Either the Gemini call succeeds, or the timeout rejects
 */
function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Gemini timeout")), ms)
    )
  ]);
}

/**
 * SLEEP UTILITY
 * * WHY NEEDED?
 * - Prevents rate-limiting from Gemini API
 * - 100ms delay between chunks is polite and avoids 429 errors
 */
function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * TEXT GLUE REPAIR
 * * PROBLEM: PDF extraction often concatenates words without spaces
 * Example: "ExclusionsInclude" → "Exclusions Include"
 * * SOLUTION: Insert space between lowercase-to-uppercase transitions
 * Regex: ([a-z])([A-Z]) captures "nE" and replaces with "n E"
 */
function repairTextGlue(text) {
  if (!text) return "";
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 5: SUPABASE PERSISTENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * UPLOAD FILE TO SUPABASE STORAGE
 * * FLOW:
 * 1. Generate unique filename using timestamp + sanitized original name
 * 2. Upload buffer to 'raw-pdfs' bucket
 * 3. Return public URL for future reference
 * * ERROR HANDLING: Returns null instead of throwing (graceful degradation)
 */
async function uploadFileToSupabase(file) {
  if (!supabase) return null;  // Skip if Supabase not configured
  
  try {
    // Sanitize filename: Remove special chars, keep only alphanumeric, dots, dashes
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    
    const { data, error } = await supabase.storage
      .from('raw-pdfs')
      .upload(safeName, file.buffer, { 
        contentType: file.mimetype, 
        upsert: false  // Don't overwrite existing files
      });

    if (error) throw error;
    
    // Get public URL for the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from('raw-pdfs')
      .getPublicUrl(safeName);
    
    return publicUrl;
  } catch (err) {
    console.error("Storage Error:", err.message);
    return null;
  }
}

/**
 * CREATE JOB RECORD IN DATABASE
 * * PURPOSE: Track analysis jobs in the 'jobs' table
 * * FIELDS:
 * - filename: Original PDF name
 * - file_url: Supabase Storage URL
 * - status: 'PROCESSING' (will become 'COMPLETED' or 'FAILED')
 * * FALLBACK: If Supabase unavailable, creates local ID for tracking
 */
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

/**
 * COMPLETE JOB RECORD
 * * PURPOSE: Update job status to 'COMPLETED' and store results
 * * DATA STORED:
 * - result: Full CPDM structure (definitions + rules)
 * - meta: Policy metadata + processing stats
 * * WHY JSONB COLUMNS?
 * - PostgreSQL JSONB allows querying nested data
 * - Flexible schema for evolving data structures
 */
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 6: METADATA EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * GET FIRST NON-EMPTY LINE
 * * WHY?
 * - First line often contains policy name or title
 * - Used to extract document metadata
 */
function firstNonEmptyLine(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.length ? lines[0] : null;
}

/**
 * DETECT IF LINE LOOKS LIKE A TITLE
 * * HEURISTICS:
 * - Contains pipe separator (|) → common in headers
 * - Contains "UIN:" → Unique Identification Number
 * - Not a section header like "EXCLUSIONS"
 * - Longer than 15 characters
 */
function looksLikeTitleLine(line) {
  if (!line || line.length < 15) return false;
  
  const lower = line.toLowerCase();
  if (lower.startsWith("exclusions") || lower.startsWith("terms of")) return false;
  
  return line.includes("|") || 
         /uin[:\s]/i.test(line) || 
         /terms\s*&\s*conditions/i.test(line);
}

/**
 * CLEAN INSURER NAME
 * * REMOVES LEGAL BOILERPLATE:
 * - "Insurer means XYZ" → "XYZ"
 * - "Insurer shall mean ABC" → "ABC"
 */
function cleanInsurerName(s) {
  if (!s) return null;
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/^insurer\s+(means|mean)\s+/i, "")
    .replace(/^insurer\s+shall\s+mean\s+/i, "")
    .trim();
}

/**
 * EXTRACT INSURER FROM TEXT
 * * STRATEGY:
 * - Look in first 3000 characters (where company info usually appears)
 * - Regex captures: "ABC Health Insurance Company Limited"
 * - Falls back to generic "Insurance Company Limited" pattern
 */
function extractInsurer(text) {
  const top = text.slice(0, 3000);
  const match = top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Health Insurance Company Limited)/i) ||
                top.match(/([A-Za-z][A-Za-z0-9&().,\-\s]{2,}Insurance Company Limited)/i);
  return match?.[1] ? cleanInsurerName(match[1]) : null;
}

/**
 * EXTRACT POLICY METADATA
 * * EXTRACTS:
 * - policy_name: From first line or regex search
 * - insurer: Company name
 * - uin: Unique Identification Number (regulatory requirement in India)
 * - document_type: "Terms & Conditions" or "Prospectus"
 * - policy_year: Extracted from dates like "2024"
 */
function extractPolicyMetadata(text) {
  const firstLine = firstNonEmptyLine(text);
  const policy_name = looksLikeTitleLine(firstLine) 
    ? firstLine 
    : (text.match(/^(.*Policy.*)$/im)?.[1]?.trim() || null);
  
  return {
    policy_name,
    insurer: extractInsurer(text),
    uin: text.match(/UIN[:\s]*([A-Z0-9]+)/i)?.[1] || null,
    document_type: text.includes("Terms & Conditions") 
      ? "Terms & Conditions" 
      : "Prospectus",
    policy_year: text.match(/(20\d{2})/)?.[1] || null
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 7: INTELLIGENT CHUNKING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * SECTION HEADERS FOR SEMANTIC SPLITTING
 * * WHY SEMANTIC CHUNKING?
 * - Keeps related content together (all exclusions in same chunk)
 * - Improves AI understanding by providing context
 * - Better than arbitrary character splits
 */
const SECTION_HEADERS = [
  "DEFINITION", "DEFINITIONS", "COVER", "COVERAGE", "BENEFITS", "EXCLUSIONS",
  "WAITING PERIOD", "PRE-EXISTING", "LIMITS", "CLAIMS", "CONDITIONS", 
  "TERMS AND CONDITIONS"
];

/**
 * SPLIT TEXT INTO SEMANTIC SECTIONS
 * * ALGORITHM:
 * 1. Find all section headers using regex
 * 2. Split text at these boundaries
 * 3. Keep only substantial sections (>500 chars)
 * * EXAMPLE:
 * "...text... EXCLUSIONS ...text... WAITING PERIOD ...text..."
 * → ["...text...", "EXCLUSIONS ...text...", "WAITING PERIOD ...text..."]
 */
function splitIntoSections(text) {
  const sections = [];
  const regex = new RegExp(`\\n\\s*(${SECTION_HEADERS.join("|")})[^\\n]*`, "gi");
  
  let lastIndex = 0, match;
  while ((match = regex.exec(text)) !== null) {
    const part = text.slice(lastIndex, match.index).trim();
    if (part.length > 500) sections.push(part);  // Only keep substantial text
    lastIndex = match.index;
  }
  
  sections.push(text.slice(lastIndex).trim());
  return sections;
}

/**
 * SUB-CHUNK WITH OVERLAP
 * * WHY OVERLAP?
 * - Prevents splitting sentences in the middle
 * - 100-char overlap ensures context continuity
 * - Example: "...excluded from cov|erage..." → overlap preserves "coverage"
 * * PARAMETERS:
 * - size: 1400 chars (optimal for Gemini context window)
 * - overlap: 100 chars (prevents context loss)
 */
function subChunk(text, size = 1400, overlap = 100) {
  const chunks = [];
  const step = size - overlap;  // Move forward by 1300 chars each time
  
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/**
 * DETECT STRUCTURAL LINES
 * * IDENTIFIES:
 * - Bullet points (•, -, *)
 * - Numbered lists (1., a), (a), i.)
 * - Table rows (starts with |)
 * - Headers (ends with :)
 * * WHY?
 * - Structural lines often contain key information
 * - Helps filter out page numbers, footers
 */
function isStructuralLine(line) {
  const t = line.trim();
  
  // Bullet points
  if (/^[\s]*[•\-\*]/.test(line)) return true;
  
  // Numbered lists
  if (/^[\s]*(\d+\.|[a-z]\)|\([a-z]\)|[ivx]+\.)/i.test(line)) return true;
  
  // Table rows or headers
  if (t.startsWith("|") || t.endsWith(":")) return true;
  
  return false;
}

/**
 * SMART TEXT CLEANING
 * * FILTERS OUT:
 * - Lines with only numbers/symbols (page numbers, decorators)
 * - Very short lines (< 3 chars)
 * * KEEPS:
 * - Structural lines (bullets, numbered lists)
 * - Long lines (> 60 chars, likely to be meaningful)
 * - Lines ending with punctuation (complete sentences)
 * * RETURNS: Cleaned text with filtered lines joined by spaces
 */
function cleanRuleTextSmart(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  
  for (const line of lines) {
    const t = line.trim();
    
    // Skip junk: pure numbers/symbols or too short
    if ((/^[\d\W]+$/.test(t) && t.length < 5) || t.length < 3) continue;
    
    // Keep if: structural OR long OR ends with punctuation
    if (isStructuralLine(line) || t.length > 60 || /[.;!?]$/.test(t)) {
      kept.push(t);
    }
  }
  
  return kept.join(" ");
}

/**
 * CREATE SEMANTIC CHUNKS (MAIN CHUNKING FUNCTION)
 * * MULTI-STAGE PROCESS:
 * 1. Split into semantic sections (EXCLUSIONS, DEFINITIONS, etc.)
 * 2. Sub-chunk large sections into 1400-char pieces with overlap
 * 3. Repair text glue ("ExclusionsThe" → "Exclusions The")
 * 4. Clean text (remove junk, keep meaningful content)
 * 5. Classify each chunk (definitions vs rules)
 * * QUALITY FILTERS:
 * - Minimum 300 chars (raw) before processing
 * - Minimum 200 chars (cleaned) after processing
 * * RETURNS: Array of chunk objects with:
 * - id: Sequential number
 * - hint: "definitions", "rules", or "mixed"
 * - raw: Original text
 * - text: Cleaned text (what gets sent to AI)
 */
function createSemanticChunks(text) {
  const sections = splitIntoSections(text);
  const chunks = [];
  let idCounter = 0;
  
  for (const section of sections) {
    for (const piece of subChunk(section, 1400, 100)) {
      const raw = piece.trim();
      
      // Skip tiny chunks (likely junk)
      if (raw.length < 300) continue;
      
      // Classify the chunk type
      const hint = classifyChunkHint(raw);
      
      // Repair concatenated words
      const glued = repairTextGlue(raw);
      
      // Clean text (skip cleaning for definitions, they need exact text)
      const cleaned = hint === "definitions" 
        ? glued 
        : cleanRuleTextSmart(glued);
      
      // Final quality check
      if (cleaned.length < 200) continue;
      
      chunks.push({ 
        id: ++idCounter, 
        hint, 
        raw, 
        text: cleaned 
      });
    }
  }
  
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 8: CHUNK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * DETECT DEFINITION CHUNKS
 * * HEURISTICS:
 * - Check first 150 chars for " means " or " is defined as "
 * - Check entire text for "definitions" keyword
 * * WHY FIRST 150 CHARS?
 * - Definitions usually start immediately: "Accident means..."
 * - Avoids false positives from examples later in text
 */
function isDefinitionChunk(text) {
  const t = text.toLowerCase();
  const earlyText = t.slice(0, 150);
  
  return earlyText.includes(" means ") || 
          earlyText.includes(" is defined as ") || 
          t.includes("definitions");
}

/**
 * DETECT HIGH-SIGNAL RULE CHUNKS
 * * SIGNALS = Keywords indicating insurance rules
 * * WHY IMPORTANT?
 * - These chunks likely contain valuable information
 * - Marked for Pass 2 processing even if Pass 1 succeeds
 * - Ensures we don't miss important rules
 */
function isHighSignalRuleChunk(text) {
  const signals = [
    "we will cover", 
    "excluded", 
    "waiting period", 
    "deductible", 
    "limit", 
    "sum insured"
  ];
  
  return signals.some(s => text.toLowerCase().includes(s));
}

/**
 * CLASSIFY CHUNK BY CONTENT
 * * SCORING SYSTEM:
 * - Count occurrences of "means" → definition score
 * - Count occurrences of "cover", "exclude", "limit" → rule score
 * * LOGIC:
 * - If 2+ "means" AND more than rules → "definitions"
 * - If 2+ rule keywords → "rules"
 * - Otherwise → "mixed"
 * * WHY SCORING?
 * - Simple keyword presence can be misleading
 * - Frequency-based approach is more reliable
 */
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

/**
 * SAFE JSON PARSER
 * * PROBLEM: Gemini sometimes adds markdown fences:
 * ```json
 * {"type": "exclusion", ...}
 * ```
 * * SOLUTION: Two-stage parsing
 * 1. Remove markdown fences (```json and ```)
 * 2. Try parsing
 * 3. If fails, extract content between first { and last }
 * 4. Try parsing again
 * * RETURNS: Parsed object or null (never throws)
 */
function safeJsonParse(rawText) {
  if (!rawText) return null;
  
  // Stage 1: Remove markdown
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  
  // Try direct parse
  try { 
    return JSON.parse(cleaned); 
  } catch {}
  
  // Stage 2: Extract JSON object
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

/**
 * DETECT JUNK RULES
 * * FILTERS OUT:
 * - Very short text (< 10 chars)
 * - Only numbers and symbols
 * - UI artifacts (like "upload pdf" from PDF rendering glitches)
 * * WHY NEEDED?
 * - PDF extraction can include headers, footers, page numbers
 * - Gemini sometimes returns partial text
 */
function isJunkRule(text) {
  const t = String(text || "").trim();
  
  if (t.length < 10) return true;
  if (/^[\d\W]+$/.test(t)) return true;
  if (t.toLowerCase().includes("upload pdf")) return true;
  
  return false;
}

/**
 * VALIDATE DEFINITION PAIRS
 * * CHECKS:
 * - Term is at least 3 chars (avoid "a", "an")
 * - Definition is at least 10 chars (meaningful explanation)
 * - No obvious duplicates (like "accident accident")
 * * RETURNS: true if definition pair is valid
 */
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

/**
 * GET GEMINI MODEL WITH CONFIGURATION
 * * PARAMETERS:
 * - definitionMode: true for definitions, false for rules
 * - maxTokens: Output limit (1024 for Pass 1, 4096 for Pass 2)
 * * MODEL: gemini-2.5-flash
 * - Fast (< 3s per request)
 * - Cost-effective for bulk processing
 * - Sufficient accuracy for structured extraction
 * * TEMPERATURE: 0 (deterministic output)
 * - No creativity needed, we want consistent JSON
 * - Same input → same output
 */
function getGeminiModel(definitionMode, maxTokens) {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { 
      maxOutputTokens: maxTokens, 
      temperature: 0  // Deterministic output
    }
  });
}

/**
 * BUILD PROMPT FOR GEMINI
 * * TWO MODES:
 * 1. DEFINITION MODE:
 * - Single: Extract ONE term-definition pair
 * - Batch: Extract up to 4 definitions
 * * 2. RULE MODE:
 * - Single: Extract ONE rule with category
 * - Batch: Extract up to 4 rules
 * * CATEGORIES (RULES):
 * - coverage: What IS covered
 * - exclusion: What is NOT covered
 * - waiting_period: Time before coverage starts
 * - financial_limit: Sub-limits, co-pays, deductibles
 * - claim_rejection: Reasons for claim denial
 * * CRITICAL: Always demand "JSON ONLY" to avoid conversational responses
 */
function buildPrompt(mode, text, isBatch = false) {
  // DEFINITION MODE
  if (mode) {
    if (isBatch) {
      return `Extract up to 4 definitions. JSON ONLY. {"type":"definition_batch","definitions":[{"term":"...","definition":"..."}]}. TEXT: ${text}`;
    }
    return `Extract ONE definition. JSON ONLY. {"type":"definition","term":"...","definition":"..."}. TEXT: ${text}`;
  }
  
  // RULE MODE
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

/**
 * ROUTE PARSED JSON TO APPROPRIATE COLLECTION
 * * PURPOSE: Takes Gemini's JSON response and stores data in the right buckets
 * * HANDLES TWO TYPES:
 * 1. Definitions → stored in collected.definitions object
 * 2. Rules → stored in category-specific arrays
 * * RETURNS: { storedAny: boolean } to track if anything was saved
 */
function routeParsed(parsed, collected) {
  if (!parsed || parsed.type === "none") return { storedAny: false };
  
  let stored = false;

  // Helper to add definition (with validation)
  const addDef = (t, d) => { 
    if (isGoodDefinitionPair(t, d)) { 
      collected.definitions[t] = d; 
      stored = true; 
    }
  };
  
  // Helper to add rule (with category routing)
  const addRule = (type, txt) => {
    if (isJunkRule(txt)) return;  // Skip junk
    
    stored = true;
    
    // Route to appropriate category
    if (type === "coverage") collected.coverage.push(txt);
    else if (type === "exclusion") collected.exclusions.push(txt);
    else if (type === "waiting_period") collected.waiting_periods.push(txt);
    else if (type === "financial_limit") collected.financial_limits.push(txt);
    else if (type === "claim_rejection") collected.claim_rejection_conditions.push(txt);
    else collected.coverage.push(txt);  // Default to coverage if unknown
  };

  // Handle batch definitions
  if (Array.isArray(parsed.definitions)) {
    parsed.definitions.forEach(d => addDef(d.term, d.definition));
  } 
  // Handle single definition
  else if (parsed.term) {
    addDef(parsed.term, parsed.definition);
  }
  
  // Handle batch rules
  if (Array.isArray(parsed.rules)) {
    parsed.rules.forEach(r => addRule(r.type, r.text || r.rule));
  } 
  // Handle single rule
  else if (parsed.rule) {
    addRule(parsed.type, parsed.rule);
  }

  return { storedAny: stored };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 13: MAIN API ENDPOINT - THE HEART OF THE APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * POST /upload-pdf
 * * THIS IS THE MAIN ROUTE - ORCHESTRATES ENTIRE ANALYSIS PIPELINE
 */
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  console.log("UPLOAD ENDPOINT HIT");
  
  try {
    // VALIDATION: Ensure PDF was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No PDF uploaded" });
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 1: PERSISTENCE - Upload to Supabase & Create Job Record
    // ─────────────────────────────────────────────────────────────────────────────────
    console.log("1. Uploading to Storage...");
    const publicUrl = await uploadFileToSupabase(req.file);
    console.log(`   -> URL: ${publicUrl || "Skipped (Local)"}`);

    console.log("2. Creating Job...");
    const job = await createJobRecord(req.file.originalname, publicUrl);
    console.log(`   -> Job ID: ${job.id}`);

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 2: PDF PROCESSING - Extract Text & Create Chunks
    // ─────────────────────────────────────────────────────────────────────────────────
    
    // Extract raw text from PDF buffer
    const data = await pdf(req.file.buffer);
    
    // Extract metadata from first few pages
    const policyMeta = extractPolicyMetadata(data.text);
    
    // Create semantic chunks (1400 chars each, 100 char overlap)
    const chunks = createSemanticChunks(data.text);
    console.log(`TOTAL CHUNKS: ${chunks.length}`);

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 3: INITIALIZE DATA COLLECTION
    // ─────────────────────────────────────────────────────────────────────────────────
    
    const collected = { 
      definitions: {}, 
      coverage: [], 
      exclusions: [], 
      waiting_periods: [], 
      financial_limits: [], 
      claim_rejection_conditions: [] 
    };
    
    // Statistics tracking
    let parsedChunks = 0;    // Chunks that returned valid JSON
    let failedChunks = 0;    // Chunks that errored or timed out
    
    // Pass 2 candidates (chunks needing deeper analysis)
    const pass2Candidates = [];

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 4: WORKER POOL FUNCTION (Handles Concurrency)
    // ─────────────────────────────────────────────────────────────────────────────────
    
    const runWorkerPool = async (tasks, concurrency, isPass2 = false) => {
      let index = 0;  // Shared counter across all workers
      const workers = [];
      
      const worker = async (id) => {
        while (true) {
          // Atomically get next task
          const i = index++;
          if (i >= tasks.length) break;  // No more tasks
          
          const task = tasks[i];
          
          // Determine processing mode
          const defMode = task.hint === "definitions" || isDefinitionChunk(task.text);
          
          console.log(`[${isPass2 ? 'P2' : 'P1'} Worker ${id}] Processing ${i+1}/${tasks.length} | Mode: ${defMode ? 'DEF' : 'RULE'}`);
          
          // Get AI model (Pass 2 uses higher token limit)
          const model = getGeminiModel(defMode, isPass2 ? 4096 : 1024);
          
          // Build prompt (Pass 2 uses batch extraction)
          const prompt = buildPrompt(defMode, task.text, isPass2);
          
          try {
            // Call Gemini with 30-second timeout
            const result = await withTimeout(model.generateContent(prompt), 30000);
            
            // Parse JSON response
            const parsed = safeJsonParse(result.response.text());
            
            // DECISION TREE FOR PASS 2 CANDIDATES
            if (!parsed || parsed.type === "none") {
              // If Pass 1 AND (is definition OR has high signals) → needs Pass 2
              if (!isPass2 && (defMode || isHighSignalRuleChunk(task.text))) {
                pass2Candidates.push(task);
              }
            } else {
              // Store the data
              const { storedAny } = routeParsed(parsed, collected);
              
              if (storedAny) parsedChunks++;
              
              // Even if Pass 1 succeeded, re-analyze high-signal chunks in Pass 2
              if (!isPass2 && storedAny && isHighSignalRuleChunk(task.text)) {
                pass2Candidates.push(task);
              }
            }
          } catch (e) {
            console.error(`[Worker ${id}] Error:`, e.message);
            failedChunks++;
          }
          
          // Rate limiting: 100ms delay between requests
          await sleep(100);
        }
      };
      
      // Spawn workers
      for (let w = 0; w < concurrency; w++) {
        workers.push(worker(w + 1));
      }
      
      // Wait for all workers to complete
      await Promise.all(workers);
    };

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 5: PASS 1 - INITIAL SCAN
    // ─────────────────────────────────────────────────────────────────────────────────
    
    await runWorkerPool(chunks, 5); 
    console.log(`PASS 1 DONE. Candidates for P2: ${pass2Candidates.length}`);

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 6: PASS 2 - DEEP ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────────────
    
    if (pass2Candidates.length > 0) {
      // Remove duplicates (same chunk ID)
      const uniqueTasks = [...new Map(pass2Candidates.map(item => [item.id, item])).values()];
      
      console.log(`STARTING PASS 2 with ${uniqueTasks.length} chunks...`);
      await runWorkerPool(uniqueTasks, 5, true);
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 7: DEDUPLICATION
    // ─────────────────────────────────────────────────────────────────────────────────
    
    const dedup = (arr) => [...new Set(arr.map(s => String(s).trim()))];
    
    collected.coverage = dedup(collected.coverage);
    collected.exclusions = dedup(collected.exclusions);
    collected.waiting_periods = dedup(collected.waiting_periods);
    collected.financial_limits = dedup(collected.financial_limits);
    collected.claim_rejection_conditions = dedup(collected.claim_rejection_conditions);

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 8: BUILD FINAL DATA STRUCTURES
    // ─────────────────────────────────────────────────────────────────────────────────
    
    const cpdm = buildCPDM(policyMeta, collected);
    
    const normalized = normalizePolicy([{
        coverage: collected.coverage,
        exclusions: collected.exclusions,
        waiting_periods: collected.waiting_periods,
        financials: collected.financial_limits,
        claim_risks: collected.claim_rejection_conditions
    }]);

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 9: PERSIST RESULTS
    // ─────────────────────────────────────────────────────────────────────────────────
    console.log("3. Saving Results...");
    await completeJobRecord(job.id, cpdm, policyMeta, { parsedChunks, failedChunks });
    console.log("   -> Saved.");

    // ─────────────────────────────────────────────────────────────────────────────────
    // STEP 10: RETURN RESPONSE
    // ─────────────────────────────────────────────────────────────────────────────────
    
    res.json({
      message: "Analysis Complete",
      jobId: job.id,
      fileUrl: publicUrl,
      meta: { 
        ...policyMeta, 
        totalChunks: chunks.length, 
        parsedChunks, 
        failedChunks 
      },
      definitions: collected.definitions,
      normalized,
      cpdm
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
  // Convert definitions object to array format
  const definitions = Object.entries(collected.definitions)
    .map(([term, definition]) => ({ term, definition }));
  
  // Tag each rule with its category
  const coverages = collected.coverage
    .map(text => ({ category: "coverage", text }));
  const exclusions = collected.exclusions
    .map(text => ({ category: "exclusion", text }));
  const waitingPeriods = collected.waiting_periods
    .map(text => ({ category: "waiting_period", text }));
  const limits = collected.financial_limits
    .map(text => ({ category: "financial_limit", text }));
  const claimRisks = collected.claim_rejection_conditions
    .map(text => ({ category: "claim_rejection", text }));
  
  return {
    meta: policyMeta,
    definitions,
    rules: [ 
      ...coverages, 
      ...exclusions, 
      ...waitingPeriods, 
      ...limits, 
      ...claimRisks 
    ]
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SECTION 15: START SERVER
// ═══════════════════════════════════════════════════════════════════════════════════════

app.listen(3000, () => console.log("Server running on 3000"));

/*******************************************************************************************
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * END OF server.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *******************************************************************************************/