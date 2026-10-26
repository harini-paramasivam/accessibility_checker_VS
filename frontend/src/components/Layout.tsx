import { useState, useEffect } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 no-underline flex items-center gap-2 ${
    isActive
      ? "bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"
      : "text-slate-300 hover:text-white hover:bg-slate-800/60"
  }`;

export default function Layout() {
  const [engineReady, setEngineReady] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health/ready")
      .then((res) => res.json())
      .then((data) => {
        setEngineReady(data?.status === "ready");
      })
      .catch(() => {
        setEngineReady(false);
      });
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      {/* Enterprise Top Navigation */}
      <header className="bg-[#0A1128] border-b border-slate-800/80 sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo & Brand Name */}
          <Link to="/" className="flex items-center gap-3.5 no-underline group shrink-0">
            <div className="p-1 rounded-xl bg-slate-900/80 border border-purple-500/40 shadow-sm flex items-center justify-center transition-transform group-hover:scale-105">
              <img
                src={`${import.meta.env.BASE_URL}velvora-logo.png`}
                alt="Velvora Solutions"
                className="h-10 w-auto object-contain"
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-bold tracking-tight text-white group-hover:text-purple-300 transition-colors">
                  AccessFix PDF
                </span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-purple-400/15 text-purple-300 border border-purple-400/30">
                  Enterprise
                </span>
              </div>
              <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                by <span className="text-purple-300 font-semibold tracking-wide">Velvora Solutions</span>
              </span>
            </div>
          </Link>

          {/* Navigation Links & Engine Status */}
          <div className="flex items-center gap-2 sm:gap-4">
            <nav className="flex items-center gap-1 sm:gap-2">
              <NavLink to="/" end className={navLinkClass}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Upload</span>
              </NavLink>
              <NavLink to="/dashboard" className={navLinkClass}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Dashboard</span>
              </NavLink>
            </nav>

            <div className="hidden md:block w-px h-6 bg-slate-800" />

            {/* Engine Status indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
              <span className={`w-2 h-2 rounded-full ${engineReady === true ? "bg-emerald-400 animate-pulse" : engineReady === false ? "bg-red-400" : "bg-amber-400 animate-ping"}`} />
              <span className="font-medium text-slate-300">
                {engineReady === true ? "PDF/UA Engine Ready" : engineReady === false ? "Engine Offline" : "Connecting..."}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <Outlet />
        </div>
      </main>

      {/* Enterprise Footer */}
      <footer className="bg-[#0A1128] text-slate-400 border-t border-slate-800 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img
                src={`${import.meta.env.BASE_URL}velvora-logo.png`}
                alt="Velvora Solutions"
                className="h-7 w-auto object-contain opacity-90"
              />
              <div className="text-xs">
                <span className="text-white font-semibold">AccessFix PDF</span> · Enterprise Accessibility Platform
                <div className="text-slate-400 text-[11px]">ISO 14289-1 (PDF/UA-1) & WCAG 2.1 AA Compliance Automated Pipeline</div>
              </div>
            </div>

            <div className="flex flex-col sm:items-end text-xs text-slate-400">
              <span>© {new Date().getFullYear()} Velvora Solutions. All rights reserved.</span>
              <span className="font-mono text-[11px] text-purple-300/80 mt-0.5">Version 2.0.0 Enterprise</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
