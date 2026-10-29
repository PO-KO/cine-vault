'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  FolderOpen,
  Film,
  RotateCcw,
  AlertTriangle,
  Wifi,
  Lock,
  History,
  CheckCircle2,
} from 'lucide-react';
import {
  ExternalMetadataMatch,
  LanNetworkInfo,
  LibraryResponse,
  MediaCategory,
  MediaEpisode,
  MediaItem,
  SortOption,
  SystemCapabilities,
  UserPreferences,
  ViewLayout,
  WatchedFilter,
  WatchHistoryEntry,
  WatchingStatus,
} from './types/media';
import { NavTab, TopNav } from './components/TopNav';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { HeroSpotlight } from './components/HeroSpotlight';
import { MediaCard } from './components/MediaCard';
import { SeriesDetailModal } from './components/SeriesDetailModal';
import { EditMetadataModal } from './components/EditMetadataModal';
import { LibrarySettingsModal, SettingsTab } from './components/LibrarySettingsModal';
import { ControlsHelpModal } from './components/ControlsHelpModal';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { formatRemainingTime, formatTimecode } from './utils/formatters';
import {
  buildLibraryFromDataTransfer,
  buildLibraryFromDirectoryHandle,
  buildLibraryFromPickedFiles,
  buildLibraryFromScannedEntries,
} from './utils/clientFolderScanner';
import {
  checkDirectoryHandlePermission,
  loadClientSnapshotFromIdb,
  loadDirectoryHandleFromIdb,
  loadPreferencesFromLocalStorage,
  rebindFilesFromDirectoryHandle,
  saveClientSnapshotToIdb,
  saveDirectoryHandleToIdb,
  savePreferencesToLocalStorage,
} from './utils/clientPersistence';

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const [networkInfo, setNetworkInfo] = useState<LanNetworkInfo | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [usingClientPickedFolder, setUsingClientPickedFolder] = useState<boolean>(false);
  const [clientFolderNeedsPermission, setClientFolderNeedsPermission] = useState<boolean>(false);
  const [isWindowDragging, setIsWindowDragging] = useState<boolean>(false);

  // LAN PIN Unlock State for remote Wi-Fi clients
  const [lanPinInput, setLanPinInput] = useState<string>('');
  const [lanPinError, setLanPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState<boolean>(false);

  // Navigation, Sorting, Layout & Filtering State
  const [activeTab, setActiveTab] = useState<NavTab>('all');
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('lastWatched');
  const [viewLayout, setViewLayout] = useState<ViewLayout>('grid');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Theme & Device Mode State
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [tvMode, setTvMode] = useState<boolean>(false);

  // Active Modals State
  const [activePlayback, setActivePlayback] = useState<{
    item: MediaItem;
    episode: MediaEpisode;
  } | null>(null);
  const [seriesDetailItem, setSeriesDetailItem] = useState<MediaItem | null>(null);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [showLibrarySettings, setShowLibrarySettings] = useState<boolean>(false);
  const [settingsModalTab, setSettingsModalTab] = useState<SettingsTab>('folders');
  const [showControlsHelp, setShowControlsHelp] = useState<boolean>(false);

  const prefsInitializedRef = useRef<boolean>(false);
  const activeClientFolderNameRef = useRef<string>('Selected Folder');

  // Helper to persist user preferences to both localStorage and SQLite
  const updatePersistedPreferences = useCallback((updates: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = prev ? { ...prev, ...updates } : (updates as UserPreferences);
      return next;
    });
    savePreferencesToLocalStorage(updates);
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {});
  }, []);

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

  // Reconnect a stored FileSystemDirectoryHandle (either silently on F5 reload or via 1-click prompt after browser restart)
  const handleReconnectClientFolder = useCallback(
    async (requestPrompt = true): Promise<boolean> => {
      const dirHandle = await loadDirectoryHandleFromIdb();
      if (!dirHandle) {
        return false;
      }
      const perm = await checkDirectoryHandlePermission(dirHandle, requestPrompt);
      if (perm !== 'granted') {
        setClientFolderNeedsPermission(true);
        return false;
      }

      setClientFolderNeedsPermission(false);
      setItems((prevItems) => {
        // Trigger async rebind and update state once resolved
        rebindFilesFromDirectoryHandle(dirHandle, prevItems).then(({ items: reboundItems, boundCount }) => {
          if (boundCount > 0) {
            setItems(reboundItems);
          }
        });
        return prevItems;
      });
      return true;
    },
    []
  );

  // Fetch Library + Persisted State from Server & Browser IndexedDB
  const fetchLibrary = useCallback(async () => {
    try {
      setError(null);
      const [res, idbSnapshot, idbDirHandle] = await Promise.all([
        fetch('/api/library'),
        loadClientSnapshotFromIdb(),
        loadDirectoryHandleFromIdb(),
      ]);

      if (!res.ok) {
        throw new Error('Failed to load local media library from server.');
      }
      const data: LibraryResponse = await res.json();

      const localPrefs = loadPreferencesFromLocalStorage();
      const mergedPrefs: UserPreferences | undefined = data.preferences
        ? { ...data.preferences, ...localPrefs }
        : undefined;

      if (mergedPrefs && !prefsInitializedRef.current) {
        prefsInitializedRef.current = true;
        setPreferences(mergedPrefs);
        if (mergedPrefs.activeTab) setActiveTab(mergedPrefs.activeTab as NavTab);
        if (mergedPrefs.watchedFilter) setWatchedFilter(mergedPrefs.watchedFilter);
        if (mergedPrefs.sortBy) setSortBy(mergedPrefs.sortBy);
        if (mergedPrefs.viewLayout) setViewLayout(mergedPrefs.viewLayout);
        if (typeof mergedPrefs.darkMode === 'boolean') setDarkMode(mergedPrefs.darkMode);
        if (typeof mergedPrefs.tvMode === 'boolean') setTvMode(mergedPrefs.tvMode);
      } else if (data.preferences) {
        setPreferences(data.preferences);
      }

      if (data.watchHistory) {
        setWatchHistory(data.watchHistory);
      }
      if (data.networkInfo) {
        setNetworkInfo(data.networkInfo);
      }

      // Check if the user's active library mode is a client-picked folder (persisted in SQLite or IndexedDB)
      const effectiveClientSnapshot = data.clientSnapshot || idbSnapshot;
      const shouldRestoreClientFolder =
        (mergedPrefs?.activeSourceMode === 'client' || data.preferences?.activeSourceMode === 'client') &&
        effectiveClientSnapshot &&
        effectiveClientSnapshot.items.length > 0;

      if (shouldRestoreClientFolder && effectiveClientSnapshot) {
        let restoredItems = effectiveClientSnapshot.items;
        activeClientFolderNameRef.current = effectiveClientSnapshot.rootFolderName;

        // If we have a FileSystemDirectoryHandle in IndexedDB, check if permission is already granted (e.g. after F5 reload!)
        if (idbDirHandle) {
          const perm = await checkDirectoryHandlePermission(idbDirHandle, false);
          if (perm === 'granted') {
            const { items: rebound, boundCount } = await rebindFilesFromDirectoryHandle(
              idbDirHandle,
              restoredItems
            );
            if (boundCount > 0) {
              restoredItems = rebound;
            }
            setClientFolderNeedsPermission(false);
          } else {
            setClientFolderNeedsPermission(true);
          }
        } else {
          setClientFolderNeedsPermission(true);
        }

        setItems(restoredItems);
        setUsingClientPickedFolder(true);
        setCapabilities({
          ...data.capabilities,
          rootPath: `${effectiveClientSnapshot.rootFolderName} (Picked from Local PC)`,
          totalFilesScanned: effectiveClientSnapshot.totalVideoFiles,
        });
      } else {
        setItems(data.items);
        setCapabilities(data.capabilities);
        setUsingClientPickedFolder(false);
        setClientFolderNeedsPermission(false);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Persist client-picked catalog to both IndexedDB and SQLite and merge any existing watch progress
  const persistAndApplyClientCatalog = useCallback(
    async (
      rootFolderName: string,
      pickedItems: MediaItem[],
      totalVideoFiles: number,
      mergeWithExisting = false
    ) => {
      if (pickedItems.length === 0) return;

      setError(null);
      activeClientFolderNameRef.current = rootFolderName;

      // Build live File map so we can re-attach File/BlobUrls after server merges progress & overrides
      const liveFileMap = new Map<string, { clientFile?: File; clientBlobUrl?: string }>();
      for (const item of pickedItems) {
        for (const ep of item.episodes) {
          if (ep.clientFile || ep.clientBlobUrl) {
            liveFileMap.set(ep.id, {
              clientFile: ep.clientFile,
              clientBlobUrl: ep.clientBlobUrl,
            });
          }
        }
      }

      let finalItems = pickedItems;
      if (mergeWithExisting) {
        const prevClientItems = items.filter((i) => i.isClientPickedFolder);
        if (prevClientItems.length > 0) {
          const mergedMap = new Map<string, MediaItem>();
          for (const existing of prevClientItems) {
            mergedMap.set(existing.folderName.toLowerCase(), existing);
          }
          for (const incoming of pickedItems) {
            const key = incoming.folderName.toLowerCase();
            const existing = mergedMap.get(key);
            if (existing) {
              const combinedSeasons = Array.from(
                new Set([...(existing.seasons || []), ...(incoming.seasons || [])])
              ).sort((a, b) => a - b);
              const existingEpIds = new Set(existing.episodes.map((e) => e.id));
              const combinedEpisodes = [
                ...existing.episodes,
                ...incoming.episodes.filter((e) => !existingEpIds.has(e.id)),
              ];
              mergedMap.set(key, {
                ...existing,
                ...incoming,
                episodes: combinedEpisodes,
                seasons: combinedSeasons,
                totalEpisodes: combinedEpisodes.length,
              });
            } else {
              mergedMap.set(key, incoming);
            }
          }
          finalItems = Array.from(mergedMap.values());
        }
      }

      // Save snapshot to SQLite on server and receive hydrated progress/metadata overrides
      try {
        const res = await fetch('/api/library/client-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rootFolderName,
            items: finalItems,
            totalVideoFiles,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.clientSnapshot?.items) {
            // Re-attach live File objects to hydrated items
            finalItems = (data.clientSnapshot.items as MediaItem[]).map((item) => ({
              ...item,
              episodes: item.episodes.map((ep) => {
                const live = liveFileMap.get(ep.id);
                return live ? { ...ep, ...live } : ep;
              }),
            }));
          }
          if (data.watchHistory) setWatchHistory(data.watchHistory);
          if (data.preferences) setPreferences(data.preferences);
        }
      } catch {}

      await saveClientSnapshotToIdb({
        rootFolderName,
        items: finalItems,
        totalVideoFiles,
      });
      savePreferencesToLocalStorage({ activeSourceMode: 'client' });

      setItems(finalItems);
      setUsingClientPickedFolder(true);
      setClientFolderNeedsPermission(false);
      setCapabilities((prev) =>
        prev
          ? {
              ...prev,
              rootPath: `${rootFolderName} (Picked from Local PC)`,
              totalFilesScanned: totalVideoFiles,
              lastScannedAt: new Date().toISOString(),
            }
          : null
      );
    },
    [items]
  );

  // Pick a local folder directly from the user's PC via <input type="file" webkitdirectory>
  const handlePickClientFolderFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setIsScanning(true);
      try {
        const { rootFolderName, items: pickedItems, totalVideoFiles } =
          await buildLibraryFromPickedFiles(fileList);
        await persistAndApplyClientCatalog(rootFolderName, pickedItems, totalVideoFiles);
      } finally {
        setIsScanning(false);
      }
    },
    [persistAndApplyClientCatalog]
  );

  // Pick a local folder via File System Access API (window.showDirectoryPicker) - persists handle in IndexedDB!
  const handlePickDirectoryHandle = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (dirHandle: any) => {
      setIsScanning(true);
      try {
        await saveDirectoryHandleToIdb(dirHandle);
        const { rootFolderName, items: pickedItems, totalVideoFiles } =
          await buildLibraryFromDirectoryHandle(dirHandle);
        await persistAndApplyClientCatalog(rootFolderName, pickedItems, totalVideoFiles);
      } finally {
        setIsScanning(false);
      }
    },
    [persistAndApplyClientCatalog]
  );

  // Drop a folder from Windows Explorer / macOS Finder
  const handleDropFolderDataTransfer = useCallback(
    async (dataTransfer: DataTransfer) => {
      setIsScanning(true);
      try {
        const res = await buildLibraryFromDataTransfer(dataTransfer);
        if (res && res.items.length > 0) {
          await persistAndApplyClientCatalog(res.rootFolderName, res.items, res.totalVideoFiles);
        }
      } finally {
        setIsScanning(false);
      }
    },
    [persistAndApplyClientCatalog]
  );

  // Add an empty media folder or empty season folder by name
  const handleAddEmptyFolderName = useCallback(
    async (folderPathInput: string) => {
      const cleaned = folderPathInput.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
      if (!cleaned) return;
      setIsScanning(true);
      try {
        const rootFolderName = activeClientFolderNameRef.current || 'media';
        const res = await buildLibraryFromScannedEntries({
          files: [],
          directories: [`${rootFolderName}/${cleaned}`],
          rootFolderName,
        });
        await persistAndApplyClientCatalog(rootFolderName, res.items, res.totalVideoFiles, true);
      } finally {
        setIsScanning(false);
      }
    },
    [persistAndApplyClientCatalog]
  );

  // Handlers for server folder mutations
  const handleRescan = async () => {
    if (usingClientPickedFolder) {
      const dirHandle = await loadDirectoryHandleFromIdb();
      if (dirHandle) {
        const perm = await checkDirectoryHandlePermission(dirHandle, true);
        if (perm === 'granted') {
          await handlePickDirectoryHandle(dirHandle);
          return;
        }
      }
    }

    setIsScanning(true);
    try {
      const res = await fetch('/api/library/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setActiveSourceMode: 'server' }),
      });
      if (res.ok) {
        const data: LibraryResponse = await res.json();
        setItems(data.items);
        setCapabilities(data.capabilities);
        if (data.preferences) setPreferences(data.preferences);
        if (data.watchHistory) setWatchHistory(data.watchHistory);
        setUsingClientPickedFolder(false);
        setClientFolderNeedsPermission(false);
        savePreferencesToLocalStorage({ activeSourceMode: 'server' });
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleApplyRootPath = async (newPath: string) => {
    const res = await fetch('/api/library/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: newPath, setActiveSourceMode: 'server' }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Could not scan folder path.');
    }
    const data: LibraryResponse = await res.json();
    setItems(data.items);
    setCapabilities(data.capabilities);
    if (data.preferences) setPreferences(data.preferences);
    if (data.watchHistory) setWatchHistory(data.watchHistory);
    setUsingClientPickedFolder(false);
    setClientFolderNeedsPermission(false);
    savePreferencesToLocalStorage({ activeSourceMode: 'server' });
  };

  const handleAddServerFolder = async (folderPath: string) => {
    const res = await fetch('/api/library/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addFolderPath: folderPath, setActiveSourceMode: 'server' }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Could not add server folder path.');
    }
    const data: LibraryResponse = await res.json();
    setItems(data.items);
    setCapabilities(data.capabilities);
    setUsingClientPickedFolder(false);
    savePreferencesToLocalStorage({ activeSourceMode: 'server' });
  };

  const handleRemoveServerFolder = async (folderPath: string) => {
    const res = await fetch('/api/library/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeFolderPath: folderPath }),
    });
    if (res.ok) {
      const data: LibraryResponse = await res.json();
      if (!usingClientPickedFolder) {
        setItems(data.items);
      }
      setCapabilities(data.capabilities);
    }
  };

  const handleToggleFavorite = async (item: MediaItem) => {
    const nextFav = !item.isFavorite;

    // Optimistic update + IndexedDB sync
    setItems((prev) => {
      const updated = prev.map((m) => (m.id === item.id ? { ...m, isFavorite: nextFav } : m));
      if (usingClientPickedFolder) {
        saveClientSnapshotToIdb({
          rootFolderName: activeClientFolderNameRef.current,
          items: updated,
          totalVideoFiles: capabilities?.totalFilesScanned || updated.length,
        });
      }
      return updated;
    });

    // Always persist to SQLite on server too
    const res = await fetch(`/api/media/${item.id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: nextFav }),
    });
    if (res.ok && !usingClientPickedFolder) {
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
      externalMatch?: ExternalMetadataMatch;
    }
  ) => {
    setItems((prev) => {
      const next = prev.map((m) => {
        if (m.id !== id) return m;
        const match = updates.externalMatch;
        const nextPoster = updates.customPosterUrl || match?.posterUrl || m.posterUrl;
        return {
          ...m,
          title: updates.title || match?.title || m.title,
          category: updates.category,
          isManualCategory: true,
          synopsis: updates.synopsis || match?.synopsis || m.synopsis,
          posterUrl: nextPoster,
          bannerUrl: match?.bannerUrl || nextPoster || m.bannerUrl,
          customPosterUrl: updates.customPosterUrl,
          releaseYear: match?.releaseYear || m.releaseYear,
          genres: match?.genres?.length ? match.genres : m.genres,
          ratingScore: match?.ratingScore ?? m.ratingScore,
          studioOrNetwork: match?.studioOrNetwork || m.studioOrNetwork,
          metadataProvider: match?.provider || m.metadataProvider,
          externalId: match?.externalId || m.externalId,
        };
      });
      if (usingClientPickedFolder) {
        saveClientSnapshotToIdb({
          rootFolderName: activeClientFolderNameRef.current,
          items: next,
          totalVideoFiles: capabilities?.totalFilesScanned || next.length,
        });
      }
      return next;
    });

    const res = await fetch(`/api/media/${id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok && !usingClientPickedFolder) {
      const data = await res.json();
      setItems(data.items);
    }
  };

  const handleSaveProgress = useCallback(
    async (episodeId: string, currentTime: number, duration: number, completed?: boolean) => {
      const threshold = preferences?.completionThreshold || 0.9;
      let matchedItem: MediaItem | undefined;
      let matchedEp: MediaEpisode | undefined;

      setItems((prev) => {
        const nextItems = prev.map((m) => {
          const epTarget = m.episodes.find((e) => e.id === episodeId);
          if (!epTarget) return m;
          matchedItem = m;
          matchedEp = epTarget;

          const nowIso = new Date().toISOString();
          const updatedEpisodes = m.episodes.map((ep) => {
            if (ep.id !== episodeId) return ep;
            const fallbackDur =
              Number.isFinite(ep.progress.duration) && ep.progress.duration > 0
                ? ep.progress.duration
                : ep.estimatedDurationSec || 1440;
            const nextDur =
              Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : fallbackDur;
            const nextTime =
              Number.isFinite(currentTime) && currentTime >= 0 ? Math.floor(currentTime) : 0;
            const isDone =
              typeof completed === 'boolean'
                ? completed
                : nextDur > 0 && nextTime / nextDur >= threshold;
            const status: WatchingStatus = isDone
              ? 'Completed'
              : nextTime > 0
              ? 'Watching'
              : 'Unwatched';
            return {
              ...ep,
              progress: {
                currentTime: isDone && completed ? 0 : nextTime,
                duration: nextDur,
                completed: isDone,
                status,
                updatedAt: nowIso,
                lastWatched: nowIso,
              },
            };
          });

          const watchedEpisodes = updatedEpisodes.filter((e) => e.progress.completed).length;
          const inProgressEpisode = updatedEpisodes
            .filter((e) => e.progress.currentTime > 0 && !e.progress.completed)
            .sort((a, b) =>
              (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || '')
            )[0];
          const watchingStatus: WatchingStatus =
            updatedEpisodes.length > 0 && watchedEpisodes === updatedEpisodes.length
              ? 'Completed'
              : watchedEpisodes > 0 || Boolean(inProgressEpisode)
              ? 'Watching'
              : 'Unwatched';

          return {
            ...m,
            episodes: updatedEpisodes,
            watchedEpisodes,
            inProgressEpisode,
            watchingStatus,
            lastWatchedAt: nowIso,
          };
        });

        if (usingClientPickedFolder) {
          saveClientSnapshotToIdb({
            rootFolderName: activeClientFolderNameRef.current,
            items: nextItems,
            totalVideoFiles: capabilities?.totalFilesScanned || nextItems.length,
          });
        }
        return nextItems;
      });

      // Always persist progress & watch history to SQLite on the Host PC
      try {
        const res = await fetch(`/api/episodes/${episodeId}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentTime,
            duration,
            completed,
            mediaId: matchedItem?.id,
            mediaTitle: matchedItem?.title,
            episodeTitle: matchedEp?.title,
            seasonNumber: matchedEp?.seasonNumber,
            episodeNumber: matchedEp?.episodeNumber,
            posterUrl: matchedItem?.posterUrl,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.watchHistory) {
            setWatchHistory(data.watchHistory);
          }
        }
      } catch {}
    },
    [capabilities?.totalFilesScanned, preferences?.completionThreshold, usingClientPickedFolder]
  );

  const handleToggleWatched = async (episode: MediaEpisode, completed: boolean) => {
    await handleSaveProgress(
      episode.id,
      completed ? 0 : episode.progress.currentTime,
      episode.progress.duration || episode.estimatedDurationSec,
      completed
    );
  };

  const handleConfigureLanPin = async (enabled: boolean, pin: string) => {
    const res = await fetch('/api/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'configure-pin', enabled, pin }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to configure LAN PIN.');
    }
    const data = await res.json();
    if (data.networkInfo) setNetworkInfo(data.networkInfo);
  };

  const handleVerifyLanPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLanPinError(null);
    setVerifyingPin(true);
    try {
      const res = await fetch('/api/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-pin', pin: lanPinInput }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLanPinError(err.error || 'Invalid PIN.');
        return;
      }
      const data = await res.json();
      if (data.networkInfo) {
        setNetworkInfo(data.networkInfo);
      }
      setLanPinInput('');
      await fetchLibrary();
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleClearWatchHistory = async () => {
    const res = await fetch('/api/preferences', { method: 'DELETE' });
    if (res.ok) {
      setWatchHistory([]);
    }
  };

  const handleResumeHistoryEntry = (entry: WatchHistoryEntry) => {
    for (const item of items) {
      const ep = item.episodes.find((e) => e.id === entry.episodeId);
      if (ep) {
        setActivePlayback({ item, episode: ep });
        return;
      }
    }
  };

  // Start playback of an episode (auto-reconnecting stored FileSystemDirectoryHandle if needed)
  const startEpisodePlayback = useCallback(
    async (item: MediaItem, episode: MediaEpisode) => {
      if (
        item.isClientPickedFolder &&
        !episode.isSampleSynthetic &&
        !episode.clientFile &&
        !episode.clientBlobUrl
      ) {
        const dirHandle = await loadDirectoryHandleFromIdb();
        if (dirHandle) {
          const perm = await checkDirectoryHandlePermission(dirHandle, true);
          if (perm === 'granted') {
            setClientFolderNeedsPermission(false);
            const { items: reboundItems, boundCount } = await rebindFilesFromDirectoryHandle(
              dirHandle,
              items
            );
            if (boundCount > 0) {
              setItems(reboundItems);
              const updatedItem = reboundItems.find((i) => i.id === item.id) || item;
              const updatedEp =
                updatedItem.episodes.find((e) => e.id === episode.id) || episode;
              setActivePlayback({ item: updatedItem, episode: updatedEp });
              return;
            }
          }
        }
      }
      setActivePlayback({ item, episode });
    },
    [items]
  );

  // Unavailable server folders check
  const unavailableServerFolders = useMemo(
    () => (capabilities?.configuredFolders || []).filter((f) => !f.available),
    [capabilities?.configuredFolders]
  );

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

  // Featured Spotlight Item
  const spotlightEntry = useMemo(() => {
    if (continueWatchingList.length > 0) {
      return continueWatchingList[0];
    }
    const firstWithEp = items.find((i) => i.episodes.length > 0);
    if (firstWithEp) {
      return { item: firstWithEp, episode: firstWithEp.episodes[0] };
    }
    const first = items[0];
    if (first) {
      return { item: first, episode: first.episodes[0] };
    }
    return null;
  }, [continueWatchingList, items]);

  // Filtered & Sorted Library Items
  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (activeTab === 'watchlist' && !item.isFavorite) return false;
      if (activeTab !== 'all' && activeTab !== 'watchlist' && item.category !== activeTab) {
        return false;
      }

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

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesFolder = item.relativePath.toLowerCase().includes(q);
        const matchesGenre = item.genres?.some((g) => g.toLowerCase().includes(q));
        const matchesEpisode = item.episodes.some(
          (ep) =>
            ep.title.toLowerCase().includes(q) ||
            ep.fileName.toLowerCase().includes(q) ||
            ep.containerFormat.toLowerCase().includes(q)
        );
        if (!matchesTitle && !matchesFolder && !matchesGenre && !matchesEpisode) return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'year') {
        return (b.releaseYear || '').localeCompare(a.releaseYear || '');
      }
      if (sortBy === 'rating') {
        return (b.ratingScore || 0) - (a.ratingScore || 0);
      }
      // Default: 'lastWatched' (recently watched first, then alphabetical)
      const aLast = a.lastWatchedAt || a.inProgressEpisode?.progress.updatedAt || '';
      const bLast = b.lastWatchedAt || b.inProgressEpisode?.progress.updatedAt || '';
      if (aLast !== bLast) {
        return bLast.localeCompare(aLast);
      }
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [items, activeTab, watchedFilter, searchQuery, sortBy]);

  // If LAN PIN protection is enabled and this remote Wi-Fi client is not yet unlocked, show PIN screen
  if (networkInfo && networkInfo.pinProtectionEnabled && !networkInfo.isAuthorizedClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6">
        <form
          onSubmit={handleVerifyLanPin}
          className="w-full max-w-md p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-5 shadow-2xl text-center"
        >
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6 text-rose-500" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display font-bold text-xl">CineVault Local Network Access</h1>
            <p className="text-xs text-slate-400">
              Enter the LAN PIN configured on the Host PC (<span className="font-mono">{networkInfo.hostname}</span>) to browse and stream videos on this device.
            </p>
          </div>

          <input
            type="password"
            value={lanPinInput}
            onChange={(e) => setLanPinInput(e.target.value)}
            placeholder="Enter LAN PIN"
            autoFocus
            className="w-full px-4 py-3 text-center text-lg font-mono tracking-widest rounded-xl bg-slate-950 border border-slate-800 text-white focus:border-rose-500"
            required
          />

          {lanPinError && <p className="text-xs text-red-400">{lanPinError}</p>}

          <button
            type="submit"
            disabled={verifyingPin}
            className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer transition-colors"
          >
            {verifyingPin ? 'Verifying...' : 'Unlock Media Library'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      id="top"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setIsWindowDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsWindowDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsWindowDragging(false);
        if (e.dataTransfer) {
          await handleDropFolderDataTransfer(e.dataTransfer);
        }
      }}
      className={`min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors ${
        tvMode ? 'tv-mode' : ''
      }`}
    >
      {isWindowDragging && (
        <div className="fixed inset-4 z-50 pointer-events-none rounded-3xl border-4 border-dashed border-rose-500 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-8 text-center text-white shadow-2xl">
          <FolderOpen className="w-14 h-14 text-rose-500 mb-3" />
          <p className="font-display font-bold text-2xl">Drop Media Folder Here</p>
          <p className="text-sm text-slate-300 mt-1 max-w-md">
            Scans all anime, movies, and series folders — including empty media folders and empty Season folders — and persists your library across reloads.
          </p>
        </div>
      )}

      {/* 1. Strictly Compliant 3-Zone Top Bar */}
      <TopNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          updatePersistedPreferences({ activeTab: tab });
        }}
        onOpenLibrarySettings={() => {
          setSettingsModalTab('folders');
          setShowLibrarySettings(true);
        }}
        tvMode={tvMode}
      />

      {/* 2. Workspace Toolbar (Search, Filters, Sort, Layout, Pick PC Folder, LAN & History) */}
      <WorkspaceToolbar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          updatePersistedPreferences({ activeTab: tab });
        }}
        watchedFilter={watchedFilter}
        onSelectWatchedFilter={(filter) => {
          setWatchedFilter(filter);
          updatePersistedPreferences({ watchedFilter: filter });
        }}
        sortBy={sortBy}
        onSelectSortBy={(sort) => {
          setSortBy(sort);
          updatePersistedPreferences({ sortBy: sort });
        }}
        viewLayout={viewLayout}
        onSelectViewLayout={(layout) => {
          setViewLayout(layout);
          updatePersistedPreferences({ viewLayout: layout });
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        darkMode={darkMode}
        onToggleDarkMode={() => {
          setDarkMode((d) => {
            const next = !d;
            updatePersistedPreferences({ darkMode: next });
            return next;
          });
        }}
        tvMode={tvMode}
        onToggleTvMode={() => {
          setTvMode((t) => {
            const next = !t;
            updatePersistedPreferences({ tvMode: next });
            return next;
          });
        }}
        onRescan={handleRescan}
        onPickClientFolderFiles={handlePickClientFolderFiles}
        onPickDirectoryHandle={handlePickDirectoryHandle}
        isScanning={isScanning}
        onOpenShortcutsHelp={() => setShowControlsHelp(true)}
        onOpenLanModal={() => {
          setSettingsModalTab('lan');
          setShowLibrarySettings(true);
        }}
        onOpenHistoryModal={() => {
          setSettingsModalTab('history');
          setShowLibrarySettings(true);
        }}
        totalItemsCount={items.length}
        filteredItemsCount={filteredItems.length}
      />

      {/* 3. Main Content Viewport (1440px Baseline) */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
        {/* Folder Availability / Reconnect Banner */}
        {(usingClientPickedFolder && clientFolderNeedsPermission) ||
        unavailableServerFolders.length > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs">
            <div className="flex items-start sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 sm:mt-0" />
              <div className="space-y-0.5">
                {usingClientPickedFolder && clientFolderNeedsPermission ? (
                  <>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Saved Local Folder Restored: {capabilities?.rootPath}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      Your library catalog, posters, and watching progress were restored. To stream local video files after a browser restart, click <strong>Reconnect Folder</strong> or re-select your folder.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Configured Media Folder Unavailable ({unavailableServerFolders[0]?.path})
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      The drive or folder could not be reached. Your watching progress and history remain safely preserved.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {usingClientPickedFolder && clientFolderNeedsPermission && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleReconnectClientFolder(true);
                    if (!ok) {
                      setSettingsModalTab('folders');
                      setShowLibrarySettings(true);
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold cursor-pointer"
                >
                  Reconnect Folder
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSettingsModalTab('folders');
                  setShowLibrarySettings(true);
                }}
                className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-medium cursor-pointer"
              >
                Update Location
              </button>
            </div>
          </div>
        ) : null}

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
              Unable to Read Media Folder
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">{error}</p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={fetchLibrary}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg cursor-pointer"
              >
                Retry Loading Library
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsModalTab('folders');
                  setShowLibrarySettings(true);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              >
                Pick Another Folder
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Hero Spotlight Section */}
            {activeTab === 'all' && watchedFilter === 'all' && !searchQuery && spotlightEntry && (
              <HeroSpotlight
                item={spotlightEntry.item}
                targetEpisode={spotlightEntry.episode}
                onPlayEpisode={(item, ep) => startEpisodePlayback(item, ep)}
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
                      {continueWatchingList.length} in progress · Auto-completes at{' '}
                      {Math.round((preferences?.completionThreshold || 0.9) * 100)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {continueWatchingList.map(({ item, episode }) => {
                      const pct =
                        episode.progress.duration > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (episode.progress.currentTime / episode.progress.duration) * 100
                              )
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
                            onClick={() => startEpisodePlayback(item, episode)}
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

            {/* Main Media Library Grid / Compact Section */}
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
                    ? 'Anime Collection (AniList)'
                    : activeTab === 'tv'
                    ? 'TV Shows (TMDB)'
                    : activeTab === 'movies'
                    ? 'Movies & Films (TMDB)'
                    : activeTab === 'other'
                    ? 'Other Videos'
                    : 'Personal Watchlist'}
                </h2>

                {capabilities && (
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsModalTab('folders');
                      setShowLibrarySettings(true);
                    }}
                    title="Saved & persisted"
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-mono truncate max-w-md cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                    <span className="truncate">{capabilities.rootPath}</span>
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  </button>
                )}
              </div>

              {filteredItems.length > 0 ? (
                <div
                  className={
                    viewLayout === 'compact'
                      ? 'flex flex-col gap-3'
                      : `grid gap-5 ${
                          tvMode
                            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                            : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                        }`
                  }
                >
                  {filteredItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      viewLayout={viewLayout}
                      onPlay={(media, ep) => {
                        const targetEp = ep || media.inProgressEpisode || media.episodes[0];
                        if (targetEp) {
                          startEpisodePlayback(media, targetEp);
                        } else {
                          setSeriesDetailItem(media);
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
                    No movies, anime, or series match your current category or filter selection. Try clearing your filters or picking another local folder on your PC.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('all');
                        setWatchedFilter('all');
                        setSearchQuery('');
                        updatePersistedPreferences({ activeTab: 'all', watchedFilter: 'all' });
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Filters</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsModalTab('folders');
                        setShowLibrarySettings(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Pick Local Folder</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* 4. Quiet Footer with Real User Actions & LAN Status */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-6 px-4 sm:px-8 mt-12">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-semibold text-slate-800 dark:text-slate-200">
              CineVault Local
            </span>
            <span aria-hidden="true">·</span>
            <span>SQLite + IndexedDB Persistent State</span>
            {networkInfo?.lanUrls?.[0] && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsModalTab('lan');
                    setShowLibrarySettings(true);
                  }}
                  className="inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  <Wifi className="w-3 h-3" />
                  <span>LAN: {networkInfo.lanUrls[0]}</span>
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setSettingsModalTab('history');
                setShowLibrarySettings(true);
              }}
              className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>Watch History ({watchHistory.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setShowControlsHelp(true)}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Keyboard &amp; TV Remote Guide
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsModalTab('folders');
                setShowLibrarySettings(true);
              }}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Folders &amp; LAN Setup
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
            startEpisodePlayback(item, ep);
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
          initialTab={settingsModalTab}
          networkInfo={networkInfo}
          watchHistory={watchHistory}
          preferences={preferences}
          usingClientPickedFolder={usingClientPickedFolder}
          clientFolderNeedsPermission={clientFolderNeedsPermission}
          onReconnectClientFolder={() => handleReconnectClientFolder(true)}
          onClose={() => setShowLibrarySettings(false)}
          onApplyRootPath={handleApplyRootPath}
          onAddServerFolder={handleAddServerFolder}
          onRemoveServerFolder={handleRemoveServerFolder}
          onPickClientFolderFiles={handlePickClientFolderFiles}
          onPickDirectoryHandle={handlePickDirectoryHandle}
          onDropFolderDataTransfer={handleDropFolderDataTransfer}
          onAddEmptyFolderName={handleAddEmptyFolderName}
          onConfigureLanPin={handleConfigureLanPin}
          onClearWatchHistory={handleClearWatchHistory}
          onResumeHistoryEntry={handleResumeHistoryEntry}
          onUpdatePreferences={async (updates) => updatePersistedPreferences(updates)}
        />
      )}

      {showControlsHelp && <ControlsHelpModal onClose={() => setShowControlsHelp(false)} />}

      {activePlayback && (
        <VideoPlayerModal
          item={activePlayback.item}
          episode={activePlayback.episode}
          ffmpegAvailable={Boolean(capabilities?.ffmpegAvailable)}
          initialVolume={
            typeof preferences?.playbackVolume === 'number' &&
            Number.isFinite(preferences.playbackVolume)
              ? preferences.playbackVolume
              : 0.8
          }
          initialMuted={Boolean(preferences?.playbackMuted)}
          initialPlaybackRate={
            typeof preferences?.playbackRate === 'number' &&
            Number.isFinite(preferences.playbackRate) &&
            preferences.playbackRate > 0
              ? preferences.playbackRate
              : 1
          }
          onUpdatePlaybackPreferences={(prefs) => updatePersistedPreferences(prefs)}
          onReconnectClientFolder={() => handleReconnectClientFolder(true)}
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
