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
  Loader2 
} from "lucide-react";
// Import the new libraries
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export default function AgentDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  // Update this with your actual Render URL
  const API_URL = "https://policy-engine-api.onrender.com";

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);

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
      alert("Analysis failed. Check if the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  // BABY STEP FEATURE: PDF Export Logic
  const exportPDF = async () => {
    const element = document.getElementById("analysis-results");
    if (!element) return;
    
    // Capture the dashboard as an image
    const canvas = await html2canvas(element, { 
      scale: 2, 
      useCORS: true,
      logging: false 
    });
    
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
            <h1 className="text-3xl font-bold tracking-tight">Agent Command Center</h1>
            <p className="text-slate-500 mt-1">Upload competitor policies to find gaps instantly.</p>
          </div>
          <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-semibold border border-green-200">
            System Status: ONLINE
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* UPLOAD SECTION */}
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
                  {file ? file.name : "Click to select PDF"}
                </p>
              </div>

              <button 
                onClick={handleUpload}
                disabled={loading || !file}
                className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Analyze Policy"}
              </button>
            </div>
          </div>

          {/* RESULTS SECTION */}
          <div className="col-span-2">
            {data ? (
              <div className="space-y-4">
                {/* Export Button */}
                <button 
                  onClick={exportPDF}
                  className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-all text-sm font-semibold shadow-sm"
                >
                  <Download className="w-4 h-4 text-blue-600" /> Download Report PDF
                </button>

                {/* ID added here for the PDF capture */}
                <div id="analysis-results" className="space-y-6 bg-slate-50 p-2">
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-xl font-bold">{data.meta?.policy_name || "Policy Results"}</h2>
                    <p className="text-sm text-slate-500">Insurer: {data.meta?.insurer || "N/A"}</p>
                  </div>

                  {/* Exclusions (Red) */}
                  <div className="bg-red-50 p-6 rounded-xl border border-red-100">
                    <h3 className="text-red-800 font-bold flex items-center gap-2 mb-4">
                      <AlertOctagon className="w-5 h-5" /> Critical Exclusions
                    </h3>
                    <ul className="space-y-3">
                      {data.cpdm?.rules?.filter((r: any) => r.category === "exclusion").map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-3 text-red-700 text-sm items-start">
                          <span className="mt-1.5 w-1.5 h-1.5 bg-red-400 rounded-full shrink-0"></span>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Waiting Periods (Yellow) */}
                  <div className="bg-amber-50 p-6 rounded-xl border border-amber-100">
                    <h3 className="text-amber-800 font-bold flex items-center gap-2 mb-4">
                      <AlertTriangle className="w-5 h-5" /> Waiting Periods
                    </h3>
                    <ul className="space-y-3">
                      {data.cpdm?.rules?.filter((r: any) => r.category === "waiting_period").map((item: any, idx: number) => (
                        <li key={idx} className="flex gap-3 text-amber-900 text-sm">
                          <span className="mt-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0"></span>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 min-h-[400px]">
                <Shield className="w-16 h-16 mb-4 opacity-20" />
                <p>Upload a policy to begin analysis</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}