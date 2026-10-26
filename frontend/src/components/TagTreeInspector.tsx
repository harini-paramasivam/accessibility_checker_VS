import { useState, useMemo, useEffect } from "react";

export interface TagTreeNode {
  id: string;
  tag: string;
  role: string;
  parent_tag?: string | null;
  parent_id?: string | null;
  title?: string;
  page?: number | null;
  alt?: string | null;
  actual_text?: string | null;
  attributes?: Record<string, any>;
  children?: TagTreeNode[];
  children_count?: number;
  issues?: string[];
}

export interface StructuralIssue {
  id: string;
  severity: "error" | "warning";
  tag: string;
  node_id: string;
  page?: number | null;
  message: string;
  suggestion?: string;
}

export interface TagTreeData {
  available: boolean;
  structural_score: number;
  is_valid_hierarchy: boolean;
  error_count: number;
  warning_count: number;
  stats: {
    total_nodes: number;
    counts_by_tag: Record<string, number>;
    headings_count: number;
    tables_count: number;
    lists_count: number;
    figures_count: number;
    links_count: number;
  };
  headings_hierarchy: Array<{
    node_id: string;
    tag: string;
    level: number;
    title: string;
    page: number;
  }>;
  issues: StructuralIssue[];
  tree: TagTreeNode[];
}

interface TagTreeInspectorProps {
  jobId: string;
  initialData?: TagTreeData | null;
}

export default function TagTreeInspector({ jobId, initialData }: TagTreeInspectorProps) {
  const [data, setData] = useState<TagTreeData | null>(initialData || null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | "headings" | "tables" | "figures" | "issues">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["tag-1", "tag-2"]));
  const [selectedNode, setSelectedNode] = useState<TagTreeNode | null>(null);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/jobs/${jobId}/tag-tree`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: TagTreeData) => {
        setData(json);
        // Expand first level
        if (json.tree && json.tree.length > 0) {
          const ids = new Set<string>();
          json.tree.forEach((root) => {
            ids.add(root.id);
            root.children?.forEach((c) => ids.add(c.id));
          });
          setExpandedNodes(ids);
          setSelectedNode(json.tree[0]);
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load structure tree");
      })
      .finally(() => setLoading(false));
  }, [jobId, initialData]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!data?.tree) return;
    const all = new Set<string>();
    const walk = (nodes: TagTreeNode[]) => {
      nodes.forEach((n) => {
        all.add(n.id);
        if (n.children) walk(n.children);
      });
    };
    walk(data.tree);
    setExpandedNodes(all);
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  const filteredTree = useMemo(() => {
    if (!data?.tree) return [];
    if (filterType === "all" && !searchQuery.trim()) return data.tree;

    const query = searchQuery.toLowerCase().trim();

    const matchesFilter = (node: TagTreeNode): boolean => {
      const tagLower = node.tag.toLowerCase();
      if (filterType === "headings" && !tagLower.startsWith("h")) return false;
      if (filterType === "tables" && !["table", "thead", "tbody", "tr", "th", "td", "l", "li", "lbl", "lbody"].includes(tagLower)) return false;
      if (filterType === "figures" && tagLower !== "figure") return false;
      if (filterType === "issues" && (!node.issues || node.issues.length === 0)) return false;

      if (query) {
        const matchesTag = tagLower.includes(query);
        const matchesTitle = (node.title || "").toLowerCase().includes(query);
        const matchesAlt = (node.alt || "").toLowerCase().includes(query);
        return matchesTag || matchesTitle || matchesAlt;
      }
      return true;
    };

    const filterNodes = (nodes: TagTreeNode[]): TagTreeNode[] => {
      const result: TagTreeNode[] = [];
      for (const node of nodes) {
        const matchingChildren = node.children ? filterNodes(node.children) : [];
        if (matchesFilter(node) || matchingChildren.length > 0) {
          result.push({
            ...node,
            children: matchingChildren.length > 0 ? matchingChildren : node.children,
          });
        }
      }
      return result;
    };

    return filterNodes(data.tree);
  }, [data, filterType, searchQuery]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Analyzing PDF/UA Logical Structure Tree...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-slate-500">
          Logical structure tree inspection is not available for this document.
        </p>
      </div>
    );
  }

  const scoreColor =
    data.structural_score >= 90
      ? "text-emerald-600 border-emerald-500/30 bg-emerald-50"
      : data.structural_score >= 75
      ? "text-amber-600 border-amber-500/30 bg-amber-50"
      : "text-red-600 border-red-500/30 bg-red-50";

  return (
    <div className="space-y-6">
      {/* Structural Health Score & Statistics Hero */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Score Card */}
        <div className={`rounded-xl border p-5 flex flex-col justify-between ${scoreColor}`}>
          <div>
            <span className="text-xs uppercase font-bold tracking-wider opacity-80">Structure Health</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-display text-4xl font-extrabold">{data.structural_score}</span>
              <span className="text-sm font-medium opacity-70">/ 100</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold">
            {data.is_valid_hierarchy ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Valid Hierarchy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {data.error_count} structural issue{data.error_count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* Headings Stat */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-slate-500">Headings (H1–H6)</span>
            <p className="font-display text-2xl font-bold text-slate-900 mt-1">{data.stats.headings_count}</p>
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {["H1", "H2", "H3"].map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-700 border border-purple-200">
                {tag}: {data.stats.counts_by_tag[tag] || 0}
              </span>
            ))}
          </div>
        </div>

        {/* Tables & Lists Stat */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-slate-500">Tables & Lists</span>
            <div className="flex items-baseline gap-3 mt-1">
              <div>
                <span className="text-lg font-bold text-slate-900">{data.stats.tables_count}</span>
                <span className="text-xs text-slate-500 ml-1">Tables</span>
              </div>
              <span className="text-slate-300">·</span>
              <div>
                <span className="text-lg font-bold text-slate-900">{data.stats.lists_count}</span>
                <span className="text-xs text-slate-500 ml-1">Lists</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            TH: {data.stats.counts_by_tag["TH"] || 0} | TD: {data.stats.counts_by_tag["TD"] || 0}
          </p>
        </div>

        {/* Figures & Issues Stat */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-slate-500">Figures & Media</span>
            <p className="font-display text-2xl font-bold text-slate-900 mt-1">{data.stats.figures_count}</p>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
            <span>Links: {data.stats.links_count}</span>
            <span className={`font-semibold ${data.error_count > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {data.error_count + data.warning_count} total alerts
            </span>
          </div>
        </div>
      </div>

      {/* Issues Callout if any */}
      {data.issues.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h4 className="text-sm font-bold text-amber-900">Structural Quality Alerts ({data.issues.length})</h4>
          </div>
          <div className="space-y-2 mt-2">
            {data.issues.slice(0, 4).map((issue) => (
              <div key={issue.id} className="text-xs text-amber-950 bg-white/70 rounded-lg p-2.5 border border-amber-200/60 flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${issue.severity === "error" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  {issue.severity}
                </span>
                <div className="flex-1">
                  <span className="font-semibold">{issue.message}</span>
                  {issue.suggestion && <p className="text-amber-800/80 mt-0.5">{issue.suggestion}</p>}
                </div>
                {issue.page && <span className="text-[11px] font-mono text-slate-500 shrink-0">p. {issue.page}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Control Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: "all", label: "All Elements" },
            { id: "headings", label: "Headings" },
            { id: "tables", label: "Tables & Lists" },
            { id: "figures", label: "Figures" },
            { id: "issues", label: `Issues (${data.issues.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === tab.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <input
              type="text"
              placeholder="Search tags or text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-1.5 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <button
            onClick={expandAll}
            className="text-xs px-2.5 py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-2.5 py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Two Column Layout: Interactive Tree + Node Details Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree Container */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-h-[480px] max-h-[700px] overflow-y-auto">
          {filteredTree.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              No structural elements match the selected filter.
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTree.map((node) => (
                <TreeNodeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedNodes={expandedNodes}
                  toggleExpand={toggleExpand}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                />
              ))}
            </div>
          )}
        </div>

        {/* Selected Node Details Drawer */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm h-fit sticky top-24">
          <h4 className="text-xs uppercase font-bold tracking-wider text-slate-500 mb-4 pb-2 border-b border-slate-100">
            Element Inspector
          </h4>

          {selectedNode ? (
            <div className="space-y-4 text-xs">
              <div>
                <span className="text-slate-400 uppercase text-[10px] font-semibold">Element Tag</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2.5 py-1 rounded-md font-mono text-xs font-bold bg-slate-900 text-white">
                    &lt;{selectedNode.tag}&gt;
                  </span>
                  <span className="capitalize text-slate-600 font-medium">{selectedNode.role}</span>
                  {selectedNode.page && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[11px]">
                      Page {selectedNode.page}
                    </span>
                  )}
                </div>
              </div>

              {/* Hierarchy Context: Parent and Children */}
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold text-[11px]">Parent Tag:</span>
                  {selectedNode.parent_tag ? (
                    <span className="px-2 py-0.5 rounded bg-white font-mono text-[11px] font-bold text-slate-800 border border-slate-200">
                      &lt;{selectedNode.parent_tag}&gt;
                    </span>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">Root Element</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold text-[11px]">Children:</span>
                  <span className="font-mono text-[11px] text-slate-700 font-bold">
                    {selectedNode.children?.length ?? selectedNode.children_count ?? 0} direct
                  </span>
                </div>
                {selectedNode.children && selectedNode.children.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-200/60">
                    {Array.from(new Set(selectedNode.children.map((c) => c.tag))).map((ctag) => (
                      <span key={ctag} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white text-slate-700 border border-slate-200">
                        &lt;{ctag}&gt; ({selectedNode.children!.filter((c) => c.tag === ctag).length})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Associated Content */}
              {selectedNode.title && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px] font-semibold">Associated Content</span>
                  <p className="mt-1 p-2.5 rounded-lg bg-slate-50 text-slate-800 border border-slate-200/60 font-medium break-words">
                    {selectedNode.title}
                  </p>
                </div>
              )}

              {/* Alternative Text & Placeholder Warning */}
              {selectedNode.tag === "Figure" && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px] font-semibold">Alternative Text (Alt)</span>
                  {selectedNode.alt ? (
                    selectedNode.alt.startsWith("[") || selectedNode.alt.toLowerCase().includes("could not determine") || selectedNode.alt.toLowerCase().includes("placeholder") ? (
                      <div className="mt-1 p-2.5 rounded-lg bg-red-50 text-red-900 border border-red-300">
                        <span className="font-bold block mb-1">Unresolved Placeholder Description:</span>
                        <code className="text-xs break-words bg-red-100/80 px-1 py-0.5 rounded">{selectedNode.alt}</code>
                        <p className="mt-1 text-[11px] text-red-700">Flagged for manual review. Placeholder text is not valid accessibility description.</p>
                      </div>
                    ) : (
                      <p className="mt-1 p-2.5 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 break-words">
                        "{selectedNode.alt}"
                      </p>
                    )
                  ) : (
                    <div className="mt-1 p-2.5 rounded-lg bg-red-50 text-red-900 border border-red-200">
                      <p className="font-semibold">Missing Alternative Text</p>
                      <p className="mt-0.5 text-[11px] text-red-700">Screen readers cannot convey the visual meaning of this figure without an Alt attribute.</p>
                    </div>
                  )}
                </div>
              )}

              {selectedNode.tag !== "Figure" && selectedNode.alt && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px] font-semibold">Alternative Text</span>
                  <p className="mt-1 p-2.5 rounded-lg bg-slate-50 text-slate-800 border border-slate-200">
                    "{selectedNode.alt}"
                  </p>
                </div>
              )}

              {selectedNode.attributes && Object.keys(selectedNode.attributes).length > 0 && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px] font-semibold">Attributes</span>
                  <div className="mt-1 space-y-1 font-mono text-[11px] p-2 bg-slate-50 rounded-lg border border-slate-200">
                    {Object.entries(selectedNode.attributes).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-500">/{k}:</span>
                        <span className="font-semibold text-slate-800">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedNode.issues && selectedNode.issues.length > 0 && (
                <div>
                  <span className="text-red-500 uppercase text-[10px] font-bold">Structural Violations ({selectedNode.issues.length})</span>
                  <div className="mt-1 space-y-1">
                    {selectedNode.issues.map((iss, i) => (
                      <div key={i} className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-900 font-medium">
                        {iss}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 text-slate-400 text-[11px] flex justify-between">
                <span>Node ID: <code className="font-mono">{selectedNode.id}</code></span>
                <span>Children: {selectedNode.children?.length ?? selectedNode.children_count ?? 0}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-10">
              Click any element in the tree to inspect attributes, scope, and accessibility metadata.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  expandedNodes,
  toggleExpand,
  selectedNode,
  onSelectNode,
}: {
  node: TagTreeNode;
  depth: number;
  expandedNodes: Set<string>;
  toggleExpand: (id: string) => void;
  selectedNode: TagTreeNode | null;
  onSelectNode: (node: TagTreeNode) => void;
}) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNode?.id === node.id;
  const hasIssues = Boolean(node.issues && node.issues.length > 0);

  const getTagBadgeStyle = (tag: string) => {
    const t = tag.toUpperCase();
    if (t === "DOCUMENT" || t === "PART" || t === "SECT") return "bg-slate-800 text-slate-100";
    if (t.startsWith("H")) return "bg-purple-100 text-purple-800 border-purple-300";
    if (t === "TABLE" || t === "TR") return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (t === "TH") return "bg-amber-100 text-amber-900 border-amber-300 font-bold";
    if (t === "TD") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (t === "L" || t === "LI" || t === "LBL" || t === "LBODY") return "bg-blue-100 text-blue-800 border-blue-300";
    if (t === "FIGURE") return "bg-amber-500 text-white";
    if (t === "LINK") return "bg-cyan-100 text-cyan-800 border-cyan-300";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  return (
    <div className="select-none">
      <div
        onClick={() => onSelectNode(node)}
        style={{ paddingLeft: `${depth * 20}px` }}
        className={`flex items-center gap-2 py-1 px-2 rounded-lg cursor-pointer transition-colors text-xs ${
          isSelected
            ? "bg-amber-50 border border-amber-300 shadow-sm"
            : "hover:bg-slate-100/80"
        }`}
      >
        {/* Expand/Collapse Chevron */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Tag Pill */}
        <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border shrink-0 ${getTagBadgeStyle(node.tag)}`}>
          &lt;{node.tag}&gt;
        </span>

        {/* Scope Pill if TH */}
        {node.attributes?.scope && (
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono uppercase bg-amber-200/80 text-amber-900 border border-amber-300 font-bold shrink-0">
            Scope:{node.attributes.scope}
          </span>
        )}

        {/* Alt status for Figure */}
        {node.tag === "Figure" && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
              !node.alt
                ? "bg-red-100 text-red-800 border border-red-200"
                : node.alt.startsWith("[") || node.alt.toLowerCase().includes("could not determine") || node.alt.toLowerCase().includes("placeholder")
                ? "bg-amber-100 text-amber-900 border border-amber-300 font-bold"
                : "bg-emerald-100 text-emerald-800 border border-emerald-200"
            }`}
          >
            {!node.alt
              ? "Missing Alt"
              : node.alt.startsWith("[") || node.alt.toLowerCase().includes("could not determine") || node.alt.toLowerCase().includes("placeholder")
              ? "Unresolved Alt"
              : "Alt Verified"}
          </span>
        )}

        {/* Snippet */}
        {node.title && (
          <span className="truncate text-slate-600 font-medium max-w-xs sm:max-w-md">
            {node.title}
          </span>
        )}

        {/* Page Badge */}
        {node.page && (
          <span className="ml-auto text-[10px] font-mono text-slate-400 shrink-0">
            p.{node.page}
          </span>
        )}

        {/* Issue Warning Marker */}
        {hasIssues && (
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 ml-1" title={node.issues?.join("; ")} />
        )}
      </div>

      {/* Recursive Children */}
      {hasChildren && isExpanded && (
        <div className="border-l border-slate-200/60 ml-2">
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNodes={expandedNodes}
              toggleExpand={toggleExpand}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
