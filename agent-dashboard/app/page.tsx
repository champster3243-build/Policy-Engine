/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POLICY ANALYSIS AGENT DASHBOARD
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Frontend interface for insurance policy analysis
 * 
 * FEATURES:
 * 1. PDF Upload with drag-and-drop
 * 2. Animated progress bar during analysis
 * 3. Categorized results display (Exclusions, Waiting Periods, etc.)
 * 4. PDF Export of analysis results
 * 5. Caching indicator (shows if results from library)
 * 6. Statistics dashboard
 * 
 * STATE MANAGEMENT:
 * - loading: Boolean for showing progress UI
 * - data: API response object with analysis results
 * - file: Selected PDF file
 * 
 * API INTEGRATION:
 * - Connects to backend at NEXT_PUBLIC_API_URL
 * - Sends multipart/form-data with PDF
 * - Receives CPDM structure in response
 * 
 */

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
  CheckCircle
} from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * TYPE DEFINITIONS
 * 
 * Defines the structure of API response data
 * This helps with TypeScript autocomplete and type safety
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
  // ═══════════════════════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  /**
   * loading: Controls progress bar visibility and button state
   * - true: Show animated progress bar, disable upload button
   * - false: Hide progress bar, enable upload button
   */
  const [loading, setLoading] = useState(false);
  
  /**
   * data: Stores the complete API response
   * - null initially (no analysis performed yet)
   * - Contains cpdm, meta, and other response fields after upload
   */
  const [data, setData] = useState<AnalysisData | null>(null);
  
  /**
   * file: Currently selected PDF file
   * - null initially (no file selected)
   * - File object when user selects a PDF
   */
  const [file, setFile] = useState<File | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CORE FUNCTION: HANDLE PDF UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  /**
   * handleUpload - Main upload and analysis function
   * 
   * FLOW:
   * 1. Validate file is selected
   * 2. Create FormData with PDF
   * 3. POST to backend API
   * 4. Update UI with results
   * 
   * ERROR HANDLING:
   * - Network errors logged to console
   * - User sees error in browser console
   * - Loading state properly reset even on error
   */
  const handleUpload = async () => {
    // VALIDATION: Don't proceed if no file selected
    if (!file) {
      console.warn("⚠️  No file selected");
      return;
    }

    console.info("🚀 Initiating upload...");
    console.info("📄 File:", file.name, `(${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Start loading state (shows progress bar, disables button)
    setLoading(true);

    // Create multipart form data
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      // IMPORTANT: Use environment variable for API URL
      // This allows different URLs for development vs production
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      
      console.info("🌐 Calling API:", `${apiUrl}/upload-pdf`);
      
      // Send POST request to backend
      const res = await fetch(`${apiUrl}/upload-pdf`, { 
        method: "POST", 
        body: formData 
      });

      // Parse JSON response
      const result = await res.json();
      
      console.log("✅ Analysis Received:");
      console.log("   Job ID:", result.jobId);
      console.log("   Cached:", result.isCached || false);
      console.log("   Total Rules:", result.cpdm?.rules?.length || 0);
      console.log("   Definitions:", Object.keys(result.definitions || {}).length);
      
      // Store result in state (triggers UI update)
      setData(result);
      
    } catch (e) {
      console.error("❌ Frontend Error:", e);
      // TODO: Show user-friendly error message in UI
      alert("Analysis failed. Check console for details.");
    } finally {
      // Always stop loading, even if error occurred
      setLoading(false);
      console.info("🏁 Upload process complete");
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════════
  // FEATURE: PDF EXPORT
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  /**
   * exportPDF - Generate downloadable PDF report
   * 
   * HOW IT WORKS:
   * 1. html2canvas captures the #analysis-results div as image
   * 2. jsPDF creates a PDF and embeds the image
   * 3. User downloads "Audit-Report.pdf"
   * 
   * PARAMETERS:
   * - scale: 2 for high resolution (retina displays)
   * - useCORS: true to load external images (if any)
   * 
   * PDF FORMAT:
   * - Portrait orientation ("p")
   * - Millimeters ("mm")
   * - A4 size (210mm x 297mm)
   */
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    
    if (!element) {
      console.error("❌ Export target not found");
      return;
    }

    console.info("📸 Capturing screenshot...");
    
    // Capture div as canvas
    const canvas = await html2canvas(element, { 
      scale: 2,           // Higher resolution
      useCORS: true,      // Allow external resources
      logging: false      // Disable console logs from html2canvas
    });

    console.info("📄 Generating PDF...");
    
    // Create PDF document
    const pdf = new jsPDF("p", "mm", "a4");
    
    // Calculate dimensions to fit A4 (210mm width)
    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    // Add image to PDF
    pdf.addImage(
      canvas.toDataURL("image/png"), 
      "PNG", 
      0,        // X position
      0,        // Y position
      imgWidth, 
      imgHeight
    );
    
    // Trigger download
    pdf.save("Audit-Report.pdf");
    
    console.info("✅ PDF downloaded");
  };

  // ═══════════════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  /**
   * Filter rules by category
   * 
   * USAGE: getRulesByCategory("exclusion")
   * RETURNS: Array of rules with that category
   */
  const getRulesByCategory = (category: string): Rule[] => {
    return data?.cpdm?.rules?.filter(r => r.category === category) || [];
  };

  /**
   * Calculate statistics
   * 
   * RETURNS: Object with counts of each rule type
   */
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

  // ═══════════════════════════════════════════════════════════════════════════════════
  // RENDER UI
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* HEADER SECTION */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border flex justify-between items-center">
          <h1 className="text-3xl font-black flex items-center gap-3">
            <Shield className="text-blue-600"/> 
            Agent Center
          </h1>
          
          {/* CACHE INDICATOR: Shows if results are from library */}
          {data?.isCached && (
            <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">
              📚 Library Record
            </span>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* MAIN CONTENT GRID */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* ─────────────────────────────────────────────────────────────────── */}
          {/* LEFT COLUMN: UPLOAD CONTROLS */}
          {/* ─────────────────────────────────────────────────────────────────── */}
          <div className="bg-white p-6 rounded-2xl border space-y-6">
            
            {/* Section Header */}
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Controls
            </h2>
            
            {/* File Upload Zone */}
            <div className="border-2 border-dashed rounded-xl p-8 text-center relative hover:border-blue-400 transition-colors">
              {/* Hidden file input (activated by clicking anywhere in zone) */}
              <input 
                type="file" 
                accept=".pdf"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0];
                  if (selectedFile) {
                    console.info("📁 File selected:", selectedFile.name);
                    setFile(selectedFile);
                  }
                }} 
                className="absolute inset-0 opacity-0 cursor-pointer" 
              />
              
              <FileText className="mx-auto text-slate-300 w-12 h-12 mb-2" />
              <p className="text-sm font-bold text-slate-600">
                {file ? file.name : "Click to Select PDF"}
              </p>
              {file && (
                <p className="text-xs text-slate-400 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
            
            {/* Progress Bar (only visible when loading=true) */}
            {loading && (
              <div className="space-y-2">
                <div className="bg-slate-100 h-2 rounded-full overflow-hidden">
                  {/* 
                    ANIMATED PROGRESS BAR
                    
                    CSS Animation simulates progress (0% → 100% over 10 seconds)
                    This is a FAKE progress bar (we don't have real progress updates)
                    
                    For REAL progress, you would need:
                    1. Backend to emit progress events (Supabase Realtime)
                    2. Frontend to listen to those events
                    3. Update a state variable (e.g., progress: 0-100)
                  */}
                  <div className="bg-blue-600 h-full animate-[loading_10s_ease-in-out_infinite] origin-left"></div>
                </div>
                <p className="text-xs text-center text-slate-500 font-medium">
                  Analyzing policy... This may take 30-60 seconds
                </p>
              </div>
            )}
            
            {/* Upload Button */}
            <button 
              onClick={handleUpload} 
              disabled={loading || !file}
              className="w-full bg-blue-600 text-white font-black py-4 rounded-xl uppercase text-xs tracking-widest hover:bg-blue-700 transition-all disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin w-4 h-4"/> 
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4"/>
                  Run Deep Audit
                </>
              )}
            </button>

            {/* Processing Stats (only show if data exists) */}
            {data?.meta && (
              <div className="pt-4 border-t space-y-2">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Processing Stats
                </h3>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total Chunks:</span>
                    <span className="font-bold">{data.meta.totalChunks}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Parsed:</span>
                    <span className="font-bold text-green-600">{data.meta.parsedChunks}</span>
                  </div>
                  {(data.meta.failedChunks || 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Failed:</span>
                      <span className="font-bold text-red-600">{data.meta.failedChunks}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ─────────────────────────────────────────────────────────────────── */}
          {/* RIGHT COLUMN: ANALYSIS RESULTS (2/3 width) */}
          {/* ─────────────────────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Only show if analysis data exists */}
            {data && (
              <>
                {/* Export Button */}
                <div className="flex justify-end">
                  <button 
                    onClick={exportPDF} 
                    className="bg-white border px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-50 transition-colors"
                  >
                    <Download className="w-4 h-4"/> 
                    Export Report
                  </button>
                </div>

                {/* ═══════════════════════════════════════════════════════════ */}
                {/* ANALYSIS RESULTS CONTAINER (This gets exported to PDF) */}
                {/* ═══════════════════════════════════════════════════════════ */}
                <div id="analysis-results" className="space-y-6 bg-white p-8 rounded-2xl">
                  
                  {/* Policy Header */}
                  <div className="border-b pb-4">
                    <h2 className="text-2xl font-black text-slate-900">
                      {data.cpdm?.meta?.policy_name || data.meta?.policy_name || "Policy Analysis Report"}
                    </h2>
                    {data.cpdm?.meta?.insurer && (
                      <p className="text-sm text-slate-600 mt-1">
                        {data.cpdm.meta.insurer}
                      </p>
                    )}
                    {data.cpdm?.meta?.uin && (
                      <p className="text-xs text-slate-400 mt-1">
                        UIN: {data.cpdm.meta.uin}
                      </p>
                    )}
                  </div>

                  {/* Statistics Dashboard */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                            label="Waiting Periods"
                            value={stats.waitingPeriods}
                            color="yellow"
                          />
                          <StatCard 
                            icon={<DollarSign className="w-5 h-5" />}
                            label="Financial Limits"
                            value={stats.financialLimits}
                            color="orange"
                          />
                          <StatCard 
                            icon={<CheckCircle className="w-5 h-5" />}
                            label="Coverage"
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
                            icon={<FileText className="w-5 h-5" />}
                            label="Total Rules"
                            value={stats.total}
                            color="blue"
                          />
                        </>
                      );
                    })()}
                  </div>

                  {/* EXCLUSIONS SECTION */}
                  <RuleSection
                    title="🚫 Permanent Exclusions"
                    subtitle="Conditions that are NEVER covered under this policy"
                    rules={getRulesByCategory("exclusion")}
                    bgColor="bg-red-50"
                    borderColor="border-red-100"
                    textColor="text-red-800"
                  />

                  {/* WAITING PERIODS SECTION */}
                  <RuleSection
                    title="⏳ Waiting Periods"
                    subtitle="Time delays before coverage begins"
                    rules={getRulesByCategory("waiting_period")}
                    bgColor="bg-yellow-50"
                    borderColor="border-yellow-100"
                    textColor="text-yellow-800"
                  />

                  {/* FINANCIAL LIMITS SECTION */}
                  <RuleSection
                    title="💰 Financial Limits & Co-pays"
                    subtitle="Caps on coverage amounts and cost-sharing requirements"
                    rules={getRulesByCategory("financial_limit")}
                    bgColor="bg-orange-50"
                    borderColor="border-orange-100"
                    textColor="text-orange-800"
                  />

                  {/* CLAIM REJECTION RISKS */}
                  <RuleSection
                    title="⚠️ Claim Rejection Conditions"
                    subtitle="Reasons your claim might be denied"
                    rules={getRulesByCategory("claim_rejection")}
                    bgColor="bg-purple-50"
                    borderColor="border-purple-100"
                    textColor="text-purple-800"
                  />

                  {/* COVERAGE (optional, usually very long) */}
                  {getRulesByCategory("coverage").length > 0 && (
                    <RuleSection
                      title="✅ Coverage Highlights"
                      subtitle="What IS covered by this policy"
                      rules={getRulesByCategory("coverage").slice(0, 10)} // Limit to first 10
                      bgColor="bg-green-50"
                      borderColor="border-green-100"
                      textColor="text-green-800"
                    />
                  )}

                  {/* DEFINITIONS (collapsible) */}
                  {data.cpdm?.definitions && data.cpdm.definitions.length > 0 && (
                    <details className="border rounded-xl p-4">
                      <summary className="font-black text-sm uppercase tracking-widest text-slate-600 cursor-pointer">
                        📖 Definitions ({data.cpdm.definitions.length})
                      </summary>
                      <div className="mt-4 space-y-3">
                        {data.cpdm.definitions.map((def, i) => (
                          <div key={i} className="border-l-4 border-blue-200 pl-4">
                            <dt className="font-bold text-sm text-slate-900">{def.term}</dt>
                            <dd className="text-xs text-slate-600 mt-1">{def.definition}</dd>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </>
            )}

            {/* Empty State (no analysis yet) */}
            {!data && !loading && (
              <div className="bg-white p-16 rounded-2xl border-2 border-dashed text-center">
                <Shield className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                <h3 className="text-xl font-bold text-slate-400 mb-2">
                  No Analysis Yet
                </h3>
                <p className="text-sm text-slate-400">
                  Upload a policy PDF to begin analysis
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* GLOBAL STYLES (CSS Animation for Progress Bar) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
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

/**
 * STAT CARD COMPONENT
 * 
 * Displays a statistic with icon, label, and value
 */
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "red" | "yellow" | "orange" | "green" | "purple" | "blue";
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorMap = {
    red: "bg-red-100 text-red-700",
    yellow: "bg-yellow-100 text-yellow-700",
    orange: "bg-orange-100 text-orange-700",
    green: "bg-green-100 text-green-700",
    purple: "bg-purple-100 text-purple-700",
    blue: "bg-blue-100 text-blue-700"
  };

  return (
    <div className={`${colorMap[color]} p-4 rounded-xl`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  );
}

/**
 * RULE SECTION COMPONENT
 * 
 * Displays a category of rules with consistent styling
 */
interface RuleSectionProps {
  title: string;
  subtitle: string;
  rules: Rule[];
  bgColor: string;
  borderColor: string;
  textColor: string;
}

function RuleSection({ title, subtitle, rules, bgColor, borderColor, textColor }: RuleSectionProps) {
  if (rules.length === 0) return null;

  return (
    <div className={`${bgColor} p-6 rounded-2xl border ${borderColor}`}>
      <h3 className={`${textColor} font-black text-sm uppercase tracking-widest mb-1`}>
        {title}
      </h3>
      <p className="text-xs text-slate-600 mb-4">{subtitle}</p>
      <ul className="space-y-2">
        {rules.map((item, i) => (
          <li 
            key={i} 
            className={`bg-white/70 p-4 rounded-xl text-xs font-medium border ${borderColor}`}
          >
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}