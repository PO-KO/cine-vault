import React from 'react';
import { MediaCategory } from '../types/media';

export type NavTab = 'all' | MediaCategory | 'watchlist';

interface TopNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenLibrarySettings: () => void;
  tvMode: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenLibrarySettings,
  tvMode,
}) => {
  const navLinks: { id: NavTab; label: string }[] = [
    { id: 'all', label: 'All Library' },
    { id: 'anime', label: 'Anime' },
    { id: 'tv', label: 'TV Shows' },
    { id: 'movies', label: 'Movies' },
    { id: 'watchlist', label: 'Watchlist' },
  ];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 sm:px-8 py-3.5 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 transition-colors">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('all');
        }}
        data-focusable="true"
        className={`font-display font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 rounded-md px-1 ${
          tvMode ? 'text-2xl' : 'text-xl'
        }`}
      >
        CineVault
      </a>

      {/* Zone 2: 5 clean single-line text navigation links */}
      <nav aria-label="Primary Library Navigation" className="hidden md:flex items-center gap-7">
        {navLinks.map((link) => {
          const isActive = activeTab === link.id;
          return (
            <button
              key={link.id}
              type="button"
              data-focusable="true"
              onClick={() => onSelectTab(link.id)}
              className={`relative py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
                tvMode ? 'text-base' : 'text-sm'
              } ${
                isActive
                  ? 'text-rose-600 dark:text-rose-400 font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-rose-600 dark:after:bg-rose-500'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {link.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          data-focusable="true"
          onClick={onOpenLibrarySettings}
          className={`px-4 py-2 font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            tvMode ? 'text-sm py-2.5 px-5' : 'text-xs'
          }`}
        >
          Library Folder
        </button>
      </div>
    </header>
  );
};
