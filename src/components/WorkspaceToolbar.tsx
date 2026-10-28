import React from 'react';
import { Search, X, Sun, Moon, Tv, RefreshCw, Keyboard } from 'lucide-react';
import { WatchedFilter } from '../types/media';
import { NavTab } from './TopNav';

interface WorkspaceToolbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  watchedFilter: WatchedFilter;
  onSelectWatchedFilter: (filter: WatchedFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  tvMode: boolean;
  onToggleTvMode: () => void;
  onRescan: () => void;
  isScanning: boolean;
  onOpenShortcutsHelp: () => void;
  totalItemsCount: number;
  filteredItemsCount: number;
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  activeTab,
  onSelectTab,
  watchedFilter,
  onSelectWatchedFilter,
  searchQuery,
  onSearchChange,
  darkMode,
  onToggleDarkMode,
  tvMode,
  onToggleTvMode,
  onRescan,
  isScanning,
  onOpenShortcutsHelp,
  totalItemsCount,
  filteredItemsCount,
}) => {
  const categoryButtons: { id: NavTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'anime', label: 'Anime' },
    { id: 'tv', label: 'TV Shows' },
    { id: 'movies', label: 'Movies' },
    { id: 'other', label: 'Other' },
    { id: 'watchlist', label: 'Watchlist' },
  ];

  const watchedButtons: { id: WatchedFilter; label: string }[] = [
    { id: 'all', label: 'All Status' },
    { id: 'continue', label: 'In Progress' },
    { id: 'unwatched', label: 'Unwatched' },
    { id: 'completed', label: 'Completed' },
  ];

  return (
    <section
      aria-label="Library Filters and Device Controls"
      className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/50 px-4 sm:px-8 py-3.5"
    >
      <div className="max-w-[1440px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5">
        {/* Left: Search Input + Category Segmented Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              data-focusable="true"
              placeholder="Search titles, folders, or formats (MKV, MP4)..."
              aria-label="Search media library"
              className={`w-full pl-10 pr-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-rose-500 transition-colors ${
                tvMode ? 'py-2.5 text-base' : 'py-2 text-sm'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category segmented control (accessible on mobile, desktop & TV) */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg overflow-x-auto">
            {categoryButtons.map((btn) => {
              const active = activeTab === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  data-focusable="true"
                  onClick={() => onSelectTab(btn.id)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                    tvMode ? 'text-sm' : 'text-xs'
                  } ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Watched Status Filter + Device / Theme Controls */}
        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5">
          {/* Watched filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg overflow-x-auto">
            {watchedButtons.map((wb) => {
              const active = watchedFilter === wb.id;
              return (
                <button
                  key={wb.id}
                  type="button"
                  data-focusable="true"
                  onClick={() => onSelectWatchedFilter(wb.id)}
                  className={`px-2.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                    tvMode ? 'text-sm' : 'text-xs'
                  } ${
                    active
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {wb.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {/* Count indicator in clean unboxed text */}
            <span className="hidden xl:inline-block text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums px-1 whitespace-nowrap">
              {filteredItemsCount} of {totalItemsCount} items
            </span>

            {/* Re-scan folder button */}
            <button
              type="button"
              data-focusable="true"
              onClick={onRescan}
              disabled={isScanning}
              title="Re-scan Local Media Folder"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-rose-500' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Scan'}</span>
            </button>

            {/* TV 10-Foot Mode Toggle */}
            <button
              type="button"
              data-focusable="true"
              onClick={onToggleTvMode}
              title="Toggle Smart TV Large-Screen UI & Remote D-Pad Mode"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                tvMode
                  ? 'bg-rose-600 border-rose-600 text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>TV Mode</span>
            </button>

            {/* Remote & Keyboard Shortcuts Guide */}
            <button
              type="button"
              data-focusable="true"
              onClick={onOpenShortcutsHelp}
              title="Keyboard, Touch & Smart TV Remote Controls"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Controls</span>
            </button>

            {/* Dark / Light Mode Theme Toggle */}
            <button
              type="button"
              data-focusable="true"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {darkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
