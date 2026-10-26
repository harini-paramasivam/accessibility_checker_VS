import { Link } from "react-router-dom";
import { apiUrl } from "../api/client";
import type { JobStatus } from "../types";
import { pluralize } from "../utils/format";
import DownloadButton from "./DownloadButton";
import { ArrowRightIcon, CheckIcon, WarningIcon, XIcon } from "./Icons";

type TerminalStatus = Extract<JobStatus, "complete" | "manual_remediation" | "failed">;

interface OutcomeHeroProps {
  jobId: string;
  filename: string;
  status: TerminalStatus;
  appliedChangeCount?: number;
  reviewTaskCount?: number;
  blockingIssueCount?: number | null;
  tasks?: import("../types").ReviewTask[];
  reviewContextStatus?: "ready" | "loading" | "unavailable";
  error?: string;
}

function reviewSummary(appliedChangeCount: number, reviewTaskCount: number): string | null {
  if (appliedChangeCount > 0 && reviewTaskCount > 0) {
    return `${appliedChangeCount} image ${pluralize(appliedChangeCount, "description")} and ${reviewTaskCount} additional ${pluralize(reviewTaskCount, "check")}`;
  }
  if (appliedChangeCount > 0) {
    return `${appliedChangeCount} image ${pluralize(appliedChangeCount, "description")}`;
  }
  if (reviewTaskCount > 0) {
    return `${reviewTaskCount} additional ${pluralize(reviewTaskCount, "check")}`;
  }
  return null;
}

function reviewButtonLabel(appliedChangeCount: number): string {
  if (appliedChangeCount > 0) return "Review Image Descriptions";
  return "Review Checks";
}

export default function OutcomeHero({
  jobId,
  filename,
  status,
  appliedChangeCount = 0,
  reviewTaskCount = 0,
  blockingIssueCount = null,
  tasks = [],
  reviewContextStatus = "ready",
  error,
}: OutcomeHeroProps) {
  const summary = reviewSummary(appliedChangeCount, reviewTaskCount);
  const reviewLabel = reviewButtonLabel(appliedChangeCount);

  if (status === "failed") {
    return (
      <div className="rounded-2xl border-2 border-error/25 bg-error-light/20 p-6 animate-slide-up">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-error text-white flex items-center justify-center shrink-0">
            <XIcon size={22} />
          </div>
          <div>
            <h2 className="font-display text-xl text-ink mb-1">
              Processing failed
            </h2>
            {error && (
              <p className="text-sm text-ink-muted leading-relaxed">{error}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === "complete") {
    return (
      <div className="rounded-2xl border-2 border-success/25 bg-success-light/20 p-6 animate-slide-up">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-success text-white flex items-center justify-center shrink-0">
            <CheckIcon size={24} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-xl text-ink mb-1">
              Your PDF is now accessible
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              {reviewContextStatus === "loading"
                ? "All compliance checks passed. Review details are still loading."
                : summary
                ? `All compliance checks passed. You can optionally review ${summary}.`
                : "All compliance checks passed and your PDF is ready for assistive technologies."}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <DownloadButton jobId={jobId} filename={filename} type="pdf" />
              {reviewContextStatus === "ready" && summary && (
                <Link
                  to={`/jobs/${jobId}/review`}
                  className="
                    inline-flex items-center gap-2 px-5 py-3 rounded-xl
                    border border-ink/10 bg-white text-ink font-medium text-sm
                    hover:border-ink/20 hover:bg-paper-warm
                    shadow-sm hover:shadow-card
                    transition-all duration-200 no-underline
                  "
                >
                  {reviewLabel}
                  <ArrowRightIcon size={14} />
                </Link>
              )}
              <a
                href={apiUrl(`/jobs/${jobId}/download/report.html`)}
                download={`report_${filename.replace(/\.pdf$/i, "")}.html`}
                className="text-sm text-ink-muted hover:text-accent transition-colors no-underline"
              >
                Download report
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Needs manual fixes
  return (
    <div className="rounded-2xl border-2 border-warning/25 bg-warning-light/20 p-6 animate-slide-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-warning text-white flex items-center justify-center shrink-0">
          <WarningIcon size={22} />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-xl text-ink mb-1">
            Needs manual fixes
          </h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            {blockingIssueCount && blockingIssueCount > 0
              ? `${blockingIssueCount} ${pluralize(blockingIssueCount, "issue")} could not be fixed automatically.`
              : "Some issues could not be fixed automatically."}
            {" "}Download the current PDF and report to continue remediation in Acrobat or another tool.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <DownloadButton jobId={jobId} filename={filename} type="pdf" />
            {reviewContextStatus === "ready" && summary && (
              <Link
                to={`/jobs/${jobId}/review`}
                className="
                  inline-flex items-center gap-2 px-5 py-3 rounded-xl
                  border border-ink/10 bg-white text-ink font-medium text-sm
                  hover:border-ink/20 hover:bg-paper-warm
                  shadow-sm hover:shadow-card
                  transition-all duration-200 no-underline
                "
              >
                {reviewLabel}
                <ArrowRightIcon size={14} />
              </Link>
            )}
            <a
              href={apiUrl(`/jobs/${jobId}/download/report.html`)}
              download={`report_${filename.replace(/\.pdf$/i, "")}.html`}
              className="text-sm text-ink-muted hover:text-accent transition-colors no-underline"
            >
              Download report
            </a>
          </div>

          {/* Exact Unresolved Issues Breakdown */}
          {tasks && tasks.length > 0 && (
            <div className="mt-5 space-y-3 border-t border-warning/20 pt-4">
              <h3 className="text-xs uppercase font-bold tracking-wider text-ink-muted">
                Unresolved Attention Items ({tasks.length})
              </h3>
              <div className="space-y-2">
                {tasks.map((task) => {
                  const pages = Array.isArray(task.metadata?.pages_to_check)
                    ? (task.metadata.pages_to_check as (number | string)[])
                    : [];
                  const pagesStr = pages.length > 0 ? `Page(s) ${pages.join(", ")}` : null;

                  return (
                    <div
                      key={task.id}
                      className={`p-3.5 rounded-xl border text-xs shadow-sm ${
                        task.blocking
                          ? "bg-white/90 border-error/30 text-ink"
                          : "bg-white/70 border-amber-300/60 text-ink"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 text-sm">{task.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {pagesStr && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px] font-semibold">
                              {pagesStr}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              task.blocking
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {task.severity || (task.blocking ? "High" : "Medium")}
                          </span>
                        </div>
                      </div>
                      {task.detail && (
                        <p className="text-slate-600 mt-1 leading-relaxed">{task.detail}</p>
                      )}
                      <p className="text-[11px] text-accent font-medium mt-1.5">
                        Recommended Action:{" "}
                        {task.blocking
                          ? "Review and resolve semantics in the Interactive Review tool or external PDF editor."
                          : "Inspect and verify accuracy before final document distribution."}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
