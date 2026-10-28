'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, FolderOpen, Film, RotateCcw } from 'lucide-react';
import {
  LibraryResponse,
  MediaCategory,
  MediaEpisode,
  MediaItem,
  SystemCapabilities,
  WatchedFilter,
} from './types/media';
import { NavTab, TopNav } from './components/TopNav';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { HeroSpotlight } from './components/HeroSpotlight';
import { MediaCard } from './components/MediaCard';
import { SeriesDetailModal } from './components/SeriesDetailModal';
import { EditMetadataModal } from './components/EditMetadataModal';
import { LibrarySettingsModal } from './components/LibrarySettingsModal';
import { ControlsHelpModal } from './components/ControlsHelpModal';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { formatRemainingTime, formatTimecode } from './utils/formatters';

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Navigation & Filtering State
  const [activeTab, setActiveTab] = useState<NavTab>('all');
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Theme & Device Mode State
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [tvMode, setTvMode] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = window.localStorage.getItem('cinevault_theme');
      if (savedTheme) {
        setDarkMode(savedTheme === 'dark');
      }
      const savedTv = window.localStorage.getItem('cinevault_tv_mode');
      if (savedTv) {
        setTvMode(savedTv === 'true');
      }
    }
  }, []);

  // Active Modals State
  const [activePlayback, setActivePlayback] = useState<{
    item: MediaItem;
    episode: MediaEpisode;
  } | null>(null);
  const [seriesDetailItem, setSeriesDetailItem] = useState<MediaItem | null>(null);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [showLibrarySettings, setShowLibrarySettings] = useState<boolean>(false);
  const [showControlsHelp, setShowControlsHelp] = useState<boolean>(false);

  // Sync Dark / Light Mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('cinevault_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('cinevault_theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('cinevault_tv_mode', String(tvMode));
  }, [tvMode]);

  // Fetch Library from Server
  const fetchLibrary = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/library');
      if (!res.ok) {
        throw new Error('Failed to load local media library from server.');
      }
      const data: LibraryResponse = await res.json();
      setItems(data.items);
      setCapabilities(data.capabilities);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to connect to local media server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Keep open modals synchronized when items update
  useEffect(() => {
    if (seriesDetailItem) {
      const updated = items.find((i) => i.id === seriesDetailItem.id);
      if (updated) setSeriesDetailItem(updated);
    }
    if (activePlayback) {
      const updatedItem = items.find((i) => i.id === activePlayback.item.id);
      const updatedEp = updatedItem?.episodes.find((e) => e.id === activePlayback.episode.id);
      if (updatedItem && updatedEp) {
        setActivePlayback({ item: updatedItem, episode: updatedEp });
      }
    }
  }, [items]);

  // Smart TV D-Pad Spatial Navigation across [data-focusable="true"] elements when no modal is open
  useEffect(() => {
    const handleSpatialKeys = (e: KeyboardEvent) => {
      if (activePlayback || editingItem || showLibrarySettings || showControlsHelp) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;

      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>('[data-focusable="true"]:not([disabled])')
      ).filter((el) => el.offsetParent !== null);

      if (focusables.length === 0) return;

      const currentIdx = focusables.indexOf(document.activeElement as HTMLElement);
      if (currentIdx === -1) {
        e.preventDefault();
        focusables[0]?.focus();
        return;
      }

      e.preventDefault();
      let nextIdx = currentIdx;
      if (e.key === 'ArrowRight') {
        nextIdx = Math.min(focusables.length - 1, currentIdx + 1);
      } else if (e.key === 'ArrowLeft') {
        nextIdx = Math.max(0, currentIdx - 1);
      } else if (e.key === 'ArrowDown') {
        nextIdx = Math.min(focusables.length - 1, currentIdx + 3);
      } else if (e.key === 'ArrowUp') {
        nextIdx = Math.max(0, currentIdx - 3);
      }
      focusables[nextIdx]?.focus();
    };

    window.addEventListener('keydown', handleSpatialKeys);
    return () => window.removeEventListener('keydown', handleSpatialKeys);
  }, [activePlayback, editingItem, showLibrarySettings, showControlsHelp]);

  // Handlers for server mutations
  const handleRescan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/library/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data: LibraryResponse = await res.json();
        setItems(data.items);
        setCapabilities(data.capabilities);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleApplyRootPath = async (newPath: string) => {
    const res = await fetch('/api/library/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: newPath }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Could not scan folder path.');
    }
    const data: LibraryResponse = await res.json();
    setItems(data.items);
    setCapabilities(data.capabilities);
  };

  const handleToggleFavorite = async (item: MediaItem) => {
    const res = await fetch(`/api/media/${item.id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: !item.isFavorite }),
    });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
    }
  };

  const handleSaveMetadata = async (
    id: string,
    updates: {
      title: string;
      category: MediaCategory;
      synopsis: string;
      customPosterUrl: string;
    }
  ) => {
    const res = await fetch(`/api/media/${id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
    }
  };

  const handleSaveProgress = useCallback(
    async (episodeId: string, currentTime: number, duration: number, completed?: boolean) => {
      const res = await fetch(`/api/episodes/${episodeId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, duration, completed }),
      });
      if (res.ok) {
        await fetchLibrary();
      }
    },
    [fetchLibrary]
  );

  const handleToggleWatched = async (episode: MediaEpisode, completed: boolean) => {
    await handleSaveProgress(
      episode.id,
      completed ? 0 : episode.progress.currentTime,
      episode.progress.duration || episode.estimatedDurationSec,
      completed
    );
  };

  // Continue Watching Row Items
  const continueWatchingList = useMemo(() => {
    const list: { item: MediaItem; episode: MediaEpisode }[] = [];
    for (const item of items) {
      if (item.inProgressEpisode) {
        list.push({ item, episode: item.inProgressEpisode });
      }
    }
    return list.sort((a, b) =>
      (b.episode.progress.updatedAt || '').localeCompare(a.episode.progress.updatedAt || '')
    );
  }, [items]);

  // Featured Spotlight Item (most recent Continue Watching item or first item in library)
  const spotlightEntry = useMemo(() => {
    if (continueWatchingList.length > 0) {
      return continueWatchingList[0];
    }
    const first = items[0];
    if (first && first.episodes[0]) {
      return { item: first, episode: first.episodes[0] };
    }
    return null;
  }, [continueWatchingList, items]);

  // Filtered Library Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Category / Watchlist Tab Filter
      if (activeTab === 'watchlist' && !item.isFavorite) return false;
      if (activeTab !== 'all' && activeTab !== 'watchlist' && item.category !== activeTab) {
        return false;
      }

      // Watched Status Filter
      if (watchedFilter === 'continue' && !item.inProgressEpisode) return false;
      if (watchedFilter === 'unwatched' && (item.watchedEpisodes > 0 || item.inProgressEpisode)) {
        return false;
      }
      if (
        watchedFilter === 'completed' &&
        (item.totalEpisodes === 0 || item.watchedEpisodes < item.totalEpisodes)
      ) {
        return false;
      }

      // Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesFolder = item.relativePath.toLowerCase().includes(q);
        const matchesEpisode = item.episodes.some(
          (ep) =>
            ep.title.toLowerCase().includes(q) ||
            ep.fileName.toLowerCase().includes(q) ||
            ep.containerFormat.toLowerCase().includes(q)
        );
        if (!matchesTitle && !matchesFolder && !matchesEpisode) return false;
      }

      return true;
    });
  }, [items, activeTab, watchedFilter, searchQuery]);

  return (
    <div
      id="top"
      className={`min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors ${
        tvMode ? 'tv-mode' : ''
      }`}
    >
      {/* 1. Strictly Compliant 3-Zone Top Bar */}
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenLibrarySettings={() => setShowLibrarySettings(true)}
        tvMode={tvMode}
      />

      {/* 2. Workspace Toolbar (Search, Filters, Theme & TV Mode) */}
      <WorkspaceToolbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        watchedFilter={watchedFilter}
        onSelectWatchedFilter={setWatchedFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        tvMode={tvMode}
        onToggleTvMode={() => setTvMode((t) => !t)}
        onRescan={handleRescan}
        isScanning={isScanning}
        onOpenShortcutsHelp={() => setShowControlsHelp(true)}
        totalItemsCount={items.length}
        filteredItemsCount={filteredItems.length}
      />

      {/* 3. Main Content Viewport (1440px Baseline) */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-10">
        {loading ? (
          <div className="space-y-8 animate-pulse">
            <div className="h-72 rounded-2xl bg-slate-200 dark:bg-slate-900" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="aspect-[3/4] rounded-xl bg-slate-200 dark:bg-slate-900" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center space-y-3">
            <h2 className="font-display font-bold text-xl text-red-600 dark:text-red-400">
              Unable to Read Local Media Library
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">{error}</p>
            <button
              type="button"
              onClick={fetchLibrary}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <>
            {/* Hero Spotlight Section (shown when browsing All Library without active search) */}
            {activeTab === 'all' && watchedFilter === 'all' && !searchQuery && spotlightEntry && (
              <HeroSpotlight
                item={spotlightEntry.item}
                targetEpisode={spotlightEntry.episode}
                onPlayEpisode={(item, ep) => setActivePlayback({ item, episode: ep })}
                onOpenSeriesDetails={(item) => setSeriesDetailItem(item)}
                onToggleFavorite={handleToggleFavorite}
                onOpenEditMetadata={(item) => setEditingItem(item)}
                tvMode={tvMode}
              />
            )}

            {/* Continue Watching Row */}
            {activeTab === 'all' &&
              watchedFilter === 'all' &&
              !searchQuery &&
              continueWatchingList.length > 0 && (
                <section aria-labelledby="continue-watching-heading" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2
                      id="continue-watching-heading"
                      className={`font-display font-bold text-slate-900 dark:text-white ${
                        tvMode ? 'text-2xl' : 'text-lg sm:text-xl'
                      }`}
                    >
                      Continue Watching
                    </h2>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {continueWatchingList.length} in progress
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {continueWatchingList.map(({ item, episode }) => {
                      const pct =
                        episode.progress.duration > 0
                          ? Math.min(
                              100,
                              Math.round((episode.progress.currentTime / episode.progress.duration) * 100)
                            )
                          : 0;
                      return (
                        <div
                          key={episode.id}
                          className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 hover:border-rose-500/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                {item.autoType === 'series'
                                  ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(
                                      episode.episodeNumber
                                    ).padStart(2, '0')}`
                                  : episode.containerFormat.toUpperCase()}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {formatTimecode(episode.progress.currentTime)} /{' '}
                                {formatTimecode(episode.progress.duration)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {formatRemainingTime(
                                  episode.progress.currentTime,
                                  episode.progress.duration
                                )}
                              </span>
                            </div>

                            <h3 className="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                              {item.title}
                            </h3>

                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {episode.title}
                            </p>

                            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-rose-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>

                          <button
                            type="button"
                            data-focusable="true"
                            onClick={() => setActivePlayback({ item, episode })}
                            aria-label={`Resume ${item.title}`}
                            className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Resume</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

            {/* Main Media Library Grid Section */}
            <section aria-labelledby="library-grid-heading" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="library-grid-heading"
                  className={`font-display font-bold text-slate-900 dark:text-white ${
                    tvMode ? 'text-2xl' : 'text-lg sm:text-xl'
                  }`}
                >
                  {activeTab === 'all'
                    ? 'Local Media Library'
                    : activeTab === 'anime'
                    ? 'Anime Collection'
                    : activeTab === 'tv'
                    ? 'TV Shows'
                    : activeTab === 'movies'
                    ? 'Movies & Films'
                    : activeTab === 'other'
                    ? 'Other Videos'
                    : 'Personal Watchlist'}
                </h2>

                {capabilities && (
                  <button
                    type="button"
                    onClick={() => setShowLibrarySettings(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-mono truncate max-w-md cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                    <span className="truncate">{capabilities.rootPath}</span>
                  </button>
                )}
              </div>

              {filteredItems.length > 0 ? (
                <div
                  className={`grid gap-5 ${
                    tvMode
                      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  }`}
                >
                  {filteredItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      onPlay={(media, ep) => {
                        const targetEp = ep || media.inProgressEpisode || media.episodes[0];
                        if (targetEp) {
                          setActivePlayback({ item: media, episode: targetEp });
                        }
                      }}
                      onOpenSeries={(media) => setSeriesDetailItem(media)}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenEdit={(media) => setEditingItem(media)}
                      onToggleWatched={handleToggleWatched}
                      tvMode={tvMode}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-12 text-center space-y-3">
                  <Film className="w-10 h-10 text-slate-400 mx-auto" />
                  <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                    No Matching Media Found
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    No movies, anime, or series match your current category or filter selection. Try clearing your filters or scanning another local folder on your PC.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('all');
                        setWatchedFilter('all');
                        setSearchQuery('');
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Filters</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLibrarySettings(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Change Local Folder</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* 4. Quiet Footer with Real User Actions */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-6 px-4 sm:px-8 mt-12">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-semibold text-slate-800 dark:text-slate-200">
              CineVault Local
            </span>
            <span aria-hidden="true">·</span>
            <span>Personal Local Media Streaming</span>
            {capabilities && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {capabilities.totalFilesScanned} local video files indexed
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowControlsHelp(true)}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Keyboard & TV Remote Guide
            </button>
            <button
              type="button"
              onClick={() => setShowLibrarySettings(true)}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Configure Media Folder
            </button>
          </div>
        </div>
      </footer>

      {/* Interactive Modals */}
      {seriesDetailItem && (
        <SeriesDetailModal
          item={seriesDetailItem}
          onClose={() => setSeriesDetailItem(null)}
          onPlayEpisode={(item, ep) => {
            setSeriesDetailItem(null);
            setActivePlayback({ item, episode: ep });
          }}
          onToggleEpisodeWatched={handleToggleWatched}
          tvMode={tvMode}
        />
      )}

      {editingItem && (
        <EditMetadataModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={handleSaveMetadata}
        />
      )}

      {showLibrarySettings && capabilities && (
        <LibrarySettingsModal
          capabilities={capabilities}
          onClose={() => setShowLibrarySettings(false)}
          onApplyRootPath={handleApplyRootPath}
        />
      )}

      {showControlsHelp && <ControlsHelpModal onClose={() => setShowControlsHelp(false)} />}

      {activePlayback && (
        <VideoPlayerModal
          item={activePlayback.item}
          episode={activePlayback.episode}
          ffmpegAvailable={Boolean(capabilities?.ffmpegAvailable)}
          onClose={() => setActivePlayback(null)}
          onSelectEpisode={(nextEp) =>
            setActivePlayback((prev) => (prev ? { item: prev.item, episode: nextEp } : null))
          }
          onSaveProgress={handleSaveProgress}
        />
      )}
    </div>
  );
}
