/*******************************************************************************************
 * dbSync.js - The Knowledge Graph Builder
 * Purpose: Normalizes hierarchical JSON into relational SQL tables
 *******************************************************************************************/

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = process.env.SUPABASE_URL 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) 
  : null;

/**
 * SYNC TO KNOWLEDGE GRAPH
 * Takes the full analysis result and inserts it into the 3 relational tables.
 */
export async function syncToDatabase(jobId, meta, cpdm, healthScore) {
  if (!supabase) return { error: "Supabase not configured" };

  console.log(`[Sync] Starting DB normalization for Job ${jobId}...`);

  try {
    // 1. INSERT POLICY MASTER RECORD
    const { data: policy, error: policyError } = await supabase
      .from('policies')
      .insert([{
        job_id: jobId,
        policy_name: meta.policy_name || "Unknown Policy",
        insurer: meta.insurer || "Unknown Insurer",
        uin: meta.uin,
        health_score: healthScore || 0,
        total_rules: cpdm.rules.length
      }])
      .select()
      .single();

    if (policyError) throw new Error(`Policy Insert Failed: ${policyError.message}`);
    const policyId = policy.id;

    // 2. PREPARE RULES (Bulk Insert)
    // Note: We are skipping 'embedding' for now to keep it fast. 
    // We will add a background worker for vectors later.
    const rulesToInsert = cpdm.rules.map(r => ({
      policy_id: policyId,
      category: r.category,
      text: r.text
    }));

    // 3. PREPARE DEFINITIONS (Bulk Insert)
    const defsToInsert = cpdm.definitions.map(d => ({
      policy_id: policyId,
      term: d.term,
      definition: d.definition
    }));

    // 4. EXECUTE BULK INSERTS
    const { error: rulesError } = await supabase.from('policy_rules').insert(rulesToInsert);
    if (rulesError) throw new Error(`Rules Insert Failed: ${rulesError.message}`);

    if (defsToInsert.length > 0) {
      const { error: defsError } = await supabase.from('policy_definitions').insert(defsToInsert);
      if (defsError) throw new Error(`Defs Insert Failed: ${defsError.message}`);
    }

    console.log(`[Sync] Success! Policy ${policyId} hydrated with ${rulesToInsert.length} rules.`);
    return { success: true, policyId };

  } catch (err) {
    console.error(`[Sync] Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}