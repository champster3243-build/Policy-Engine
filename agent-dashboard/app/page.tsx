"use client";
import { useState, useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Upload, FileText, CheckCircle, AlertTriangle, Shield, AlertOctagon, Download, Loader2 } from "lucide-react";

export default function AgentDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("IDLE"); // IDLE, UPLOADING, PROCESSING, COMPLETED
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<any>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://your-render-url.onrender.com";

  const handleUpload = async () => {
    if (!file) return;
    setStatus("UPLOADING");
    setProgress(10);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      // 1. Upload & Get Job ID
      const res = await fetch(`${API_URL}/upload-pdf`, { method: "POST", body: formData });
      const { jobId, cached } = await res.json();

      if (cached) {
        // If cached, fetch results immediately
        const jobRes = await fetch(`${API_URL}/job-status/${jobId}`);
        const jobData = await jobRes.json();
        setData(jobData.result);
        setStatus("COMPLETED");
        return;
      }

      // 2. Poll for Progress
      setStatus("PROCESSING");
      const interval = setInterval(async () => {
        const pollRes = await fetch(`${API_URL}/job-status/${jobId}`);
        const job = await pollRes.json();
        
        setProgress(job.progress || 10); // Update progress bar

        if (job.status === "COMPLETED") {
          clearInterval(interval);
          setData(job.result);
          setStatus("COMPLETED");
        } else if (job.status === "FAILED") {
          clearInterval(interval);
          alert("Analysis Failed.");
          setStatus("IDLE");
        }
      }, 2000); // Check every 2 seconds

    } catch (e) {
      console.error(e);
      alert("Upload failed.");
      setStatus("IDLE");
    }
  };

  // FEATURE 1: EXPORT PDF
  const exportPDF = async () => {
    if (!dashboardRef.current) return;
    const canvas = await html2canvas(dashboardRef.current, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save("Policy-Analysis-Report.pdf");
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Agent Command Center</h1>
            <p className="text-slate-500 mt-1">Upload competitor policies to find gaps instantly.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold border border-green-200">
              System Status: ONLINE
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* LEFT: UPLOAD CARD */}
          <div className="col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> Upload Policy
              </h2>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer relative">
                <input 
                  type="file" 
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <FileText className="w-10 h-10 text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 font-medium">
                  {file ? file.name : "Click to Upload PDF"}
                </p>
              </div>

              {/* PROGRESS BAR */}
              {status === "PROCESSING" && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Analyzing...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500" 
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              <button 
                onClick={handleUpload}
                disabled={status !== "IDLE" && status !== "COMPLETED"}
                className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {status === "PROCESSING" ? <Loader2 className="w-4 h-4 animate-spin"/> : "Analyze Policy"}
              </button>
            </div>
          </div>

          {/* RIGHT: RESULTS DASHBOARD */}
          <div className="col-span-2">
            {data ? (
              <div ref={dashboardRef} className="space-y-6">
                
                {/* Header Card */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{data.meta?.policy_name || "Policy Analysis"}</h2>
                    <div className="flex gap-4 mt-2 text-sm text-slate-500">
                      <span>Insurer: {data.meta?.insurer || "N/A"}</span>
                    </div>
                  </div>
                  <button onClick={exportPDF} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm font-medium">
                    <Download className="w-4 h-4" /> Export Report
                  </button>
                </div>

                {/* Exclusions Card (RED) */}
                <div className="bg-red-50 p-6 rounded-xl border border-red-100">
                  <h3 className="text-red-800 font-bold flex items-center gap-2 mb-4">
                    <AlertOctagon className="w-5 h-5" /> Critical Exclusions
                  </h3>
                  <ul className="space-y-3">
                    {data.rules?.filter((r:any) => r.category === 'exclusion').length > 0 ? (
                      data.rules.filter((r:any) => r.category === 'exclusion').map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-3 text-red-700 text-sm items-start">
                          <span className="mt-1.5 w-1.5 h-1.5 bg-red-400 rounded-full shrink-0"></span>
                          {item.text}
                        </li>
                      ))
                    ) : (
                      <p className="text-red-400 italic text-sm">No explicit exclusions detected.</p>
                    )}
                  </ul>
                </div>

                {/* Waiting Periods (YELLOW) */}
                <div className="bg-amber-50 p-6 rounded-xl border border-amber-100">
                  <h3 className="text-amber-800 font-bold flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5" /> Waiting Periods
                  </h3>
                  <ul className="space-y-2">
                    {data.rules?.filter((r:any) => r.category === 'waiting_period').map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-3 text-amber-900 text-sm">
                          <span className="mt-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0"></span>
                          {item.text}
                        </li>
                    ))}
                  </ul>
                </div>

              </div>
            ) : (
              // Empty State
              <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 min-h-[400px]">
                <Shield className="w-16 h-16 mb-4 opacity-20" />
                <p>Upload a policy to view the analysis</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}