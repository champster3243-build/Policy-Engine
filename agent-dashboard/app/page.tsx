/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY ANALYSIS AGENT DASHBOARD - FINAL EXPORT FIX (CSS INJECTION)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * * PURPOSE: Frontend interface for insurance policy analysis
 * * FEATURES:
 * 1. PDF Upload with drag-and-drop
 * 2. Animated progress bar during analysis
 * 3. Categorized results display (Exclusions, Waiting Periods, etc.)
 * 4. PDF Export of analysis results (FIXED: CSS Injection to bypass LAB colors)
 * 5. Caching indicator (shows if results from library)
 * 6. Statistics dashboard
 * * STATE MANAGEMENT:
 * - loading: Boolean for showing progress UI
 * - data: API response object with analysis results
 * - file: Selected PDF file
 * */

"use client";

import { useState } from "react";
import { 
  Upload, 
  FileText, 
  Shield, 
  Download, 
  Loader2, 
  Activity,
  AlertTriangle,
  Clock,
  DollarSign,
  XCircle,
  CheckCircle,
  Info,
  ChevronRight
} from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * TYPE DEFINITIONS
 */
interface Rule {
  category: string;
  text: string;
}

interface PolicyMeta {
  policy_name?: string;
  insurer?: string;
  uin?: string;
  document_type?: string;
  policy_year?: string;
  totalChunks?: number;
  parsedChunks?: number;
  failedChunks?: number;
}

interface AnalysisData {
  isCached?: boolean;
  jobId?: string;
  fileUrl?: string;
  message?: string;
  meta?: PolicyMeta;
  cpdm?: {
    meta?: PolicyMeta;
    definitions?: Array<{ term: string; definition: string }>;
    rules?: Rule[];
  };
}

export default function AgentDashboard() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisData | null>(null);
  const [file, setFile] = useState<File | null>(null);

  /**
   * handleUpload - Main upload and analysis function
   */
  const handleUpload = async () => {
    if (!file) {
      console.warn("⚠️  No file selected");
      return;
    }

    console.info("🚀 Initiating upload...");
    setLoading(true);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      const res = await fetch(`${apiUrl}/upload-pdf`, { 
        method: "POST", 
        body: formData 
      });

      const result = await res.json();
      setData(result);
      
    } catch (e) {
      console.error("❌ Frontend Error:", e);
      alert("Analysis failed. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * exportPDF - CSS INJECTION FIX
   * Injects a style block that forces HEX colors for all Tailwind classes used.
   * This prevents the browser from computing 'lab()' or 'oklch()' colors.
   */
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    
    if (!element) {
      console.error("❌ Export target not found");
      return;
    }

    console.info("📸 Capturing audit report (Injecting Safe CSS)...");
    
    try {
      const canvas = await html2canvas(element, { 
        scale: 2,           
        useCORS: true,      
        logging: false,
        backgroundColor: "#ffffff",
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        
        onclone: (clonedDoc) => {
          const results = clonedDoc.getElementById("analysis-results");
          if (results) {
            // 1. Hard reset container
            results.style.backgroundColor = "#ffffff";
            results.style.color = "#000000";
            
            // 2. CSS INJECTION: Define safe HEX values for every class we use
            const style = clonedDoc.createElement('style');
            style.innerHTML = `
              * { box-shadow: none !important; text-shadow: none !important; }
              .bg-slate-950 { background-color: #020617 !important; }
              .bg-slate-900 { background-color: #0f172a !important; }
              .bg-slate-100 { background-color: #f1f5f9 !important; }
              .bg-slate-50 { background-color: #f8fafc !important; }
              .bg-white { background-color: #ffffff !important; }
              .bg-red-50 { background-color: #fef2f2 !important; }
              .bg-amber-50 { background-color: #fffbeb !important; }
              .bg-blue-50 { background-color: #eff6ff !important; }
              .bg-emerald-50 { background-color: #ecfdf5 !important; }
              .bg-purple-50 { background-color: #faf5ff !important; }
              .bg-indigo-600 { background-color: #4f46e5 !important; }
              .bg-emerald-100 { background-color: #d1fae5 !important; }
              
              .text-slate-900 { color: #0f172a !important; }
              .text-white { color: #ffffff !important; }
              .text-slate-400 { color: #94a3b8 !important; }
              .text-slate-500 { color: #64748b !important; }
              .text-slate-600 { color: #475569 !important; }
              .text-slate-700 { color: #334155 !important; }
              .text-indigo-600 { color: #4f46e5 !important; }
              .text-emerald-700 { color: #047857 !important; }
              .text-red-950 { color: #450a0a !important; }
              .text-amber-950 { color: #451a03 !important; }
              .text-blue-950 { color: #172554 !important; }
              .text-purple-950 { color: #3b0764 !important; }
              
              .border-slate-100 { border-color: #f1f5f9 !important; }
              .border-slate-200 { border-color: #e2e8f0 !important; }
              .border-red-100 { border-color: #fee2e2 !important; }
              .border-amber-100 { border-color: #fef3c7 !important; }
              .border-blue-100 { border-color: #dbeafe !important; }
              .border-emerald-100 { border-color: #d1fae5 !important; }
              .border-purple-100 { border-color: #f3e8ff !important; }
            `;
            clonedDoc.head.appendChild(style);

            // 3. Fallback Iteration (Just in case)
            const allElements = results.querySelectorAll('*');
            allElements.forEach((el) => {
               const htmlEl = el as HTMLElement;
               // If any style still computes to lab/oklch, force it to black/white
               const computed = window.getComputedStyle(htmlEl);
               if (computed.backgroundColor.includes('lab') || computed.backgroundColor.includes('oklch')) {
                   htmlEl.style.backgroundColor = '#ffffff';
               }
               if (computed.color.includes('lab') || computed.color.includes('oklch')) {
                   htmlEl.style.color = '#000000';
               }
               if (computed.borderColor.includes('lab') || computed.borderColor.includes('oklch')) {
                   htmlEl.style.borderColor = '#e2e8f0';
               }
            });
          }
        }
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const imgWidth = 210; 
      const pageHeight = 297; 
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL("image/png");

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`Audit-Report-${data?.meta?.policy_name || "Policy"}.pdf`);
      console.info("✅ Export successful");
    } catch (error) {
      console.error("❌ Export failed:", error);
      alert("Export Error: Browser color incompatibility. Please try Chrome/Edge.");
    }
  };

  const getRulesByCategory = (category: string): Rule[] => {
    return data?.cpdm?.rules?.filter(r => r.category === category) || [];
  };

  const getStats = () => {
    const rules = data?.cpdm?.rules || [];
    return {
      total: rules.length,
      exclusions: rules.filter(r => r.category === "exclusion").length,
      waitingPeriods: rules.filter(r => r.category === "waiting_period").length,
      financialLimits: rules.filter(r => r.category === "financial_limit").length,
      coverage: rules.filter(r => r.category === "coverage").length,
      claimRejection: rules.filter(r => r.category === "claim_rejection").length
    };
  };

  return (
    <div className="min-h-screen bg-slate-100 p-8 text-slate-900 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER SECTION */}
        <div className="bg-slate-950 p-8 rounded-2xl shadow-2xl flex justify-between items-center text-white border border-slate-800">
          <div className="flex items-center gap-5">
            <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
              <Shield className="w-8 h-8 text-white"/> 
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter text-white">AGENT COMMAND CENTER</h1>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Policy Audit & Compliance Intelligence</p>
            </div>
          </div>
          
          {data?.isCached && (
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-4 py-2 rounded-full">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black tracking-widest uppercase">Library Record</span>
            </div>
          )}
        </div>

        {/* MAIN CONTENT GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT COLUMN: UPLOAD CONTROLS */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
              <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Activity className="w-4 h-4 text-indigo-600" /> Input Controls
              </h2>
              
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center relative hover:border-indigo-500 hover:bg-slate-50 transition-all group cursor-pointer">
                <input 
                  type="file" 
                  accept=".pdf"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0];
                    if (selectedFile) setFile(selectedFile);
                  }} 
                  className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                />
                
                <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform group-hover:bg-indigo-50">
                  <FileText className="text-slate-400 w-8 h-8 group-hover:text-indigo-600 transition-colors" />
                </div>
                <p className="text-sm font-bold text-slate-700 group-hover:text-slate-900">
                  {file ? file.name : "Drop policy PDF here"}
                </p>
                <p className="text-[10px] uppercase font-black text-slate-400 mt-2 tracking-widest">
                  {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Max 10MB"}
                </p>
              </div>
              
              {loading && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                     <span className="text-[10px] uppercase font-black text-indigo-600 animate-pulse">Deep Scanning...</span>
                  </div>
                  <div className="bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div className="bg-indigo-600 h-full w-full origin-left animate-[loading_20s_ease-in-out_infinite]"></div>
                  </div>
                </div>
              )}
              
              <button 
                onClick={handleUpload} 
                disabled={loading || !file}
                className="w-full bg-slate-900 text-white font-black py-4 rounded-xl uppercase text-[11px] tracking-[0.2em] hover:bg-indigo-600 transition-all shadow-xl shadow-slate-200 active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin w-4 h-4"/> : <Upload className="w-4 h-4"/>}
                {loading ? "Processing..." : "Analyze Policy"}
              </button>
            </div>

            {data?.meta && (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4 flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-400" /> Metadata
                </h3>
                <div className="grid grid-cols-2 gap-3">
                   <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Total Chunks</p>
                      <p className="text-xl font-black text-slate-700">{data.meta.totalChunks}</p>
                   </div>
                   <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                      <p className="text-[10px] text-emerald-600 uppercase font-bold mb-1">Success Rate</p>
                      <p className="text-xl font-black text-emerald-700">{data.meta.parsedChunks}</p>
                   </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: ANALYSIS RESULTS */}
          <div className="lg:col-span-8 space-y-6">
            {data ? (
              <>
                <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide px-2">Ready for Export</span>
                  <button 
                    onClick={exportPDF} 
                    className="bg-indigo-600 text-white px-6 py-3 rounded-lg text-[11px] font-black uppercase tracking-[0.1em] flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg"
                  >
                    <Download className="w-4 h-4"/> 
                    Download PDF Report
                  </button>
                </div>

                {/* THIS DIV IS CAPTURED BY HTML2CANVAS */}
                <div id="analysis-results" className="space-y-8 bg-white p-12 rounded-3xl border border-slate-200 shadow-xl">
                  
                  {/* Report Header */}
                  <div className="border-b-2 border-slate-100 pb-8">
                    <div className="flex items-center gap-3 mb-4">
                       <div className="bg-emerald-100 text-emerald-700 p-2 rounded-lg">
                          <CheckCircle className="w-6 h-6" />
                       </div>
                       <span className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Analysis Complete</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 leading-tight tracking-tight mb-4">
                      {data.cpdm?.meta?.policy_name || data.meta?.policy_name || "Policy Analysis Report"}
                    </h2>
                    <div className="flex flex-wrap gap-3">
                        <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                          {data.cpdm?.meta?.insurer || "Unknown Insurer"}
                        </span>
                        {data.cpdm?.meta?.uin && (
                          <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                            UIN: {data.cpdm.meta.uin}
                          </span>
                        )}
                    </div>
                  </div>

                  {/* Statistics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {(() => {
                      const stats = getStats();
                      return (
                        <>
                          <StatCard 
                            icon={<XCircle className="w-5 h-5" />}
                            label="Critical Exclusions"
                            value={stats.exclusions}
                            color="red"
                          />
                          <StatCard 
                            icon={<Clock className="w-5 h-5" />}
                            label="Waiting Periods"
                            value={stats.waitingPeriods}
                            color="amber"
                          />
                          <StatCard 
                            icon={<DollarSign className="w-5 h-5" />}
                            label="Financial Limits"
                            value={stats.financialLimits}
                            color="blue"
                          />
                          <StatCard 
                            icon={<CheckCircle className="w-5 h-5" />}
                            label="Coverage Points"
                            value={stats.coverage}
                            color="emerald"
                          />
                          <StatCard 
                            icon={<AlertTriangle className="w-5 h-5" />}
                            label="Rejection Risks"
                            value={stats.claimRejection}
                            color="purple"
                          />
                          <StatCard 
                            icon={<Info className="w-5 h-5" />}
                            label="Total Rules"
                            value={stats.total}
                            color="slate"
                          />
                        </>
                      );
                    })()}
                  </div>

                  <div className="space-y-12 pt-4">
                    <RuleSection
                      title="Permanent Exclusions"
                      subtitle="Specific medical conditions and scenarios that are explicitly removed from coverage."
                      rules={getRulesByCategory("exclusion")}
                      accentColor="bg-red-600"
                      bgColor="bg-red-50"
                      textColor="text-red-950"
                      borderColor="border-red-100"
                    />

                    <RuleSection
                      title="Waiting Periods"
                      subtitle="Mandatory time durations before specific coverage benefits become active."
                      rules={getRulesByCategory("waiting_period")}
                      accentColor="bg-amber-500"
                      bgColor="bg-amber-50"
                      textColor="text-amber-950"
                      borderColor="border-amber-100"
                    />

                    <RuleSection
                      title="Financial Limits & Co-Pays"
                      subtitle="Monetary caps, sub-limits on rooms/procedures, and co-payment requirements."
                      rules={getRulesByCategory("financial_limit")}
                      accentColor="bg-blue-500"
                      bgColor="bg-blue-50"
                      textColor="text-blue-950"
                      borderColor="border-blue-100"
                    />

                    <RuleSection
                      title="Claim Rejection Risks"
                      subtitle="Procedural or documentation failures that could lead to claim denial."
                      rules={getRulesByCategory("claim_rejection")}
                      accentColor="bg-purple-600"
                      bgColor="bg-purple-50"
                      textColor="text-purple-950"
                      borderColor="border-purple-100"
                    />

                    {data.cpdm?.definitions && data.cpdm.definitions.length > 0 && (
                      <div className="pt-8 border-t-2 border-slate-100">
                        <h3 className="font-black text-[12px] uppercase tracking-[0.2em] text-slate-400 mb-8 flex items-center gap-2">
                           <FileText className="w-4 h-4" /> Policy Definitions
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {data.cpdm.definitions.map((def, i) => (
                            <div key={i} className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                              <dt className="font-black text-[11px] uppercase tracking-wider text-indigo-600 mb-2 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></div>
                                {def.term}
                              </dt>
                              <dd className="text-xs text-slate-700 font-medium leading-relaxed">{def.definition}</dd>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full min-h-[600px] flex flex-col items-center justify-center bg-white border-2 border-dashed border-slate-200 rounded-3xl text-slate-300">
                <div className="bg-slate-50 p-6 rounded-full mb-4">
                  <Shield className="w-16 h-16 text-slate-200 opacity-50" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-widest text-slate-400">Analysis Engine Idle</h3>
                <p className="text-xs font-medium text-slate-400 mt-2">Upload a policy to generate intelligence report</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes loading {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(0.5); }
          100% { transform: scaleX(0.9); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════════════

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "red" | "amber" | "blue" | "emerald" | "purple" | "slate";
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorMap = {
    red: "bg-red-50 text-red-700 border-red-100 ring-red-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100 ring-emerald-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100 ring-purple-100",
    slate: "bg-slate-50 text-slate-700 border-slate-200 ring-slate-100"
  };

  return (
    <div className={`${colorMap[color]} p-5 rounded-2xl border hover:ring-4 transition-all duration-300 cursor-default group`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="opacity-70 group-hover:scale-110 transition-transform">{icon}</div>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <div className="text-4xl font-black tracking-tighter">{value}</div>
    </div>
  );
}

interface RuleSectionProps {
  title: string;
  subtitle: string;
  rules: Rule[];
  accentColor: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

function RuleSection({ title, subtitle, rules, accentColor, bgColor, textColor, borderColor }: RuleSectionProps) {
  if (rules.length === 0) return null;

  return (
    <div className="group">
      <div className="flex items-start gap-4 mb-6">
         <div className={`w-1.5 h-12 ${accentColor} rounded-full mt-1 shrink-0`}></div>
         <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">{title}</h3>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mt-1">{subtitle}</p>
         </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 pl-6">
        {rules.map((item, i) => (
          <li 
            key={i} 
            className={`${bgColor} ${textColor} border ${borderColor} p-5 rounded-xl text-[13px] font-bold leading-relaxed flex gap-4 items-start hover:shadow-md transition-all`}
          >
            <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 opacity-50" />
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}