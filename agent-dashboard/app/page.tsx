/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY ANALYSIS AGENT DASHBOARD - UI ENHANCED & EXPORT FIXED
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * * PURPOSE: Frontend interface for insurance policy analysis
 * * FEATURES:
 * 1. PDF Upload with drag-and-drop
 * 2. Animated progress bar during analysis
 * 3. Categorized results display (Exclusions, Waiting Periods, etc.)
 * 4. PDF Export of analysis results (FIXED: Full container capture)
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
  Info
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
   * exportPDF - FIXED version
   * Added scroll height awareness and window.devicePixelRatio adjustment
   */
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    
    if (!element) {
      console.error("❌ Export target not found");
      return;
    }

    console.info("📸 Capturing audit report...");
    
    try {
      // Use window.scrollTo(0,0) or capture with scroll options to ensure full height
      const canvas = await html2canvas(element, { 
        scale: 2,           
        useCORS: true,      
        logging: false,
        backgroundColor: "#ffffff", // Ensure white background in PDF
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL("image/png");

      // Add first page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Handle multi-page PDF if content is long
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
    <div className="min-h-screen bg-slate-100 p-8 text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER SECTION */}
        <div className="bg-slate-900 p-8 rounded-2xl shadow-xl flex justify-between items-center text-white">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-xl shadow-lg shadow-blue-500/30">
              <Shield className="w-8 h-8 text-white"/> 
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Agent Command Center</h1>
              <p className="text-slate-400 text-sm font-medium">Policy Audit & Compliance Intelligence</p>
            </div>
          </div>
          
          {data?.isCached && (
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-full text-xs font-black tracking-widest uppercase">
              ⚡ Library Record Found
            </span>
          )}
        </div>

        {/* MAIN CONTENT GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT COLUMN: UPLOAD CONTROLS */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Activity className="w-3 h-3" /> Input Controls
              </h2>
              
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center relative hover:border-blue-500 hover:bg-blue-50/30 transition-all group">
                <input 
                  type="file" 
                  accept=".pdf"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0];
                    if (selectedFile) setFile(selectedFile);
                  }} 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                
                <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <FileText className="text-slate-400 w-8 h-8" />
                </div>
                <p className="text-sm font-bold text-slate-700">
                  {file ? file.name : "Drop policy PDF here"}
                </p>
                <p className="text-[10px] uppercase font-black text-slate-400 mt-2 tracking-widest">
                  {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Max 10MB"}
                </p>
              </div>
              
              {loading && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                     <span className="text-[10px] uppercase font-black text-blue-600 animate-pulse">Scanning Document...</span>
                  </div>
                  <div className="bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-600 h-full animate-[loading_10s_ease-in-out_infinite] origin-left"></div>
                  </div>
                </div>
              )}
              
              <button 
                onClick={handleUpload} 
                disabled={loading || !file}
                className="w-full bg-slate-900 text-white font-black py-4 rounded-xl uppercase text-[11px] tracking-[0.2em] hover:bg-blue-600 transition-all shadow-lg active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin w-4 h-4"/> : <Upload className="w-4 h-4"/>}
                {loading ? "Processing Engine..." : "Analyze Competitor Policy"}
              </button>
            </div>

            {data?.meta && (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">
                  Metadata Intelligence
                </h3>
                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-[10px] text-slate-400 uppercase font-bold">Chunks</p>
                      <p className="text-lg font-black">{data.meta.totalChunks}</p>
                   </div>
                   <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                      <p className="text-[10px] text-emerald-600 uppercase font-bold">Success</p>
                      <p className="text-lg font-black text-emerald-700">{data.meta.parsedChunks}</p>
                   </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: ANALYSIS RESULTS */}
          <div className="lg:col-span-2 space-y-4">
            {data && (
              <>
                <div className="flex justify-end">
                  <button 
                    onClick={exportPDF} 
                    className="bg-blue-600 text-white px-6 py-3 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-slate-900 transition-all shadow-lg shadow-blue-500/20"
                  >
                    <Download className="w-4 h-4"/> 
                    Download Audit Report
                  </button>
                </div>

                <div id="analysis-results" className="space-y-6 bg-white p-10 rounded-3xl border border-slate-200 shadow-xl">
                  
                  {/* Policy Header */}
                  <div className="border-b-4 border-slate-900 pb-6 mb-8">
                    <div className="flex items-center gap-3 mb-2">
                       <CheckCircle className="w-5 h-5 text-emerald-500" />
                       <span className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Analysis Output</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 leading-tight">
                      {data.cpdm?.meta?.policy_name || data.meta?.policy_name || "Policy Analysis"}
                    </h2>
                    <div className="mt-4 flex flex-wrap gap-4">
                        <span className="bg-slate-100 px-3 py-1 rounded text-[10px] font-bold text-slate-600 uppercase">{data.cpdm?.meta?.insurer || "Unknown Insurer"}</span>
                        {data.cpdm?.meta?.uin && <span className="bg-slate-100 px-3 py-1 rounded text-[10px] font-bold text-slate-600 uppercase">UIN: {data.cpdm.meta.uin}</span>}
                    </div>
                  </div>

                  {/* Statistics Dashboard */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                    {(() => {
                      const stats = getStats();
                      return (
                        <>
                          <StatCard 
                            icon={<XCircle className="w-5 h-5" />}
                            label="Exclusions"
                            value={stats.exclusions}
                            color="red"
                          />
                          <StatCard 
                            icon={<Clock className="w-5 h-5" />}
                            label="Waiting"
                            value={stats.waitingPeriods}
                            color="yellow"
                          />
                          <StatCard 
                            icon={<DollarSign className="w-5 h-5" />}
                            label="Limits"
                            value={stats.financialLimits}
                            color="orange"
                          />
                          <StatCard 
                            icon={<CheckCircle className="w-5 h-5" />}
                            label="Covered"
                            value={stats.coverage}
                            color="green"
                          />
                          <StatCard 
                            icon={<AlertTriangle className="w-5 h-5" />}
                            label="Claim Risks"
                            value={stats.claimRejection}
                            color="purple"
                          />
                          <StatCard 
                            icon={<Info className="w-5 h-5" />}
                            label="Rules"
                            value={stats.total}
                            color="blue"
                          />
                        </>
                      );
                    })()}
                  </div>

                  <div className="space-y-10">
                    <RuleSection
                      title="Permanent Exclusions"
                      subtitle="Items explicitly removed from coverage scope"
                      rules={getRulesByCategory("exclusion")}
                      accentColor="bg-red-600"
                      bgColor="bg-red-50"
                      textColor="text-red-950"
                    />

                    <RuleSection
                      title="Waiting Periods"
                      subtitle="Temporal requirements before claim eligibility"
                      rules={getRulesByCategory("waiting_period")}
                      accentColor="bg-yellow-500"
                      bgColor="bg-yellow-50"
                      textColor="text-yellow-950"
                    />

                    <RuleSection
                      title="Sub-Limits & Co-Pays"
                      subtitle="Financial caps and sharing arrangements"
                      rules={getRulesByCategory("financial_limit")}
                      accentColor="bg-orange-500"
                      bgColor="bg-orange-50"
                      textColor="text-orange-950"
                    />

                    <RuleSection
                      title="Claim Rejection Risks"
                      subtitle="Process gaps that may lead to claim denial"
                      rules={getRulesByCategory("claim_rejection")}
                      accentColor="bg-purple-600"
                      bgColor="bg-purple-50"
                      textColor="text-purple-950"
                    />

                    {data.cpdm?.definitions && data.cpdm.definitions.length > 0 && (
                      <div className="pt-8 border-t border-slate-100">
                        <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-2">
                           <FileText className="w-4 h-4" /> Comprehensive Definitions
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {data.cpdm.definitions.map((def, i) => (
                            <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                              <dt className="font-black text-[10px] uppercase tracking-wider text-blue-700 mb-1">{def.term}</dt>
                              <dd className="text-xs text-slate-700 font-medium leading-relaxed">{def.definition}</dd>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {!data && !loading && (
              <div className="bg-white p-24 rounded-3xl border-4 border-dashed border-slate-100 text-center">
                <div className="bg-slate-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-slate-200" />
                </div>
                <h3 className="text-2xl font-black text-slate-300 mb-2 uppercase tracking-tighter">
                  Analysis Engine Idle
                </h3>
                <p className="text-sm font-medium text-slate-400">
                  Awaiting competitor policy upload for processing
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes loading {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
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
  color: "red" | "yellow" | "orange" | "green" | "purple" | "blue";
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorMap = {
    red: "bg-red-50 text-red-700 border-red-100",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100"
  };

  return (
    <div className={`${colorMap[color]} p-4 rounded-2xl border-2`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="opacity-50">{icon}</div>
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-3xl font-black tracking-tighter">{value}</div>
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
}

function RuleSection({ title, subtitle, rules, accentColor, bgColor, textColor }: RuleSectionProps) {
  if (rules.length === 0) return null;

  return (
    <div className="group">
      <div className="flex items-center gap-4 mb-4">
         <div className={`w-2 h-8 ${accentColor} rounded-full`}></div>
         <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight">
              {title}
            </h3>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{subtitle}</p>
         </div>
      </div>
      <ul className="grid grid-cols-1 gap-3">
        {rules.map((item, i) => (
          <li 
            key={i} 
            className={`${bgColor} ${textColor} p-5 rounded-2xl text-[12.5px] font-bold leading-relaxed border-l-8 border-transparent hover:border-slate-900 transition-all shadow-sm`}
          >
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}