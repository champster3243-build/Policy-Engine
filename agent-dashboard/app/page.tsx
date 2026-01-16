/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY AGENT: "PROFESSIONAL INTELLIGENCE" (Light/Clean UI)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * * DESIGN PHILOSOPHY: Clean, Trustworthy, Readable, Semantic Colors.
 * * TECH STACK: Next.js + Tailwind + html-to-image
 * * REFERENCE: Based on "KnowYourCover" dashboard aesthetic.
 * */

"use client";

import { useState } from "react";
import { 
  Upload, FileText, Shield, Download, Loader2, Activity, 
  AlertTriangle, Clock, DollarSign, XCircle, CheckCircle, 
  Zap, Info, ChevronRight, FileCheck, Building2, Fingerprint
} from "lucide-react";
import { toPng } from 'html-to-image';
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

  // --- EXPORT LOGIC (Configured for Light Mode) ---
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;

    const btn = document.getElementById("export-btn");
    if(btn) btn.innerText = "GENERATING PDF...";

    try {
      // Capture the element with a clean white background
      const dataUrl = await toPng(element, { 
        cacheBust: true,
        backgroundColor: '#f8fafc', // Match the bg-slate-50 of the dashboard
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

      pdf.save(`Policy-Audit-${data?.meta?.policy_name || "Report"}.pdf`);
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      
      {/* ════ NAVBAR: CLEAN & PROFESSIONAL ════ */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Policy<span className="text-blue-600">Intelligence</span>
              </h1>
              <p className="text-xs font-medium text-slate-500">Automated Risk Audit</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {data?.isCached && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span className="text-xs font-bold uppercase tracking-wide">Instant Retrieve</span>
              </div>
            )}
            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
              AG
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 xl:grid-cols-12 gap-8 mt-4">
        
        {/* ════ LEFT SIDEBAR: ACTIONS & METADATA (3 Columns) ════ */}
        <div className="xl:col-span-3 space-y-6">
          
          {/* UPLOAD CARD */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload Policy
            </h2>

            <label className="block w-full aspect-[4/3] border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all duration-300 group">
              <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <div className="bg-slate-100 p-4 rounded-full mb-3 group-hover:scale-110 transition-transform group-hover:bg-white group-hover:shadow-md">
                <FileText className="w-8 h-8 text-slate-400 group-hover:text-blue-600" />
              </div>
              <p className="text-sm font-bold text-slate-700">{file ? file.name : "Select PDF Document"}</p>
              <p className="text-xs text-slate-400 mt-1">Max Size: 10MB</p>
            </label>

            <button 
              onClick={handleUpload} 
              disabled={!file || loading}
              className="w-full mt-4 bg-slate-900 text-white font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
            >
              {loading ? <Loader2 className="animate-spin w-4 h-4"/> : "Analyze Policy"}
            </button>
          </div>

          {/* POLICY IDENTITY CARD (New Feature: Basic Details) */}
          {data?.meta && (
            <div className="bg-white rounded-2xl p-0 shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Fingerprint className="w-4 h-4" /> Policy Identity
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Policy Name</label>
                  <p className="text-sm font-bold text-slate-900 leading-tight">
                    {data.meta.policy_name || "Not Detected"}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Insurer</label>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">{data.meta.insurer || "Generic"}</p>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">UIN / Ref</label>
                  <div className="inline-block bg-slate-100 px-2 py-1 rounded text-xs font-mono font-medium text-slate-600 border border-slate-200">
                    {data.meta.uin || "N/A"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PROCESSING STATS */}
          {data?.meta && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Processing Stats</h3>
               <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Total Chunks</span>
                  <span className="font-bold text-slate-900">{data.meta.totalChunks}</span>
               </div>
               <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 mb-4 overflow-hidden">
                  <div className="h-full bg-blue-500 w-full"></div>
               </div>
               <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Parsed Successfully</span>
                  <span className="font-bold text-emerald-600">{data.meta.parsedChunks}</span>
               </div>
            </div>
          )}
        </div>

        {/* ════ RIGHT: INTELLIGENCE DECK (9 Columns) ════ */}
        <div className="xl:col-span-9">
          {data ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              
              {/* TOP ACTIONS */}
              <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3">
                      <div className="bg-green-100 p-2 rounded-full">
                        <FileCheck className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">Audit Ready</h2>
                        <p className="text-xs text-slate-500">Generated on {new Date().toLocaleDateString()}</p>
                      </div>
                  </div>
                  <button 
                    id="export-btn"
                    onClick={exportPDF}
                    className="bg-white text-slate-700 hover:bg-slate-50 hover:text-blue-600 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide flex items-center gap-2 border border-slate-300 transition-all shadow-sm hover:shadow"
                  >
                    <Download className="w-4 h-4" /> Download Report
                  </button>
              </div>

              {/* ════ THE REPORT CONTAINER (CAPTURED AREA) ════ */}
              <div id="analysis-results" className="bg-slate-50/50 space-y-8">
                
                {/* 1. SCORECARDS ROW */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <StatCard label="Total Rules" value={stats.total} icon={<Info/>} color="slate" />
                    <StatCard label="Exclusions" value={stats.exclusions} icon={<XCircle/>} color="red" />
                    <StatCard label="Waiting Periods" value={stats.waiting} icon={<Clock/>} color="amber" />
                    <StatCard label="Fin. Limits" value={stats.limits} icon={<DollarSign/>} color="blue" />
                    <StatCard label="Risk Factors" value={stats.risks} icon={<AlertTriangle/>} color="purple" />
                    <StatCard label="Coverage" value={stats.coverage} icon={<CheckCircle/>} color="green" />
                </div>

                {/* 2. MAIN INTELLIGENCE GRID */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* COL 1: The "Bad" News (Risks) */}
                    <div className="space-y-8">
                        <Section 
                          title="Exclusion Alerts" 
                          subtitle="Critical conditions not covered"
                          rules={getRules("exclusion")}
                          theme="red"
                          icon={<XCircle className="w-5 h-5 text-white"/>}
                        />
                        <Section 
                          title="Claim Rejection Risks" 
                          subtitle="Process gaps leading to denial"
                          rules={getRules("claim_rejection")}
                          theme="purple"
                          icon={<AlertTriangle className="w-5 h-5 text-white"/>}
                        />
                    </div>

                    {/* COL 2: The "Technical" Details */}
                    <div className="space-y-8">
                        <Section 
                          title="Waiting Period Timeline" 
                          subtitle="Delays before coverage starts"
                          rules={getRules("waiting_period")}
                          theme="amber"
                          icon={<Clock className="w-5 h-5 text-white"/>}
                        />
                        <Section 
                          title="Financial Limits" 
                          subtitle="Capping, Co-pays & Sub-limits"
                          rules={getRules("financial_limit")}
                          theme="blue"
                          icon={<DollarSign className="w-5 h-5 text-white"/>}
                        />
                    </div>
                </div>

                {/* 3. COVERAGE & DEFINITIONS (Full Width) */}
                <div className="space-y-8">
                   <Section 
                      title="Coverage Highlights" 
                      subtitle="Items explicitly included in the policy"
                      rules={getRules("coverage")}
                      theme="green"
                      icon={<CheckCircle className="w-5 h-5 text-white"/>}
                      gridCols={2}
                    />

                    {data.cpdm?.definitions && (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="bg-slate-100 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                           <FileText className="w-5 h-5 text-slate-500" />
                           <h3 className="font-bold text-slate-800">Policy Definitions</h3>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {data.cpdm.definitions.map((def, i) => (
                            <div key={i} className="group p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200">
                              <span className="text-xs font-bold text-blue-700 uppercase block mb-1">{def.term}</span>
                              <span className="text-sm text-slate-600 leading-relaxed">{def.definition}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>

              </div>
            </div>
          ) : (
            // EMPTY STATE
            <div className="h-full min-h-[600px] flex flex-col items-center justify-center bg-white border-2 border-dashed border-slate-200 rounded-3xl text-center p-8">
              <div className="bg-slate-50 p-8 rounded-full mb-6 shadow-inner">
                <Shield className="w-16 h-16 text-slate-300" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-2">Policy Intelligence Engine</h3>
              <p className="text-slate-500 max-w-md mx-auto">
                Upload a policy PDF on the left to generate a comprehensive risk audit, financial analysis, and coverage breakdown.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ════ COMPONENT LIBRARY ════

function StatCard({ label, value, icon, color }: { label: string, value: number, icon: any, color: string }) {
  const themes: any = {
    slate: "bg-white border-slate-200 text-slate-600",
    red: "bg-red-50 border-red-100 text-red-600",
    amber: "bg-amber-50 border-amber-100 text-amber-600",
    blue: "bg-blue-50 border-blue-100 text-blue-600",
    purple: "bg-purple-50 border-purple-100 text-purple-600",
    green: "bg-emerald-50 border-emerald-100 text-emerald-600",
  };

  return (
    <div className={`p-4 rounded-xl border ${themes[color]} shadow-sm flex flex-col items-center justify-center text-center transition-transform hover:scale-105`}>
      <div className="mb-2 opacity-80">{icon}</div>
      <div className="text-2xl font-black">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

function Section({ title, subtitle, rules, theme, icon, gridCols = 1 }: any) {
  if (!rules || rules.length === 0) return null;

  // Theme Maps for semantic headers
  const themes: any = {
    red: { header: "bg-red-600", bg: "bg-white", border: "border-red-100", title: "text-white" },
    amber: { header: "bg-amber-500", bg: "bg-white", border: "border-amber-100", title: "text-white" },
    blue: { header: "bg-blue-600", bg: "bg-white", border: "border-blue-100", title: "text-white" },
    purple: { header: "bg-purple-600", bg: "bg-white", border: "border-purple-100", title: "text-white" },
    green: { header: "bg-emerald-600", bg: "bg-white", border: "border-emerald-100", title: "text-white" },
  };

  const t = themes[theme];

  return (
    <div className={`rounded-xl overflow-hidden shadow-sm border ${t.border} bg-white`}>
        {/* Section Header */}
        <div className={`${t.header} px-6 py-4 flex justify-between items-center`}>
            <div className="flex items-center gap-3">
                {icon}
                <div>
                    <h3 className={`text-lg font-bold ${t.title}`}>{title}</h3>
                    <p className="text-xs text-white/80 font-medium">{subtitle}</p>
                </div>
            </div>
            <span className="bg-white/20 text-white text-xs font-bold px-2 py-1 rounded">
                {rules.length}
            </span>
        </div>
        
        {/* Content List */}
        <div className={`p-4 grid grid-cols-1 ${gridCols === 2 ? 'md:grid-cols-2' : ''} gap-3`}>
            {rules.map((r: any, i: number) => (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all">
                <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 opacity-40 text-${theme}-600`} />
                <p className="text-sm font-medium text-slate-700 leading-relaxed">
                    {r.text}
                </p>
            </div>
            ))}
        </div>
    </div>
  );
}