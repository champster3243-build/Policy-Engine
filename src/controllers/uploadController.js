import pdf from "pdf-parse";
import { extractPolicyMetadata, createSemanticChunks } from '../services/pdfService.js';
import { processChunks } from '../services/aiService.js';
import { normalizePolicy } from '../services/normalizePolicy.js';
import { Storage, DB } from '../lib/supabase.js'; // <--- NEW IMPORT

export const handlePdfUpload = async (req, res) => {
  console.log("UPLOAD ENDPOINT HIT");
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    // --- STEP A: PERSISTENCE (Job 1.1) ---
    console.log("1. Uploading to Supabase Storage...");
    const publicUrl = await Storage.upload(req.file);
    console.log("   -> Uploaded:", publicUrl);

    console.log("2. Creating Job Record...");
    const job = await DB.createJob(req.file.originalname, publicUrl);
    console.log("   -> Job Created ID:", job.id);

    // --- STEP B: INGESTION ---
    // Note: In Phase 1.2 (Queue), we will stop here. 
    // For now, we continue processing so you can see results instantly.
    
    const data = await pdf(req.file.buffer);
    const policyMeta = extractPolicyMetadata(data.text);
    const chunks = createSemanticChunks(data.text);
    console.log(`TOTAL CHUNKS: ${chunks.length}`);

    // --- STEP C: AI PROCESSING ---
    const collected = { 
        definitions: {}, coverage: [], exclusions: [], 
        waiting_periods: [], financial_limits: [], claim_rejection_conditions: [] 
    };
    const stats = { parsedChunks: 0, failedChunks: 0 };

    // Pass 1
    const pass2Candidates = await processChunks(chunks, collected, stats);
    
    // Pass 2
    if (pass2Candidates.length > 0) {
      const uniqueTasks = [...new Map(pass2Candidates.map(item => [item.id, item])).values()];
      await processChunks(uniqueTasks, collected, stats);
    }

    // Dedupe
    const dedup = (arr) => [...new Set(arr.map(s => String(s).trim()))];
    collected.coverage = dedup(collected.coverage);
    collected.exclusions = dedup(collected.exclusions);
    collected.waiting_periods = dedup(collected.waiting_periods);
    collected.financial_limits = dedup(collected.financial_limits);
    collected.claim_rejection_conditions = dedup(collected.claim_rejection_conditions);

    // CPDM Construction
    const cpdm = {
        meta: policyMeta,
        definitions: Object.entries(collected.definitions).map(([t,d]) => ({term:t, definition:d})),
        rules: [
            ...collected.coverage.map(t => ({category: 'coverage', text: t})),
            ...collected.exclusions.map(t => ({category: 'exclusion', text: t})),
            ...collected.waiting_periods.map(t => ({category: 'waiting_period', text: t})),
            ...collected.financial_limits.map(t => ({category: 'financial_limit', text: t})),
            ...collected.claim_rejection_conditions.map(t => ({category: 'claim_rejection', text: t}))
        ]
    };

    const normalized = normalizePolicy([{
        coverage: collected.coverage,
        exclusions: collected.exclusions,
        waiting_periods: collected.waiting_periods,
        financials: collected.financial_limits,
        claim_risks: collected.claim_rejection_conditions
    }]);

    // --- STEP D: SAVE RESULTS (Job 1.1) ---
    console.log("3. Saving Results to DB...");
    await DB.completeJob(job.id, cpdm, policyMeta, stats);

    // Return success + the Job ID
    res.json({
      message: "Analysis Complete",
      jobId: job.id, // <--- Client now has a reference!
      fileUrl: publicUrl,
      meta: { ...policyMeta, totalChunks: chunks.length, ...stats },
      definitions: collected.definitions,
      normalized,
      cpdm
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};