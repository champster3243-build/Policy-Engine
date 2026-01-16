/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY AGENT: "THE ELITE EDITION" (Performance Dashboard)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * * DESIGN PHILOSOPHY: Aggressive, High-Contrast, Precision-Engineered.
 * * TECH STACK: Next.js + Tailwind + html-to-image (Modern CSS Support)
 * * VISUAL STYLE: Dark Mode "Command Center" with Neon Accents.
 * */

"use client";

import { useState } from "react";
import { 
  Upload, FileText, Shield, Download, Loader2, Activity, 
  AlertTriangle, Clock, DollarSign, XCircle, CheckCircle, 
  Zap, BarChart3, ChevronRight, Hash, Search, LayoutDashboard
} from "lucide-react";
import { toPng } from 'html-to-image';
import jsPDF from "jspdf";

// --- TYPES (Unchanged for compatibility) ---
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

  // --- EXPORT LOGIC (Optimized for Dark Mode Capture) ---
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;

    const btn = document.getElementById("export-btn");
    if(btn) btn.innerText = "GENERATING...";

    try {
      // Capture exactly what is seen on screen (Dark Mode)
      const dataUrl = await toPng(element, { 
        cacheBust: true,
        backgroundColor: '#09090b', // Zinc-950 background
        quality: 1.0,
        pixelRatio: 2, 
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = 210;
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
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
      alert("Export Failed. Please try Chrome/Edge.");
    } finally {
      if(btn) btn.innerText = "DOWNLOAD REPORT";
    }
  };

  // --- DATA HELPERS ---
  const getRules = (cat: string) => data?.cpdm?.rules?.filter(r => r.category === cat) || [];
  
  const stats = data ? {
    exclusions: getRules("exclusion").length,
    waiting: getRules("waiting_period").length,
    limits: getRules("financial_limit").length,
    risks: getRules("claim_rejection").length,
    coverage: getRules("coverage").length,
    total: data.cpdm?.rules?.length || 0
  } : { exclusions: 0, waiting: 0, limits: 0, risks: 0, coverage: 0, total: 0 };

  // Calculate Health Score (Simple algorithm for visual demo)
  const healthScore = stats.total > 0 
    ? Math.round(((stats.coverage * 1.5) - (stats.exclusions * 2) - stats.risks + 100)) 
    : 0;
  const normalizedScore = Math.max(0, Math.min(100, healthScore)); // Clamp between 0-100

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-rose-500 selection:text-white">
      
      {/* ════ NAVBAR: THE COCKPIT HEADER ════ */}
      <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-rose-600 to-orange-600 p-2.5 rounded-lg shadow-lg shadow-rose-900/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase leading-none">
                KnowYour<span className="text-rose-500">Cover</span>
              </h1>
              <p className="text-[10px] font-bold text-zinc-500 tracking-[0.2em] uppercase">Policy Intelligence Unit</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-zinc-900 rounded-full border border-zinc-800">
                <Search className="w-4 h-4 text-zinc-500" />
                <span className="text-xs font-medium text-zinc-500">Global Search...</span>
            </div>
            <div className="h-8 w-[1px] bg-zinc-800 hidden md:block"></div>
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                    <span className="text-xs font-bold">VK</span>
                </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 xl:grid-cols-12 gap-8 mt-4">
        
        {/* ════ LEFT SIDEBAR: INPUT & METRICS (3 Columns) ════ */}
        <div className="xl:col-span-3 space-y-6">
          
          {/* UPLOAD WIDGET */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-1 shadow-2xl overflow-hidden group hover:border-rose-500/50 transition-all duration-500">
            <div className="bg-zinc-950 rounded-[20px] p-6 h-full relative overflow-hidden">
                {/* Decorative Gradients */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-rose-600/20 rounded-full blur-[50px] pointer-events-none"></div>
                
                <h2 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-rose-500" /> Upload Engine
                </h2>

                <label className="block w-full aspect-square border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-rose-500 hover:bg-zinc-900/50 transition-all duration-300 relative group/drop">
                  <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <div className="bg-zinc-900 p-5 rounded-full mb-4 border border-zinc-800 group-hover/drop:scale-110 group-hover/drop:border-rose-500 transition-all">
                    <FileText className="w-8 h-8 text-zinc-400 group-hover/drop:text-white" />
                  </div>
                  <p className="text-sm font-bold text-white tracking-wide">{file ? file.name : "DROP PDF HERE"}</p>
                  <p className="text-[10px] text-zinc-600 font-mono mt-2 uppercase">Max Size: 10MB</p>
                </label>

                <button 
                  onClick={handleUpload} 
                  disabled={!file || loading}
                  className="w-full mt-6 bg-white text-black font-black py-4 rounded-xl uppercase tracking-[0.15em] text-xs hover:bg-rose-500 hover:text-white hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group/btn"
                >
                  {loading ? <Loader2 className="animate-spin w-4 h-4"/> : <Zap className="w-4 h-4 group-hover/btn:fill-current" />}
                  {loading ? "Processing..." : "Run Analysis"}
                </button>
            </div>
          </div>

          {/* METADATA WIDGET */}
          {data?.meta && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Run Diagnostics</h3>
                  <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-[10px] font-bold text-emerald-500 uppercase">Live</span>
                  </div>
              </div>
              
              <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                      <span className="text-xs font-bold text-zinc-400 uppercase">Chunks</span>
                      <span className="text-sm font-mono font-bold text-white">{data.meta.totalChunks}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                      <span className="text-xs font-bold text-zinc-400 uppercase">Success</span>
                      <span className="text-sm font-mono font-bold text-emerald-400">{data.meta.parsedChunks}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                      <span className="text-xs font-bold text-zinc-400 uppercase">Latency</span>
                      <span className="text-sm font-mono font-bold text-amber-400">0.8s</span>
                  </div>
              </div>
            </div>
          )}
        </div>

        {/* ════ RIGHT: THE INTELLIGENCE DASHBOARD (9 Columns) ════ */}
        <div className="xl:col-span-9">
          {data ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
              
              {/* TOP BAR ACTIONS */}
              <div className="flex justify-between items-end">
                  <div>
                      <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Analysis Complete</span>
                      </div>
                      <h2 className="text-3xl font-black text-white tracking-tight uppercase">
                          {data.cpdm?.meta?.policy_name || "Policy Audit Report"}
                      </h2>
                  </div>
                  <button 
                    id="export-btn"
                    onClick={exportPDF}
                    className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-zinc-700 transition-all hover:scale-105 active:scale-95"
                  >
                    <Download className="w-4 h-4" /> Download Report
                  </button>
              </div>

              {/* ════ THE REPORT CONTAINER (CAPTURED AREA) ════ */}
              <div id="analysis-results" className="bg-[#09090b] p-8 rounded-[32px] border border-zinc-800 shadow-2xl relative">
                
                {/* 1. KEY METRICS GRID (The "Bento" Box) */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    {/* Health Score - Big Card */}
                    <div className="md:col-span-2 bg-zinc-900 rounded-2xl p-6 border border-zinc-800 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-6 opacity-10">
                            <Activity className="w-32 h-32 text-white" />
                        </div>
                        <h4 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Policy Health Score</h4>
                        <div className="flex items-end gap-4">
                            <span className="text-6xl font-black text-white tracking-tighter">{normalizedScore}%</span>
                            <div className="pb-3">
                                <span className="text-xs font-bold px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white uppercase">
                                    {normalizedScore > 70 ? "Excellent" : normalizedScore > 40 ? "Average" : "Poor"}
                                </span>
                            </div>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full bg-zinc-800 h-2 rounded-full mt-4 overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-rose-500 to-orange-500" 
                                style={{width: `${normalizedScore}%`}}
                            ></div>
                        </div>
                    </div>

                    <StatCard icon={<XCircle/>} label="Critical Exclusions" value={stats.exclusions} color="text-rose-500" />
                    <StatCard icon={<Clock/>} label="Waiting Periods" value={stats.waiting} color="text-amber-500" />
                    <StatCard icon={<DollarSign/>} label="Financial Limits" value={stats.limits} color="text-blue-500" />
                    <StatCard icon={<AlertTriangle/>} label="Rejection Risks" value={stats.risks} color="text-purple-500" />
                </div>

                {/* 2. DETAILED ANALYSIS SECTIONS */}
                <div className="space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Left Col: The Bad News */}
                      <div className="space-y-8">
                          <Section 
                            title="PERMANENT EXCLUSIONS" 
                            subtitle="Conditions permanently removed from scope."
                            rules={getRules("exclusion")}
                            accent="bg-rose-600"
                            icon={<XCircle className="w-5 h-5 text-rose-500"/>}
                          />
                          <Section 
                            title="REJECTION RISKS" 
                            subtitle="Procedural gaps leading to denial."
                            rules={getRules("claim_rejection")}
                            accent="bg-purple-600"
                            icon={<AlertTriangle className="w-5 h-5 text-purple-500"/>}
                          />
                      </div>

                      {/* Right Col: The Limits & Wait times */}
                      <div className="space-y-8">
                          <Section 
                            title="WAITING PERIODS" 
                            subtitle="Time before coverage becomes active."
                            rules={getRules("waiting_period")}
                            accent="bg-amber-500"
                            icon={<Clock className="w-5 h-5 text-amber-500"/>}
                          />
                          <Section 
                            title="FINANCIAL LIMITS" 
                            subtitle="Sub-limits, Co-pays and Capping."
                            rules={getRules("financial_limit")}
                            accent="bg-blue-500"
                            icon={<DollarSign className="w-5 h-5 text-blue-500"/>}
                          />
                      </div>
                  </div>

                  {/* Coverage Section (Full Width) */}
                  <Section 
                    title="COVERAGE HIGHLIGHTS" 
                    subtitle="What is actually included in this policy."
                    rules={getRules("coverage")}
                    accent="bg-emerald-500"
                    icon={<CheckCircle className="w-5 h-5 text-emerald-500"/>}
                    gridCols={2}
                  />
                </div>

              </div>
            </div>
          ) : (
            // EMPTY STATE
            <div className="h-full min-h-[600px] flex flex-col items-center justify-center bg-zinc-900/30 border-2 border-dashed border-zinc-800 rounded-[32px] text-center p-8">
              <div className="bg-zinc-900 p-8 rounded-full mb-6 border border-zinc-800 shadow-2xl">
                <LayoutDashboard className="w-16 h-16 text-zinc-700" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-2">System Ready</h3>
              <p className="text-sm font-medium text-zinc-500 max-w-md">
                Upload a policy PDF to activate the Neural Engine and generate a comprehensive risk audit.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ════ COMPONENT LIBRARY ════

function StatCard({ icon, label, value, color }: { icon: any, label: string, value: number, color: string }) {
  return (
    <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between hover:border-zinc-700 transition-colors">
      <div className={`${color} mb-4`}>{icon}</div>
      <div>
        <div className="text-4xl font-black text-white font-mono tracking-tighter mb-1">{value}</div>
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, rules, accent, icon, gridCols = 1 }: any) {
  if (!rules || rules.length === 0) return null;

  return (
    <div className="bg-zinc-900/50 rounded-3xl p-1">
        <div className="bg-zinc-950 rounded-[20px] border border-zinc-800 p-6">
            <div className="flex items-start gap-4 mb-6 border-b border-zinc-900 pb-6">
                <div className={`w-1.5 h-10 ${accent} rounded-full shadow-[0_0_15px_rgba(255,255,255,0.1)]`}></div>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        {icon}
                        <h3 className="text-lg font-black text-white tracking-wide uppercase">{title}</h3>
                    </div>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{subtitle}</p>
                </div>
                <span className="px-3 py-1 bg-zinc-900 rounded border border-zinc-800 text-[10px] font-mono font-bold text-zinc-400">
                    {rules.length} ITEMS
                </span>
            </div>
            
            <div className={`grid grid-cols-1 ${gridCols === 2 ? 'md:grid-cols-2' : ''} gap-3`}>
                {rules.map((r: any, i: number) => (
                <div key={i} className="bg-zinc-900/50 border border-zinc-900 p-4 rounded-xl flex gap-3 items-start hover:border-zinc-700 transition-colors group">
                    <ChevronRight className="w-4 h-4 text-zinc-600 mt-0.5 shrink-0 group-hover:text-white transition-colors" />
                    <p className="text-xs font-medium text-zinc-300 leading-relaxed font-mono">
                        {r.text}
                    </p>
                </div>
                ))}
            </div>
        </div>
    </div>
  );
}