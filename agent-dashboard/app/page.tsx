"use client";
import { useState } from "react";
import { 
  Upload, 
  FileText, 
  AlertTriangle, 
  Shield, 
  AlertOctagon, 
  Download, 
  Loader2, 
  FileCheck, 
  CheckCircle,
  Activity,
  Zap
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
      const res = await fetch(`${API_URL}/upload-pdf`, { method: "POST", body: formData });
      const result = await res.json();
      setData(result);
    } catch (e) { alert("Analysis failed."); } finally { setLoading(false); }
  };

  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;
    const canvas = await html2canvas(element, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, (canvas.height * pdfWidth) / canvas.width);
    pdf.save(`Audit-Report.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900 leading-relaxed">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
               <Shield className="w-8 h-8 text-blue-600" /> Agent Command Center
            </h1>
            <p className="text-slate-500 font-medium">Deep-scan competitor policies for critical gaps instantly.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1 rounded-full text-[10px] font-black border border-green-100 uppercase tracking-wider">
              <Activity className="w-3 h-3" /> System Live
            </div>
            {data?.isCached && (
                <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black border border-blue-100 uppercase tracking-wider">
                  <FileCheck className="w-3 h-3" /> Library Record
                </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT: UPLOAD & AUDIT CONTROLS */}
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 sticky top-8">
              <h2 className="font-black mb-4 flex items-center gap-2 text-slate-800 uppercase text-xs tracking-widest">
                <Zap className="w-4 h-4 text-blue-600" /> New Deep Audit
              </h2>
              
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer relative group">
                <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3 group-hover:scale-110 transition-transform" />
                <p className="text-sm font-bold text-slate-600">{file ? file.name : "Select Policy PDF"}</p>
              </div>

              {loading && (
                <div className="mt-6 space-y-3">
                  <div className="flex justify-between text-[10px] uppercase tracking-widest font-black text-slate-400">
                    <span>AI Scrutiny in progress</span>
                    <span className="animate-pulse text-blue-600">Extracting Rules</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                    <div className="bg-blue-600 h-full w-full origin-left animate-[progress_25s_ease-in-out_infinite]"></div>
                  </div>
                  <p className="text-[10px] text-center text-slate-400 font-bold italic">Checking 100+ semantic chunks...</p>
                </div>
              )}

              <button 
                onClick={handleUpload} 
                disabled={loading || !file} 
                className="mt-6 w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-xl transition-all shadow-xl disabled:opacity-20 flex items-center justify-center gap-3 uppercase text-xs tracking-widest"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Run Deep Audit"}
              </button>
            </div>
          </div>

          {/* RIGHT: ANALYSIS DASHBOARD */}
          <div className="lg:col-span-2 space-y-6">
            {data ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* ACTIONS & OVERVIEW */}
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                   <div className="flex gap-4">
                      <div className="text-center px-4 border-r border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Risks</p>
                        <p className="text-lg font-black text-red-600">{data.cpdm?.rules?.filter((r:any) => r.category === 'exclusion').length || 0}</p>
                      </div>
                      <div className="text-center px-4 border-r border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Waiting</p>
                        <p className="text-lg font-black text-amber-600">{data.cpdm?.rules?.filter((r:any) => r.category === 'waiting_period').length || 0}</p>
                      </div>
                   </div>
                   <button onClick={exportPDF} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all">
                    <Download className="w-4 h-4" /> Download Report
                  </button>
                </div>

                <div id="analysis-results" className="space-y-6">
                  {/* Identity Card */}
                  <div className="bg-white p-8 rounded-3xl border-2 border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,0.05)]">
                    <h2 className="text-2xl font-black text-slate-900 leading-none mb-2">{data.meta?.policy_name}</h2>
                    <div className="flex items-center gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                       <span className="text-blue-600">{data.meta?.insurer}</span>
                       <span>•</span>
                       <span>UIN: {data.meta?.uin || "N/A"}</span>
                    </div>
                  </div>

                  {/* Exclusions Block */}
                  <div className="bg-red-50 p-8 rounded-3xl border border-red-100 shadow-sm">
                    <h3 className="text-red-800 font-black flex items-center gap-3 mb-6 uppercase text-xs tracking-[0.2em]">
                      <AlertOctagon className="w-5 h-5" /> Permanent Exclusions Detected
                    </h3>
                    <ul className="space-y-4">
                      {data.cpdm?.rules?.filter((r:any) => r.category === 'exclusion').map((item:any, i:number) => (
                        <li key={i} className="flex gap-4 text-red-950 text-xs font-bold bg-white/70 p-4 rounded-2xl border border-red-50 shadow-sm leading-relaxed">
                          <span className="w-2 h-2 bg-red-500 rounded-full shrink-0 mt-1 shadow-sm"></span> 
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Waiting Periods Block */}
                   <div className="bg-amber-50 p-8 rounded-3xl border border-amber-100 shadow-sm">
                    <h3 className="text-amber-800 font-black flex items-center gap-3 mb-6 uppercase text-xs tracking-[0.2em]">
                      <AlertTriangle className="w-5 h-5" /> Waiting Periods & Gaps
                    </h3>
                    <ul className="space-y-4">
                      {data.cpdm?.rules?.filter((r:any) => r.category === 'waiting_period').map((item:any, i:number) => (
                        <li key={i} className="flex gap-4 text-amber-950 text-xs font-bold bg-white/70 p-4 rounded-2xl border border-amber-50 shadow-sm leading-relaxed">
                          <span className="w-2 h-2 bg-amber-500 rounded-full shrink-0 mt-1 shadow-sm"></span> 
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-white border border-slate-200 rounded-3xl text-slate-300 transition-all">
                <div className="relative mb-6">
                  <Shield className="w-24 h-24 opacity-[0.03]" />
                  <Activity className="w-8 h-8 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20 text-slate-400" />
                </div>
                <p className="text-sm font-black uppercase tracking-widest text-slate-400">Policy Analysis Engine Ready</p>
                <p className="text-xs font-medium text-slate-300 mt-2">Awaiting PDF input for processing...</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes progress { 
            0% { transform: scaleX(0); } 
            20% { transform: scaleX(0.3); } 
            70% { transform: scaleX(0.8); } 
            100% { transform: scaleX(0.99); } 
        }
      `}</style>
    </div>
  );
}