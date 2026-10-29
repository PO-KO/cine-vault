import React, { useEffect, useRef } from 'react';
import {
  Search,
  X,
  Sun,
  Moon,
  Tv,
  RefreshCw,
  Keyboard,
  FolderPlus,
  LayoutGrid,
  List,
  ArrowUpDown,
  Wifi,
  History,
} from 'lucide-react';
import { SortOption, ViewLayout, WatchedFilter } from '../types/media';
import { NavTab } from './TopNav';

interface WorkspaceToolbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  watchedFilter: WatchedFilter;
  onSelectWatchedFilter: (filter: WatchedFilter) => void;
  sortBy: SortOption;
  onSelectSortBy: (sort: SortOption) => void;
  viewLayout: ViewLayout;
  onSelectViewLayout: (layout: ViewLayout) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  tvMode: boolean;
  onToggleTvMode: () => void;
  onRescan: () => void;
  onPickClientFolderFiles: (files: FileList | File[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPickDirectoryHandle?: (dirHandle: any) => Promise<void>;
  isScanning: boolean;
  onOpenShortcutsHelp: () => void;
  onOpenLanModal: () => void;
  onOpenHistoryModal: () => void;
  totalItemsCount: number;
  filteredItemsCount: number;
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  activeTab,
  onSelectTab,
  watchedFilter,
  onSelectWatchedFilter,
  sortBy,
  onSelectSortBy,
  viewLayout,
  onSelectViewLayout,
  searchQuery,
  onSearchChange,
  darkMode,
  onToggleDarkMode,
  tvMode,
  onToggleTvMode,
  onRescan,
  onPickClientFolderFiles,
  onPickDirectoryHandle,
  isScanning,
  onOpenShortcutsHelp,
  onOpenLanModal,
  onOpenHistoryModal,
  totalItemsCount,
  filteredItemsCount,
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const handlePickFolderClick = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (onPickDirectoryHandle && typeof win.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
        await onPickDirectoryHandle(dirHandle);
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        // If blocked by cross-origin iframe policy, fall back to <input webkitdirectory>
      }
    }
    folderInputRef.current?.click();
  };

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
    { id: 'continue', label: 'Watching' },
    { id: 'unwatched', label: 'Unwatched' },
    { id: 'completed', label: 'Completed' },
  ];

  return (
    <section
      aria-label="Library Filters and Device Controls"
      className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/50 px-4 sm:px-8 py-3.5"
    >
      <div className="max-w-[1440px] mx-auto flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Left: Search Input + Category Segmented Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                data-focusable="true"
                placeholder="Search titles, genres, folders, or formats..."
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

            {/* Category segmented control */}
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg overflow-x-auto">
              {categoryButtons.map((btn) => {
                const active = activeTab === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    data-focusable="true"
                    onClick={() => onSelectTab(btn.id)}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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

          {/* Right: Watched Status Filter + Sort + Layout */}
          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2">
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
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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

            {/* Sort Selector */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => onSelectSortBy(e.target.value as SortOption)}
                aria-label="Sort media library"
                data-focusable="true"
                className="bg-transparent font-medium focus:outline-none cursor-pointer"
              >
                <option value="lastWatched" className="bg-white dark:bg-slate-900">
                  Sort: Recently Watched
                </option>
                <option value="title" className="bg-white dark:bg-slate-900">
                  Sort: Title (A–Z)
                </option>
                <option value="year" className="bg-white dark:bg-slate-900">
                  Sort: Release Year
                </option>
                <option value="rating" className="bg-white dark:bg-slate-900">
                  Sort: Rating Score
                </option>
              </select>
            </div>

            {/* View Layout Toggle */}
            <div className="inline-flex items-center p-0.5 bg-slate-200/70 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg">
              <button
                type="button"
                data-focusable="true"
                onClick={() => onSelectViewLayout('grid')}
                title="Poster Grid View"
                aria-label="Poster Grid View"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewLayout === 'grid'
                    ? 'bg-white dark:bg-slate-800 text-rose-500 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-focusable="true"
                onClick={() => onSelectViewLayout('compact')}
                title="Compact List View"
                aria-label="Compact List View"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewLayout === 'compact'
                    ? 'bg-white dark:bg-slate-800 text-rose-500 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Utility Row: Item Count, Pick Folder, Rescan, LAN Streaming, History, TV Mode, Theme */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/50">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">
            Showing {filteredItemsCount} of {totalItemsCount} titles · State &amp; progress auto-saved
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {/* Native OS Folder Picker Button */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const filesCopy = Array.from(e.target.files);
                  e.target.value = '';
                  onPickClientFolderFiles(filesCopy);
                }
              }}
              className="hidden"
            />
            <button
              type="button"
              data-focusable="true"
              onClick={handlePickFolderClick}
              disabled={isScanning}
              title="Open native OS folder picker (or drag & drop a folder anywhere on screen)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg hover:bg-rose-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Pick PC Folder</span>
            </button>

            {/* Re-scan folder button */}
            <button
              type="button"
              data-focusable="true"
              onClick={onRescan}
              disabled={isScanning}
              title="Re-scan Server Media Folder"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-rose-500' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Scan'}</span>
            </button>

            {/* Watch History Button */}
            <button
              type="button"
              data-focusable="true"
              onClick={onOpenHistoryModal}
              title="View Persisted Watch History & Playback Preferences"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-rose-500" />
              <span>Watch History</span>
            </button>

            {/* LAN Streaming & Multi-Device Setup Button */}
            <button
              type="button"
              data-focusable="true"
              onClick={onOpenLanModal}
              title="Local Network (LAN) Streaming Setup & Multi-Device Access"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
              <span>LAN Stream</span>
            </button>

            {/* TV 10-Foot Mode Toggle */}
            <button
              type="button"
              data-focusable="true"
              onClick={onToggleTvMode}
              title="Toggle Smart TV Large-Screen UI & Remote D-Pad Mode"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
