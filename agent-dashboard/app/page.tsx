"use client";
import { useState } from 'react';
import { Upload, FileText, AlertTriangle, CheckCircle, Shield, XCircle, Activity } from 'lucide-react';

export default function AgentDashboard() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, UPLOADING, PROCESSING, COMPLETE, ERROR
  const [data, setData] = useState(null);
  const [jobId, setJobId] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('UPLOADING');

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      // 1. Send to your Backend
      // Use the Environment Variable, or default to localhost if missing
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const response = await fetch(`${API_URL}/upload-pdf`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      
      if (result.jobId) {
        setJobId(result.jobId);
        setStatus('COMPLETE');
        setData(result); // In a real app, we would poll. Here we get result instantly.
      } else {
        setStatus('ERROR');
      }
    } catch (e) {
      console.error(e);
      setStatus('ERROR');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Agent Command Center</h1>
            <p className="text-slate-500 mt-1">Upload competitor policies to find gaps instantly.</p>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border shadow-sm text-sm font-mono text-slate-600">
            System Status: <span className="text-emerald-600 font-bold">ONLINE</span>
          </div>
        </div>

        {/* UPLOAD SECTION */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> Upload Policy
              </h2>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:bg-slate-50 transition-colors">
                <input 
                  type="file" 
                  accept="application/pdf" 
                  onChange={handleFileChange} 
                  className="hidden" 
                  id="pdf-upload"
                />
                <label htmlFor="pdf-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <FileText className="w-8 h-8 text-slate-400" />
                  <span className="text-sm font-medium text-slate-600">
                    {file ? file.name : "Click to Select PDF"}
                  </span>
                </label>
              </div>
              
              <button 
                onClick={handleUpload}
                disabled={!file || status === 'UPLOADING' || status === 'PROCESSING'}
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
              >
                {status === 'UPLOADING' ? <Activity className="animate-spin w-4 h-4"/> : 'Analyze Policy'}
              </button>
            </div>

            {/* JOB STATUS CARD */}
            {jobId && (
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Last Job ID</div>
                <div className="font-mono text-xs text-slate-600 break-all">{jobId}</div>
                <div className="mt-2 text-xs flex items-center gap-1 text-emerald-600 font-medium">
                  <CheckCircle className="w-3 h-3" /> Analysis Complete
                </div>
              </div>
            )}
          </div>

          {/* RESULTS SECTION */}
          <div className="md:col-span-2">
            {status === 'COMPLETE' && data ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* META CARD */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{data.meta.policy_name || "Unknown Policy"}</h3>
                    <div className="flex gap-4 mt-2 text-sm text-slate-500">
                      <span>Insurer: {data.meta.insurer || "N/A"}</span>
                      <span>Chunks Processed: {data.meta.totalChunks}</span>
                    </div>
                  </div>
                  <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">
                    {data.meta.document_type}
                  </div>
                </div>

                {/* EXCLUSIONS (RED) */}
                <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
                  <div className="bg-red-50 px-6 py-4 border-b border-red-100 flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-600" />
                    <h3 className="font-bold text-red-900">Critical Exclusions</h3>
                  </div>
                  <div className="p-6">
                    <ul className="space-y-3">
                      {data.normalized.exclusions.length > 0 ? (
                        data.normalized.exclusions.slice(0, 5).map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-slate-700">
                            <span className="text-red-400 font-mono select-none">•</span>
                            {item}
                          </li>
                        ))
                      ) : (
                        <li className="text-slate-400 italic">No explicit exclusions detected.</li>
                      )}
                    </ul>
                  </div>
                </div>

                {/* WAITING PERIODS (AMBER) */}
                <div className="bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
                  <div className="bg-amber-50 px-6 py-4 border-b border-amber-100 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <h3 className="font-bold text-amber-900">Waiting Periods</h3>
                  </div>
                  <div className="p-6">
                    <ul className="space-y-3">
                      {data.normalized.waiting_periods.length > 0 ? (
                        data.normalized.waiting_periods.slice(0, 5).map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-slate-700">
                            <span className="text-amber-400 font-mono select-none">⏱</span>
                            {item}
                          </li>
                        ))
                      ) : (
                        <li className="text-slate-400 italic">No waiting periods detected.</li>
                      )}
                    </ul>
                  </div>
                </div>

                 {/* COVERAGE (GREEN) */}
                 <div className="bg-white rounded-xl border border-emerald-100 shadow-sm overflow-hidden">
                  <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-bold text-emerald-900">Core Coverage</h3>
                  </div>
                  <div className="p-6">
                    <ul className="space-y-3">
                      {data.normalized.coverage.length > 0 ? (
                        data.normalized.coverage.slice(0, 5).map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-slate-700">
                            <span className="text-emerald-400 font-mono select-none">✓</span>
                            {item}
                          </li>
                        ))
                      ) : (
                        <li className="text-slate-400 italic">No coverage details detected.</li>
                      )}
                    </ul>
                  </div>
                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-[400px] border-2 border-dashed border-slate-200 rounded-xl">
                <FileText className="w-12 h-12 mb-4 opacity-20" />
                <p>Results will appear here after analysis.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}