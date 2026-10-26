import { useState } from "react";
import type { ValidationChange, ValidationReport as ValidationReportType } from "../types";
import { pluralize } from "../utils/format";
import { asBool, asNumber, asString } from "../utils/typeGuards";
import { CheckIcon, WarningIcon } from "./Icons";
import TagTreeInspector from "./TagTreeInspector";

interface ValidationReportProps {
  report: ValidationReportType;
  jobId?: string;
}

function statusLabel(status: ValidationChange["remediation_status"]): string {
  if (status === "auto_remediated") return "Auto Remediated";
  if (status === "manual_remediated") return "Manual Remediated";
  return "Needs Attention";
}

function statusTone(status: ValidationChange["remediation_status"]): string {
  if (status === "auto_remediated") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "manual_remediated") return "bg-blue-50 text-blue-800 border-blue-200";
  return "bg-amber-50 text-amber-900 border-amber-200";
}

export default function ValidationReport({ report, jobId }: ValidationReportProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "tree" | "rules" | "fonts" | "fidelity" | "technical">("overview");

  const remediation =
    report.remediation && typeof report.remediation === "object"
      ? (report.remediation as Record<string, unknown>)
      : {};
  const fidelity =
    report.fidelity && typeof report.fidelity === "object"
      ? (report.fidelity as Record<string, unknown>)
      : {};
  const fontRemediation =
    remediation.font_remediation && typeof remediation.font_remediation === "object"
      ? (remediation.font_remediation as Record<string, unknown>)
      : {};
  const fidelitySummary =
    fidelity.summary && typeof fidelity.summary === "object"
      ? (fidelity.summary as Record<string, unknown>)
      : {};
  const fidelityChecks = Array.isArray(fidelity.checks)
    ? (fidelity.checks as Array<Record<string, unknown>>)
    : [];
  const fidelityPassed = asBool(fidelity.passed);
  const blockingTasks = asNumber(fidelitySummary.blocking_tasks);
  const advisoryTasks = asNumber(fidelitySummary.advisory_tasks);

  const baselineIssues = asNumber(remediation.baseline_error_rules);
  const postIssues = asNumber(remediation.post_error_rules);
  const autoFixedIssues = asNumber(remediation.auto_remediated_errors);
  const autoRemediated = asNumber(remediation.auto_remediated);
  const issuesReduced =
    baselineIssues !== null && postIssues !== null ? baselineIssues - postIssues : null;

  const fontAttempted = asBool(fontRemediation.attempted);
  const fontApplied = asBool(fontRemediation.applied);
  const selectedLane = asString(fontRemediation.selected_lane);
  const lanesPlanned = Array.isArray(fontRemediation.lanes_planned)
    ? fontRemediation.lanes_planned.length
    : 0;

  const changes = [...(report.changes ?? [])].sort((a, b) => {
    const order = {
      needs_remediation: 0,
      manual_remediated: 1,
      auto_remediated: 2,
    };
    return order[a.remediation_status] - order[b.remediation_status];
  });

  const fontRules = changes.filter((c) => c.rule_id.includes("7.21.4") || c.rule_id.includes("7.21.3"));
  const fontErrorsResolved = fontRules.filter((c) => c.remediation_status === "auto_remediated").length;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 overflow-x-auto pb-1">
        {[
          { id: "overview", label: "Executive Summary" },
          { id: "tree", label: "Structure Tag Tree", badge: "Interactive" },
          { id: "rules", label: `veraPDF Rules (${changes.length})` },
          { id: "fonts", label: "Font Remediation", badge: fontApplied ? "Fixed" : undefined },
          { id: "fidelity", label: "Fidelity & OCR" },
          { id: "technical", label: "Technical Specs" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-white text-slate-900 border-t-2 border-amber-500 shadow-sm border-x border-slate-200"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/60"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge && (
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                tab.badge === "Interactive" ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-800"
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          {/* Status Header */}
          {(() => {
            const hasBlockingTasks = (blockingTasks ?? 0) > 0;
            const isFullyCompliant = report.compliant && !hasBlockingTasks;

            return (
              <div
                className={`rounded-xl border p-5 flex items-center justify-between shadow-sm ${
                  isFullyCompliant
                    ? "border-emerald-300 bg-emerald-50/70"
                    : "border-amber-300 bg-amber-50/70"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0 ${
                      isFullyCompliant ? "bg-emerald-600" : "bg-amber-600"
                    }`}
                  >
                    {isFullyCompliant ? <CheckIcon size={24} /> : <WarningIcon size={24} />}
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      {isFullyCompliant
                        ? "ISO 14289-1 (PDF/UA-1) Automated Validation Passed"
                        : report.compliant
                        ? "Automated Validation Passed — Manual Review Items Pending"
                        : "Remediated Output Generated — Review Follow-ups"}
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {isFullyCompliant
                        ? "All automated accessibility validations passed veraPDF verification. No unresolved blocking issues detected."
                        : report.compliant
                        ? `veraPDF reported 0 automated rule violations, but ${blockingTasks ?? 1} blocking ${pluralize(
                            blockingTasks ?? 1,
                            "issue"
                          )} require verification before full compliance can be certified.`
                        : `${report.violations.length} specific ${pluralize(
                            report.violations.length,
                            "violation"
                          )} flagged by veraPDF standard checks.`}
                    </p>
                    {hasBlockingTasks && (
                      <p className="text-[11px] font-medium text-amber-800 mt-1">
                        Notice: Automated validation verifies machine-testable PDF/UA-1 syntax. Complete accessibility verification requires resolving all blocking review tasks.
                      </p>
                    )}
                  </div>
                </div>

                <div className="hidden sm:flex flex-col items-end text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">Engine: veraPDF 1.26</span>
                  <span className="font-mono text-[11px]">Profile: {report.profile || "PDF/UA-1"}</span>
                </div>
              </div>
            );
          })()}

          {/* Before vs After Scorecards */}
          {(baselineIssues !== null || postIssues !== null) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                  Baseline (Original PDF)
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="font-display text-3xl font-extrabold text-slate-800">
                    {baselineIssues ?? "—"}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">failing rules</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">Unstructured, unembedded elements.</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                  Remediated Output
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="font-display text-3xl font-extrabold text-slate-800">
                    {postIssues ?? "0"}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">remaining rules</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {autoFixedIssues !== null ? `${autoFixedIssues} rules auto-resolved.` : "Remediated successfully."}
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
                <span className="text-[11px] uppercase font-bold text-amber-700 tracking-wider">
                  Automated Resolution Delta
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="font-display text-3xl font-extrabold text-amber-600">
                    {autoFixedIssues !== null
                      ? `${autoFixedIssues}`
                      : issuesReduced !== null
                      ? `${issuesReduced >= 0 ? "+" : ""}${issuesReduced}`
                      : "0"}
                  </span>
                  <span className="text-xs text-amber-800 font-medium">rules fixed</span>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  {autoRemediated !== null ? `${autoRemediated} auto-remediated total` : "Pipeline executed."}
                </p>
              </div>
            </div>
          )}

          {/* Quick Quality Summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-xs uppercase font-bold tracking-wider text-slate-500">
              Quality Assurance Checks
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Visual & Layout Fidelity</span>
                <p className="text-slate-900 font-bold mt-1">
                  {fidelityPassed ? "Passed (No Significant Drift)" : "Needs Review"}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Blocking User Tasks</span>
                <p className="text-slate-900 font-bold mt-1">
                  {blockingTasks ?? 0} {pluralize(blockingTasks ?? 0, "task")}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Advisory Items</span>
                <p className="text-slate-900 font-bold mt-1">
                  {advisoryTasks ?? 0} {pluralize(advisoryTasks ?? 0, "item")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: STRUCTURE TAG TREE */}
      {activeTab === "tree" && (
        <div className="animate-fade-in">
          {jobId ? (
            <TagTreeInspector jobId={jobId} />
          ) : (
            <div className="text-center py-12 text-slate-500 text-sm">
              Job ID required for live tag tree inspection.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: VERAPDF RULES BREAKDOWN */}
      {activeTab === "rules" && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-sm font-bold text-slate-900">
              Conformance Rules & Status ({changes.length})
            </h4>
            <span className="text-xs text-slate-500">
              ISO 14289-1:2014 & PDF 1.7 Specification Rules
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Rule Specification</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-center">Baseline</th>
                  <th className="py-2.5 px-3 text-center">Remediated</th>
                  <th className="py-2.5 px-3 text-right">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {changes.map((change) => (
                  <tr key={change.rule_id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                      {change.rule_id}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-md">
                      {change.description}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono">
                      {change.baseline_count}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-bold">
                      {change.post_count}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${statusTone(change.remediation_status)}`}>
                        {statusLabel(change.remediation_status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: FONT REMEDIATION */}
      {activeTab === "fonts" && (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h4 className="font-display text-base font-bold text-slate-900">
                  PDF/UA Font Embedding & Metrics (ISO 14289-1 Clause 7.21.4.1)
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Remediates unembedded Type 1, TrueType, and CID fonts to ensure screen-reader rendering consistency.
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                fontApplied ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}>
                {fontApplied ? "Remediation Applied" : fontAttempted ? "Attempted" : "Fully Embedded"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-400 font-semibold uppercase text-[10px]">Active Strategy</span>
                <p className="font-mono text-slate-900 font-bold mt-1">{selectedLane || "Local System & gsfonts"}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-400 font-semibold uppercase text-[10px]">Font Rules Addressed</span>
                <p className="font-mono text-slate-900 font-bold mt-1">
                  {fontErrorsResolved} resolved / {fontRules.length} tracked
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-400 font-semibold uppercase text-[10px]">Pipeline Attempts</span>
                <p className="font-mono text-slate-900 font-bold mt-1">
                  {lanesPlanned} planned
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 space-y-1">
              <p className="font-semibold">Automated Font Program Injection:</p>
              <p className="text-blue-800">
                Unembedded standard 14 and Type 1/TrueType fonts (e.g. Helvetica, Times-Roman, Courier) are resolved via metric-compatible font programs from Liberation and Ghostscript URW fonts. Font program streams and AFM metrics are embedded directly into font descriptors without destructive document re-rendering.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: FIDELITY & OCR */}
      {activeTab === "fidelity" && (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h4 className="font-display text-base font-bold text-slate-900">
              Text Extraction & Fidelity Analysis
            </h4>

            {(() => {
              const ocrCheck = fidelityChecks.find((c) => asString(c.check) === "ocr_coverage");
              const isScannedOrOcr = Boolean(ocrCheck);
              return (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isScannedOrOcr
                          ? ocrCheck?.status === "pass"
                            ? "bg-emerald-500"
                            : ocrCheck?.status === "fail"
                            ? "bg-red-500"
                            : "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    {isScannedOrOcr
                      ? "Optical Character Recognition (OCR) Analysis:"
                      : "Digital Vector Text vs Scanned Raster OCR:"}
                  </div>
                  <p>
                    {isScannedOrOcr
                      ? asString(ocrCheck?.message) ||
                        "Optical Character Recognition (OCR) was performed on scanned raster pages to extract selectable text."
                      : "This document contains digitally native text streams. Because digital text already possesses high-precision vector glyphs and character coordinates, optical character recognition (OCR) was safely bypassed to preserve 100% typographic sharpness and prevent OCR character errors."}
                  </p>
                </div>
              );
            })()}

            {fidelityChecks.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs uppercase font-bold text-slate-500">Automated Quality Checks</span>
                {fidelityChecks.map((check, index) => (
                  <div key={index} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-900 capitalize">{asString(check.check)}</span>
                      <p className="text-slate-500 mt-0.5">{asString(check.message)}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                      check.status === "pass"
                        ? "bg-emerald-100 text-emerald-800"
                        : check.status === "fail"
                        ? "bg-red-100 text-red-800"
                        : check.status === "warning"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-200 text-slate-700"
                    }`}>
                      {asString(check.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: TECHNICAL SPECS */}
      {activeTab === "technical" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 text-xs animate-fade-in">
          <h4 className="font-display text-base font-bold text-slate-900 mb-2">Technical Metadata</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-400">Standard & Profile:</span>
              <p className="font-mono text-slate-800 mt-0.5 font-bold">
                {report.standard || "PDF/UA-1"} ({report.profile || "ISO 14289-1:2014"})
              </p>
            </div>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-400">Validator Engine:</span>
              <p className="font-mono text-slate-800 mt-0.5 font-bold">{report.validator || "veraPDF 1.26"}</p>
            </div>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-400">Report Timestamp:</span>
              <p className="font-mono text-slate-800 mt-0.5 font-bold">
                {report.generated_at ? new Date(report.generated_at).toUTCString() : "n/a"}
              </p>
            </div>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-400">Platform:</span>
              <p className="text-slate-800 mt-0.5 font-bold">AccessFix PDF by Velvora Solutions</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
