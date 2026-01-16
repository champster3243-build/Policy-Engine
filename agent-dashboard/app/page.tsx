"use client";
import { useState } from "react";
import { Upload, FileText, AlertTriangle, Shield, AlertOctagon, Download, Loader2, FileCheck, Activity } from "lucide-react";
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
      console.log("API Response:", result); // Diagnostic
      setData(result);
    } catch (e) { 
      alert("Analysis failed."); 
    } finally { 
      setLoading(false); 
    }
  };

  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;
    const canvas = await html2canvas(element, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.addImage(imgData, "PNG", 0, 0, 210, (canvas.height * 210) / canvas.width);
    pdf.save(`Audit-Report.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
               <Shield className="w-8 h-8 text-blue-600" /> Agent Command Center
            </h1>
          </div>
          {data?.isCached && (
            <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black border border-blue-100 uppercase">
              <FileCheck className="w-3 h-3" /> Library Record
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
                <Activity className="w-4 h-4" /> New Audit
              </h2>
              
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:bg-blue-50/30 transition-all cursor-pointer relative">
                <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">{file ? file.name : "Select Policy PDF"}</p>
              </div>

              {/* PROGRESS BAR - FORCED VISIBILITY ON LOADING */}
              {loading && (
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-[10px] uppercase font-black text-blue-600">
                    <span className="animate-pulse">AI Scrutiny in progress...</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-600 h-full w-full origin-left animate-[loading_10s_ease-in-out_infinite]"></div>
                  </div>
                </div>
              )}

              <button onClick={handleUpload} disabled={loading || !file} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl transition-all shadow-lg disabled:opacity-20 uppercase text-xs tracking-widest">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Run Deep Audit"}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            {data ? (
              <div className="space-y-4">
                {/* DOWNLOAD BUTTON - LOCKED POSITION */}
                <div className="flex justify-end">
                  <button onClick={exportPDF} className="flex items-center gap-2 bg-white border border-slate-300 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-slate-50 transition-all">
                    <Download className="w-4 h-4 text-blue-600" /> Download Report PDF
                  </button>
                </div>

                <div id="analysis-results" className="space-y-6">
                  {/* Identity */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h2 className="text-xl font-black text-slate-900">{data.meta?.policy_name || "Policy Results"}</h2>
                    <p className="text-sm text-slate-500 font-bold">Insurer: {data.meta?.insurer || "N/A"}</p>
                  </div>

                  {/* Exclusions */}
                  <div className="bg-red-50 p-6 rounded-2xl border border-red-100">
                    <h3 className="text-red-800 font-black flex items-center gap-2 mb-4 uppercase text-xs tracking-widest">
                      <AlertOctagon className="w-5 h-5" /> Permanent Exclusions
                    </h3>
                    <ul className="space-y-3">
                      {(data.cpdm?.rules || data.rules || [])
                        .filter((r: any) => r.category === 'exclusion')
                        .map((item: any, i: number) => (
                          <li key={i} className="flex gap-3 text-red-950 text-xs font-bold bg-white/70 p-4 rounded-xl border border-red-50 shadow-sm">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0 mt-1"></span> 
                            {item.text}
                          </li>
                        ))
                      }
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-white border-2 border-dashed border-slate-200 rounded-3xl text-slate-300">
                <Shield className="w-12 h-12 mb-2 opacity-10" />
                <p className="text-xs font-black uppercase tracking-widest">Analysis Dashboard Ready</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes loading { 
            0% { transform: scaleX(0); } 
            50% { transform: scaleX(0.7); } 
            100% { transform: scaleX(0.99); } 
        }
      `}</style>
    </div>
  );
}