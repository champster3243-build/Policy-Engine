/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY AGENT: "THE VK-18 EDITION" (Elite Performance UI)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * * DESIGN PHILOSOPHY: Aggressive, High-Contrast, Precision-Engineered.
 * * TECH STACK: Next.js + Tailwind + html-to-image (Modern CSS Support)
 * * EXPORT ENGINE: html-to-image (Fixes 'lab' color crashes)
 * */

"use client";

import { useState } from "react";
import { 
  Upload, FileText, Shield, Download, Loader2, Activity, 
  AlertTriangle, Clock, DollarSign, XCircle, CheckCircle, 
  Zap, BarChart3, ChevronRight, Hash
} from "lucide-react";
import { toPng } from 'html-to-image'; // ✅ NEW ENGINE: Handles modern CSS/Dark Mode perfectly
import jsPDF from "jspdf";

// --- TYPES ---
interface Rule { category: string; text: string; }
interface PolicyMeta {
  policy_name?: string; insurer?: string; uin?: string;
  totalChunks?: number; parsedChunks?: number; failedChunks?: number;
}
interface AnalysisData {
  isCached?: boolean; jobId?: string; meta?: PolicyMeta;
  cpdm?: { meta?: PolicyMeta; definitions?: Array<{ term: string; definition: string }>; rules?: Rule[]; };
}

export default function AgentDashboard() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisData | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // --- UPLOAD LOGIC ---
  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      // Replace with your actual endpoint
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      const res = await fetch(`${apiUrl}/upload-pdf`, { method: "POST", body: formData });
      const result = await res.json();
      setData(result);
    } catch (e) {
      console.error(e);
      alert("Connection Failed: Check Backend");
    } finally {
      setLoading(false);
    }
  };

  // --- EXPORT LOGIC (html-to-image) ---
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;

    const btn = document.getElementById("export-btn");
    if(btn) btn.innerText = "GENERATING...";

    try {
      // 1. Capture High-Fidelity Dark Mode Image
      const dataUrl = await toPng(element, { 
        cacheBust: true,
        backgroundColor: '#0a0a0a', // Force Neutral-950 background for PDF
        quality: 1.0,
        pixelRatio: 2, // Retina quality
      });

      // 2. Generate PDF
      const pdf = new jsPDF("p", "mm", "a4");
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = 210;
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      // Auto-Paging Logic
      let heightLeft = pdfHeight;
      let position = 0;
      const pageHeight = 297;

      pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`Elite-Audit-${data?.meta?.policy_name || "Report"}.pdf`);
    } catch (err) {
      console.error("Export Error:", err);
      alert("Export Failed. Check console.");
    } finally {
      if(btn) btn.innerText = "DOWNLOAD REPORT";
    }
  };

  // --- HELPERS ---
  const getRules = (cat: string) => data?.cpdm?.rules?.filter(r => r.category === cat) || [];
  
  const stats = data ? {
    exclusions: getRules("exclusion").length,
    waiting: getRules("waiting_period").length,
    limits: getRules("financial_limit").length,
    risks: getRules("claim_rejection").length,
    coverage: getRules("coverage").length,
    total: data.cpdm?.rules?.length || 0
  } : { exclusions: 0, waiting: 0, limits: 0, risks: 0, coverage: 0, total: 0 };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-rose-500 selection:text-white">
      
      {/* ════ NAVBAR ════ */}
      <div className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-rose-600 p-2 rounded-lg shadow-lg shadow-rose-600/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase">
              Policy<span className="text-rose-500">Engine</span>_V1
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {data?.isCached && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Zap className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase">Instant Replay</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 mt-6">
        
        {/* ════ LEFT: CONTROL DECK ════ */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* UPLOAD CARD */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
            {/* Ambient Glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-600/10 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-rose-600/20"></div>
            
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload Policy
            </h2>

            <div className="relative group/drop">
              <input 
                type="file" 
                accept=".pdf" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                onChange={(e) => setFile(e.target.files?.[0] || null)} 
              />
              <div className="block w-full aspect-[4/3] border-2 border-dashed border-neutral-700 rounded-2xl flex flex-col items-center justify-center transition-all duration-300 group-hover/drop:border-rose-500 group-hover/drop:bg-neutral-800/50">
                <div className="bg-neutral-800 p-4 rounded-full mb-4 group-hover/drop:scale-110 transition-transform">
                  <FileText className="w-8 h-8 text-neutral-400 group-hover/drop:text-rose-500" />
                </div>
                <p className="text-sm font-bold text-white">{file ? file.name : "DRAG & DROP PDF"}</p>
                <p className="text-[10px] text-neutral-500 font-mono mt-2 uppercase">Max Size: 10MB</p>
              </div>
            </div>

            <button 
              onClick={handleUpload} 
              disabled={!file || loading}
              className="w-full mt-6 bg-white text-black font-black py-4 rounded-xl uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-white/10 hover:shadow-rose-500/20"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5"/> : "Run Audit"}
            </button>
          </div>

          {/* METADATA CARD */}
          {data?.meta && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6">
              <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">Run Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <StatBox label="CHUNKS" value={data.meta.totalChunks} />
                <StatBox label="PARSED" value={data.meta.parsedChunks} color="text-emerald-400" />
              </div>
            </div>
          )}
        </div>

        {/* ════ RIGHT: PERFORMANCE DASHBOARD ════ */}
        <div className="lg:col-span-8">
          {data ? (
            <div className="space-y-6">
              {/* ACTIONS */}
              <div className="flex justify-end">
                <button 
                  id="export-btn"
                  onClick={exportPDF}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-neutral-700 transition-all"
                >
                  <Download className="w-4 h-4" /> Download Report
                </button>
              </div>

              {/* ════ THE REPORT (CAPTURED AREA) ════ */}
              <div id="analysis-results" className="bg-neutral-950 p-10 rounded-3xl border border-neutral-800 shadow-2xl">
                
                {/* HEADLINE */}
                <div className="border-b border-neutral-800 pb-8 mb-8">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Analysis Complete</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-black text-white leading-tight mb-4 uppercase italic tracking-tighter">
                    {data.cpdm?.meta?.policy_name || "Policy Audit"}
                  </h1>
                  <div className="flex flex-wrap gap-3">
                    <Badge text={data.cpdm?.meta?.insurer || "INSURER"} />
                    {data.cpdm?.meta?.uin && <Badge text={`UIN: ${data.cpdm.meta.uin}`} />}
                    <Badge text={`${stats.total} DATA POINTS`} color="bg-rose-600 border-rose-600 text-white" />
                  </div>
                </div>

                {/* THE SCORECARD (BENTO GRID) */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
                  <ScoreCard icon={<XCircle/>} label="Critical Exclusions" value={stats.exclusions} color="text-rose-500" />
                  <ScoreCard icon={<Clock/>} label="Waiting Periods" value={stats.waiting} color="text-amber-400" />
                  <ScoreCard icon={<DollarSign/>} label="Financial Limits" value={stats.limits} color="text-blue-400" />
                  <ScoreCard icon={<AlertTriangle/>} label="Rejection Risks" value={stats.risks} color="text-purple-400" />
                  <ScoreCard icon={<CheckCircle/>} label="Coverage Points" value={stats.coverage} color="text-emerald-400" />
                  <ScoreCard icon={<BarChart3/>} label="Health Score" value={`${Math.round((stats.coverage / (stats.total || 1)) * 100)}%`} color="text-white" />
                </div>

                {/* DEEP DIVE SECTIONS */}
                <div className="space-y-12">
                  <Section 
                    title="PERMANENT EXCLUSIONS" 
                    subtitle="Medical conditions explicitly removed from coverage."
                    rules={getRules("exclusion")}
                    color="rose"
                  />
                  <Section 
                    title="WAITING PERIODS" 
                    subtitle="Time durations before coverage becomes active."
                    rules={getRules("waiting_period")}
                    color="amber"
                  />
                  <Section 
                    title="FINANCIAL LIMITS" 
                    subtitle="Sub-limits, Co-pays, and Capping."
                    rules={getRules("financial_limit")}
                    color="blue"
                  />
                  <Section 
                    title="REJECTION RISKS" 
                    subtitle="Procedural gaps that lead to claim denial."
                    rules={getRules("claim_rejection")}
                    color="purple"
                  />
                </div>

                {/* DEFINITIONS FOOTER */}
                {data.cpdm?.definitions && (
                  <div className="mt-12 pt-8 border-t border-neutral-800">
                    <h4 className="text-xs font-black text-neutral-500 uppercase tracking-widest mb-6">Definitions Dictionary</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {data.cpdm.definitions.map((def, i) => (
                        <div key={i} className="bg-neutral-900 p-4 rounded-xl border border-neutral-800">
                          <span className="text-xs font-bold text-white uppercase block mb-1">{def.term}</span>
                          <span className="text-[10px] text-neutral-400 leading-relaxed">{def.definition}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-neutral-900/50 border border-dashed border-neutral-800 rounded-3xl">
              <div className="bg-neutral-800 p-6 rounded-full mb-6 animate-pulse">
                <Shield className="w-12 h-12 text-neutral-600" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-widest">System Ready</h3>
              <p className="text-sm text-neutral-500 font-medium mt-2">Awaiting Input Data</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════ COMPONENTS ════

function StatBox({ label, value, color = "text-white" }: { label: string, value: any, color?: string }) {
  return (
    <div className="bg-neutral-800 p-3 rounded-xl text-center">
      <div className="text-[10px] font-bold text-neutral-500 mb-1">{label}</div>
      <div className={`text-xl font-mono font-black ${color}`}>{value || 0}</div>
    </div>
  );
}

function Badge({ text, color = "bg-neutral-900 border-neutral-800 text-neutral-400" }: { text: string, color?: string }) {
  return (
    <span className={`px-4 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${color}`}>
      {text}
    </span>
  );
}

function ScoreCard({ icon, label, value, color }: { icon: any, label: string, value: any, color: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex flex-col justify-between hover:border-neutral-700 transition-colors">
      <div className={`${color} mb-3 opacity-80`}>{icon}</div>
      <div>
        <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
        <div className="text-3xl font-black text-white font-mono">{value}</div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, rules, color }: { title: string, subtitle: string, rules: Rule[], color: string }) {
  if (!rules.length) return null;
  
  const colorClasses: any = {
    rose: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", purple: "bg-purple-500"
  };

  const shadowClasses: any = {
    rose: "shadow-rose-500/50", amber: "shadow-amber-500/50", blue: "shadow-blue-500/50", purple: "shadow-purple-500/50"
  };

  return (
    <div>
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-1 h-12 ${colorClasses[color]} rounded-full shadow-[0_0_15px] ${shadowClasses[color]}`}></div>
        <div>
          <h3 className="text-xl font-black text-white tracking-wide">{title}</h3>
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-widest mt-1">{subtitle}</p>
        </div>
      </div>
      <div className="grid gap-3 pl-5">
        {rules.map((r, i) => (
          <div key={i} className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl flex gap-4 items-start hover:border-neutral-700 transition-all hover:bg-neutral-800/30">
            <ChevronRight className="w-4 h-4 text-neutral-600 mt-0.5 shrink-0" />
            <p className="text-sm font-medium text-neutral-300 leading-relaxed">{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}