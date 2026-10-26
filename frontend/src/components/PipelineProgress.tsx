import type { PipelineStep, StepName } from "../types";
import { CheckIcon, XIcon } from "./Icons";

const STEP_META: Record<StepName, { label: string; description: string; icon: string }> = {
  classify: {
    label: "Classify",
    description: "Detecting document type",
    icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6",
  },
  ocr: {
    label: "OCR",
    description: "Extracting text from images",
    icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  },
  structure: {
    label: "Structure",
    description: "Analyzing document layout",
    icon: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
  },
  alt_text: {
    label: "Alt Text",
    description: "Generating image descriptions",
    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  },
  tagging: {
    label: "Tag",
    description: "Writing accessibility tags",
    icon: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  },
  validation: {
    label: "Validate",
    description: "Checking PDF/UA compliance",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  },
  fidelity: {
    label: "Fidelity",
    description: "Checking content and reading fidelity",
    icon: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z",
  },
};

interface PipelineProgressProps {
  steps: PipelineStep[];
}

export default function PipelineProgress({ steps }: PipelineProgressProps) {
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const meta = STEP_META[step.step_name];
        const isLast = i === steps.length - 1;
        const result = step.result as Record<string, any> | undefined;

        // Resolve explicit outcome for OCR and other steps
        const outcome = (
          result?.outcome ||
          (step.status === "complete"
            ? "completed"
            : step.status === "failed"
              ? "failed"
              : step.status === "skipped"
                ? "skipped"
                : step.status)
        ) as string;

        const reason = result?.reason as string | undefined;
        const pagesProcessed = Array.isArray(result?.pages_processed)
          ? (result?.pages_processed as number[])
          : null;
        const pagesSkipped = Array.isArray(result?.pages_skipped)
          ? (result?.pages_skipped as number[])
          : null;
        const pagesFailed = Array.isArray(result?.pages_failed)
          ? (result?.pages_failed as number[])
          : null;
        const engineError = (result?.engine_error || (step.status === "failed" ? step.error : null)) as string | null;

        const isRunning = step.status === "running";
        const isCompleted = outcome === "completed" || (step.status === "complete" && outcome !== "partially_completed" && outcome !== "needs_review");
        const isPartial = outcome === "partially_completed";
        const isReview = outcome === "needs_review";
        const isSkipped = outcome === "skipped" || step.status === "skipped";
        const isFailed = outcome === "failed" || step.status === "failed";

        return (
          <div key={step.step_name} className="flex items-start gap-4">
            {/* Vertical connector + icon */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  w-10 h-10 rounded-xl flex items-center justify-center
                  transition-all duration-300 shrink-0
                  ${
                    isFailed
                      ? "bg-red-600 text-white shadow-sm"
                      : isRunning
                        ? "bg-purple-600 text-white shadow-md animate-pulse-soft"
                        : isPartial
                          ? "bg-purple-500 text-white shadow-sm"
                          : isReview
                            ? "bg-amber-500 text-white shadow-sm"
                            : isCompleted
                              ? "bg-emerald-600 text-white shadow-sm"
                              : isSkipped
                                ? "bg-slate-100 text-slate-500 border border-slate-200"
                                : "bg-slate-100 text-slate-400"
                  }
                `}
              >
                {isCompleted ? (
                  <CheckIcon size={16} />
                ) : isFailed ? (
                  <XIcon size={16} />
                ) : isPartial ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                ) : isReview ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : isSkipped ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 4h4l5 8-5 8H5l5-8z" />
                    <path d="M13 4h4l5 8-5 8h-4l5-8z" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={meta.icon} />
                  </svg>
                )}
              </div>
              {!isLast && (
                <div
                  className={`
                    w-0.5 h-full min-h-6 rounded-full my-1
                    ${isCompleted ? "bg-emerald-500/30" : "bg-slate-200"}
                  `}
                />
              )}
            </div>

            {/* Content */}
            <div className="pt-1 pb-4 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4
                  className={`
                    text-sm font-semibold
                    ${
                      isRunning
                        ? "text-purple-600"
                        : isFailed
                          ? "text-red-700"
                          : isCompleted
                            ? "text-slate-900"
                            : "text-slate-700"
                    }
                  `}
                >
                  {meta.label}
                </h4>

                {isRunning && (
                  <div className="flex gap-0.5 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse-soft" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse-soft" style={{ animationDelay: "200ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse-soft" style={{ animationDelay: "400ms" }} />
                  </div>
                )}

                {/* Outcome Badges */}
                {isCompleted && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <CheckIcon size={10} /> Completed
                  </span>
                )}
                {isPartial && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                    Partially completed
                  </span>
                )}
                {isReview && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    Needs review
                  </span>
                )}
                {isSkipped && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                    Skipped
                  </span>
                )}
                {isFailed && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                    <XIcon size={10} /> Failed
                  </span>
                )}
              </div>

              {/* Description & Decision Reason */}
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {reason || (step.status === "failed" && step.error) || meta.description}
              </p>

              {/* Page-level metrics breakdown */}
              {(pagesProcessed !== null || pagesSkipped !== null || pagesFailed !== null) && (
                <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                  {pagesProcessed !== null && (
                    <span className={`px-2 py-0.5 rounded-md font-medium border ${pagesProcessed.length > 0 ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      Processed: <strong className="font-bold">{pagesProcessed.length}</strong> {pagesProcessed.length > 0 ? `(p. ${pagesProcessed.join(", ")})` : ""}
                    </span>
                  )}
                  {pagesSkipped !== null && (
                    <span className={`px-2 py-0.5 rounded-md font-medium border ${pagesSkipped.length > 0 ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      Skipped: <strong className="font-bold">{pagesSkipped.length}</strong> {pagesSkipped.length > 0 ? `(p. ${pagesSkipped.join(", ")})` : ""}
                    </span>
                  )}
                  {pagesFailed !== null && pagesFailed.length > 0 && (
                    <span className="px-2 py-0.5 rounded-md font-medium bg-red-50 text-red-700 border border-red-200">
                      Failed: <strong className="font-bold">{pagesFailed.length}</strong> (p. {pagesFailed.join(", ")})
                    </span>
                  )}
                </div>
              )}

              {/* Engine error notification */}
              {engineError && (
                <div className="mt-2 p-2.5 rounded-lg bg-red-50/80 border border-red-200/80 text-xs text-red-800 font-mono break-words leading-relaxed">
                  <span className="font-bold font-sans block text-red-900 mb-0.5">OCR Engine Diagnostic:</span>
                  {engineError}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
