"use client";
import { useState } from "react";
import Image from "next/image";
import { 
  Upload, 
  FileText, 
  AlertTriangle, 
  Shield, 
  AlertOctagon, 
  Download, 
  Loader2,
  CheckCircle,
  FileCheck
} from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export default function AgentDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const API_URL = "https://policy-engine-api.onrender.com";

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setData(null);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const res = await fetch(`${API_URL}/upload-pdf`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      setData(result);
    } catch (e) {
      console.error("Upload failed:", e);
      alert("Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;
    
    const canvas = await html2canvas(element, { 
      scale: 2, 
      useCORS: true,
      backgroundColor: "#f8fafc"
    });
    
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Report-${data?.meta?.policy_name || 'Policy'}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Agent Command Center</h1>
            <p className="text-slate-500 mt-1">Upload policies to extract critical risks and waiting periods.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
             <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-semibold border border-green-200">
              System Status: ONLINE
            </div>
            {data?.isCached && (
               <div className="flex items-center gap-1 text-blue-600 text-xs font-medium">
                 <FileCheck className="w-3 h-3" /> Report from Library
               </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* UPLOAD SECTION */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> Policy Analysis
              </h2>
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer relative">
                <input 
                  type="file" 
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <FileText className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm text-slate-600 font-medium">
                  {file ? file.name : "Drop PDF or Click to Select"}
                </p>
              </div>

              {/* PROGRESS BAR (BABY STEP 2) */}
              {loading && (
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-xs font-medium text-slate-500">
                    <span>AI Auditor is reading...</span>
                    <span className="animate-pulse">Processing Chunks</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-600 h-full w-full origin-left animate-[progress_3s_ease-in-out_infinite]"></div>
                  </div>
                </div>
              )}

              <button 
                onClick={handleUpload}
                disabled={loading || !file}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Run Deep Analysis"}
              </button>
            </div>
          </div>

          {/* RESULTS SECTION */}
          <div className="lg:col-span-2">
            {data ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-end">
                  <button 
                    onClick={exportPDF}
                    className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-slate-700 hover:bg-slate-50 transition-all text-sm font-bold shadow-sm"
                  >
                    <Download className="w-4 h-4 text-blue-600" /> Export PDF Report
                  </button>
                </div>

                <div id="analysis-results" className="space-y-6">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Exclusions</p>
                      <p className="text-2xl font-black text-red-600">{data.cpdm?.rules?.filter((r:any)=>r.category === 'exclusion').length || 0}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Waiting Periods</p>
                      <p className="text-2xl font-black text-amber-600">{data.cpdm?.rules?.filter((r:any)=>r.category === 'waiting_period').length || 0}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Definitions</p>
                      <p className="text-2xl font-black text-blue-600">{Object.keys(data.definitions || {}).length}</p>
                    </div>
                  </div>

                  {/* Identity Card */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <h2 className="text-xl font-black text-slate-900 leading-tight">{data.meta?.policy_name || "Extracted Policy Details"}</h2>
                    <div className="mt-4 flex flex-wrap gap-y-2 gap-x-6 text-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Shield className="w-4 h-4 text-blue-500" />
                        <span className="font-semibold">Insurer:</span> {data.meta?.insurer || "N/A"}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="font-semibold">Type:</span> {data.meta?.document_type || "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* Exclusions (Red) */}
                  <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm">
                    <h3 className="text-red-800 font-black flex items-center gap-2 mb-6 text-lg uppercase tracking-wide">
                      <AlertOctagon className="w-6 h-6" /> Critical Exclusions
                    </h3>
                    <ul className="space-y-4">
                      {data.cpdm?.rules?.filter((r: any) => r.category === "exclusion").map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-4 text-red-900 text-sm leading-relaxed bg-white/50 p-3 rounded-lg border border-red-50">
                          <span className="mt-1 w-2 h-2 bg-red-500 rounded-full shrink-0 shadow-sm shadow-red-200"></span>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Waiting Periods (Yellow) */}
                  <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 shadow-sm">
                    <h3 className="text-amber-900 font-black flex items-center gap-2 mb-6 text-lg uppercase tracking-wide">
                      <AlertTriangle className="w-6 h-6" /> Waiting Periods
                    </h3>
                    <ul className="space-y-4">
                      {data.cpdm?.rules?.filter((r: any) => r.category === "waiting_period").map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-4 text-amber-900 text-sm leading-relaxed bg-white/50 p-3 rounded-lg border border-amber-50">
                          <span className="mt-1 w-2 h-2 bg-amber-500 rounded-full shrink-0 shadow-sm shadow-amber-200"></span>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-3xl bg-white/50 min-h-[500px]">
                <Shield className="w-20 h-20 mb-4 opacity-10" />
                <p className="font-bold text-slate-400">Policy Results will appear here</p>
                <p className="text-sm text-slate-300">Upload a PDF on the left to start</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes progress {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(0.7); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}