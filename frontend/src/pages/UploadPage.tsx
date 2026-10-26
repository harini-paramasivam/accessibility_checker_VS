import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateJobs } from "../api/jobs";
import { formatBytes } from "../utils/format";
import FileDropzone from "../components/FileDropzone";
import { ArrowRightIcon, XIcon } from "../components/Icons";

const PIPELINE_STEPS = [
  { icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2", label: "Classification", desc: "Digital stream vs scanned check" },
  { icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", label: "Smart OCR", desc: "OCR for scans / lossless for digital" },
  { icon: "M3 3h18v18H3zM3 9h18M9 3v18", label: "Docling Structure", desc: "Layout & semantic segmentation" },
  { icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", label: "AI Alt-Text", desc: "Intelligent figure descriptions" },
  { icon: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z", label: "PDF/UA Tag Tree", desc: "H1-H6, Tables, and Lists" },
  { icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", label: "Font Embed", desc: "ISO 7.21.4.1 font programs" },
  { icon: "M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", label: "veraPDF Engine", desc: "Automated ISO 14289 validation" },
  { icon: "M4 6h16M4 12h10M4 18h7", label: "Fidelity Audit", desc: "Visual drift & text verification" },
];

export default function UploadPage() {
  const navigate = useNavigate();
  const createJobs = useCreateJobs();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFiles = (files: File[]) => {
    setSelectedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const newFiles = files.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
      return newFiles.length > 0 ? [...prev, ...newFiles] : prev;
    });
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    try {
      const result = await createJobs.mutateAsync(selectedFiles);
      setSelectedFiles([]);
      if (result.jobs.length === 1) {
        navigate(`/jobs/${result.jobs[0].id}`);
      } else {
        navigate("/dashboard");
      }
    } catch {
      // error handled by mutation state
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto space-y-12">
      {/* Enterprise Hero Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-purple-500/30 text-purple-300 text-xs font-semibold tracking-wide shadow-sm">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          Velvora Solutions · Automated PDF/UA Remediation Engine
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight leading-tight">
          Enterprise PDF Accessibility <br className="hidden sm:inline" />
          <span className="gold-gradient-text">Automated Remediation Platform</span>
        </h1>

        <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Transform untagged, inaccessible PDFs into fully certified{" "}
          <strong className="text-slate-900 font-semibold">ISO 14289-1 (PDF/UA-1)</strong> and{" "}
          <strong className="text-slate-900 font-semibold">WCAG 2.1 AA</strong> compliant documents with
          automated structural tagging, smart font embedding, and veraPDF verification.
        </p>

        {/* Feature Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs font-medium text-slate-600">
          <span className="px-3 py-1 rounded-md bg-white border border-slate-200 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Logical Tag Tree (H1–H6, Tables, Lists)
          </span>
          <span className="px-3 py-1 rounded-md bg-white border border-slate-200 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Smart Font Embedding (veraPDF 7.21.4.1)
          </span>
          <span className="px-3 py-1 rounded-md bg-white border border-slate-200 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            AI-Assisted Alt Text
          </span>
          <span className="px-3 py-1 rounded-md bg-white border border-slate-200 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Interactive Structure Inspector
          </span>
        </div>
      </div>

      {/* Dropzone & Upload Action Container */}
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-sm">
          <FileDropzone
            onFiles={handleFiles}
            disabled={createJobs.isPending}
          />
        </div>

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <div className="space-y-3 animate-slide-up bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Queued for Processing ({selectedFiles.length})
              </h3>
              <span className="text-xs text-slate-400">PDF Document Format</span>
            </div>

            <div className="space-y-2">
              {selectedFiles.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200/80"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold text-xs">
                      PDF
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {formatBytes(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-slate-400 hover:text-red-600 transition-colors p-1"
                    aria-label={`Remove ${file.name}`}
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Upload button */}
            <div className="pt-3">
              <button
                type="button"
                onClick={handleUpload}
                disabled={createJobs.isPending}
                className="w-full py-3.5 px-6 rounded-xl bg-[#0A1128] text-purple-300 font-bold text-sm hover:bg-slate-900 border border-purple-500/40 shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
              >
                {createJobs.isPending ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                    <span>Remediating & Validating PDF...</span>
                  </>
                ) : (
                  <>
                    <span>Start PDF/UA Remediation Pipeline</span>
                    <ArrowRightIcon size={14} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>

            {createJobs.isError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {createJobs.error?.message || "Upload failed. Please try again."}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Enterprise Processing Pipeline Steps */}
      <div className="space-y-6 pt-6">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-display font-bold text-slate-900">
            Automated Remediation & Conformance Pipeline
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Every document passes through an 8-stage automated workflow ensuring compliance with ISO 14289-1 and WCAG standards.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PIPELINE_STEPS.map((step, i) => (
            <div
              key={step.label}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-purple-500/40 transition-colors flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-purple-300 flex items-center justify-center text-xs">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d={step.icon} />
                  </svg>
                </div>
                <span className="font-mono text-[10px] text-slate-400">0{i + 1}</span>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 leading-tight">{step.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
