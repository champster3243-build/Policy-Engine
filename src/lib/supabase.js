import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error("Supabase URL/Key missing in .env");
}

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const Storage = {
  // Uploads file to 'raw-pdfs' bucket and returns the public URL
  async upload(file) {
    // Create a unique filename: timestamp-originalName
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    
    const { data, error } = await supabase.storage
      .from('raw-pdfs')
      .upload(safeName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) throw error;

    // Get the Public URL so our AI can read it later
    const { data: { publicUrl } } = supabase.storage
      .from('raw-pdfs')
      .getPublicUrl(safeName);

    return publicUrl;
  }
};

export const DB = {
  // Create the initial Job Record
  async createJob(filename, fileUrl) {
    const { data, error } = await supabase
      .from('jobs')
      .insert([
        { 
          filename, 
          file_url: fileUrl, 
          status: 'PROCESSING' // We act immediately for now
        }
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update the job with AI results
  async completeJob(jobId, result, meta, stats) {
    const { error } = await supabase
      .from('jobs')
      .update({ 
        status: 'COMPLETED',
        result: result,  // The Big JSON
        meta: { ...meta, stats } // Metadata + Stats
      })
      .eq('id', jobId);

    if (error) throw error;
  }
};