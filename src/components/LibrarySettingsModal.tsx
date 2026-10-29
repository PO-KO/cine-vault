import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  ArrowUp,
  CheckCircle2,
  AlertTriangle,
  Monitor,
  Smartphone,
  Tv,
  HardDrive,
  Wifi,
  Shield,
  Lock,
  Copy,
  Check,
  History,
  Trash2,
  Play,
  Database,
} from 'lucide-react';
import {
  DirectoryBrowseResponse,
  LanNetworkInfo,
  SystemCapabilities,
  UserPreferences,
  WatchHistoryEntry,
} from '../types/media';
import { formatTimecode } from '../utils/formatters';

export type SettingsTab = 'folders' | 'lan' | 'history';

interface LibrarySettingsModalProps {
  capabilities: SystemCapabilities;
  initialTab?: SettingsTab;
  networkInfo?: LanNetworkInfo | null;
  watchHistory?: WatchHistoryEntry[];
  preferences?: UserPreferences | null;
  usingClientPickedFolder?: boolean;
  clientFolderNeedsPermission?: boolean;
  onReconnectClientFolder?: () => Promise<boolean>;
  onClose: () => void;
  onApplyRootPath: (newPath: string) => Promise<void>;
  onAddServerFolder?: (folderPath: string) => Promise<void>;
  onRemoveServerFolder?: (folderPath: string) => Promise<void>;
  onPickClientFolderFiles: (files: FileList | File[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPickDirectoryHandle?: (dirHandle: any) => Promise<void>;
  onDropFolderDataTransfer?: (dataTransfer: DataTransfer) => Promise<void>;
  onAddEmptyFolderName?: (folderPath: string) => Promise<void>;
  onConfigureLanPin?: (enabled: boolean, pin: string) => Promise<void>;
  onClearWatchHistory?: () => Promise<void>;
  onResumeHistoryEntry?: (entry: WatchHistoryEntry) => void;
  onUpdatePreferences?: (updates: Partial<UserPreferences>) => Promise<void>;
}

export const LibrarySettingsModal: React.FC<LibrarySettingsModalProps> = ({
  capabilities,
  initialTab = 'folders',
  networkInfo,
  watchHistory = [],
  preferences,
  usingClientPickedFolder = false,
  clientFolderNeedsPermission = false,
  onReconnectClientFolder,
  onClose,
  onApplyRootPath,
  onAddServerFolder,
  onRemoveServerFolder,
  onPickClientFolderFiles,
  onPickDirectoryHandle,
  onDropFolderDataTransfer,
  onAddEmptyFolderName,
  onConfigureLanPin,
  onClearWatchHistory,
  onResumeHistoryEntry,
  onUpdatePreferences,
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [pathInput, setPathInput] = useState(capabilities.rootPath.replace(/ \(Picked from Local PC\)$/, ''));
  const [additionalPathInput, setAdditionalPathInput] = useState('');
  const [emptyFolderInput, setEmptyFolderInput] = useState('');
  const [browsingData, setBrowsingData] = useState<DirectoryBrowseResponse | null>(null);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // LAN PIN state
  const [pinEnabled, setPinEnabled] = useState<boolean>(Boolean(networkInfo?.pinProtectionEnabled));
  const [pinInput, setPinInput] = useState<string>('');
  const [pinSaving, setPinSaving] = useState<boolean>(false);
  const [pinStatusMsg, setPinStatusMsg] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const loadDirectoryBrowser = async (targetPath: string) => {
    setLoadingDirs(true);
    try {
      const res = await fetch('/api/library/browse-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      if (res.ok) {
        const data: DirectoryBrowseResponse = await res.json();
        setBrowsingData(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDirs(false);
    }
  };

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    const cleanRoot = capabilities.rootPath.replace(/ \(Picked from Local PC\)$/, '');
    loadDirectoryBrowser(cleanRoot);
  }, [capabilities.rootPath]);

  useEffect(() => {
    setPinEnabled(Boolean(networkInfo?.pinProtectionEnabled));
  }, [networkInfo?.pinProtectionEnabled]);

  const handleChoosePcFolderClick = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (onPickDirectoryHandle && typeof win.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
        setScanning(true);
        try {
          await onPickDirectoryHandle(dirHandle);
          onClose();
        } finally {
          setScanning(false);
        }
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }
    folderInputRef.current?.click();
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setScanning(true);
    try {
      await onApplyRootPath(pathInput);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to scan specified folder path.');
    } finally {
      setScanning(false);
    }
  };

  const handleSavePinConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onConfigureLanPin) return;
    setPinStatusMsg(null);
    setPinSaving(true);
    try {
      await onConfigureLanPin(pinEnabled, pinInput);
      setPinStatusMsg(
        pinEnabled
          ? 'LAN PIN Protection enabled. Other devices on Wi-Fi/LAN will be prompted for this PIN.'
          : 'LAN PIN Protection disabled (Trusted Home Network mode).'
      );
      setPinInput('');
    } catch (err: unknown) {
      setPinStatusMsg(err instanceof Error ? err.message : 'Failed to update LAN PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  const firewallCmd =
    'New-NetFirewallRule -DisplayName "CineVault Local Media Server (TCP 3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2
              id="library-settings-title"
              className="font-display font-bold text-lg text-slate-900 dark:text-white"
            >
              Media Library, Persistence &amp; Local Network Server
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              SQLite + IndexedDB persistent library state, multi-device LAN streaming, and viewing history
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'folders'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>1. Media Folders &amp; Persistence</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('lan')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'lan'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>2. Local Network (LAN) Streaming &amp; Security</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>3. Watch History &amp; Playback ({watchHistory.length})</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'folders' && (
            <>
              {/* Configured Folders & Availability Status */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-500" />
                    <span className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                      Persisted Media Folders (SQLite + Browser IndexedDB)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                    Auto-restored on page refresh &amp; app restart
                  </span>
                </div>

                {usingClientPickedFolder && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                        <FolderOpen className="w-4 h-4 text-rose-500 shrink-0" />
                        <span>{capabilities.rootPath}</span>
                        {clientFolderNeedsPermission ? (
                          <span className="text-amber-500 font-mono text-[11px]">
                            · Permission Re-Grant Needed for Playback
                          </span>
                        ) : (
                          <span className="text-emerald-500 font-mono text-[11px]">
                            · Connected &amp; Persisted
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Catalog, posters, and watching progress are saved in SQLite &amp; IndexedDB.
                      </p>
                    </div>
                    {clientFolderNeedsPermission && onReconnectClientFolder && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onReconnectClientFolder();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer shrink-0"
                      >
                        Reconnect Folder Access
                      </button>
                    )}
                  </div>
                )}

                {capabilities.configuredFolders && capabilities.configuredFolders.length > 0 && (
                  <div className="space-y-2">
                    {capabilities.configuredFolders.map((folder, idx) => (
                      <div
                        key={folder.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 font-mono text-slate-900 dark:text-white truncate">
                            <HardDrive className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            <span className="truncate">{folder.path}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            {folder.available ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                ● Available ({folder.itemCount ?? folder.videoCount ?? 0} video files)
                              </span>
                            ) : (
                              <span className="text-red-500 font-medium">
                                ▲ Unavailable — Folder moved or drive disconnected
                              </span>
                            )}
                            <span>·</span>
                            <span>{idx === 0 ? 'Primary Server Folder' : 'Additional Server Folder'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!folder.available && (
                            <button
                              type="button"
                              onClick={() => setPathInput(folder.path)}
                              className="px-2.5 py-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 font-medium cursor-pointer"
                            >
                              Update Path
                            </button>
                          )}
                          {idx > 0 && onRemoveServerFolder && (
                            <button
                              type="button"
                              onClick={() => onRemoveServerFolder(folder.path)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-500 cursor-pointer"
                              title="Remove folder from library"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Option A: Native OS Folder Picker + Drag & Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(false);
                  if (onDropFolderDataTransfer && e.dataTransfer) {
                    setScanning(true);
                    try {
                      await onDropFolderDataTransfer(e.dataTransfer);
                      onClose();
                    } finally {
                      setScanning(false);
                    }
                  }
                }}
                className={`p-5 rounded-2xl border-2 border-dashed transition-colors space-y-4 ${
                  isDraggingOver
                    ? 'border-rose-500 bg-rose-500/15'
                    : 'border-rose-500/35 bg-rose-500/5'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-display font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                      <FolderPlus className="w-5 h-5 text-rose-500" />
                      <span>Pick or Drag &amp; Drop Media Folder from Your PC</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                      Click <strong>Choose Folder on My PC</strong> or <strong>drag and drop</strong> your media folder here. Your folder selection, AniList/TMDB posters, and watching status are saved automatically so you never have to re-select it on reload.
                    </p>
                  </div>

                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    onChange={async (e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        const filesCopy = Array.from(e.target.files);
                        e.target.value = '';
                        setScanning(true);
                        try {
                          await onPickClientFolderFiles(filesCopy);
                          onClose();
                        } finally {
                          setScanning(false);
                        }
                      }
                    }}
                    className="hidden"
                  />

                  <button
                    type="button"
                    disabled={scanning}
                    onClick={handleChoosePcFolderClick}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 text-xs sm:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-md"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>{scanning ? 'Loading & Saving...' : 'Choose Folder on My PC'}</span>
                  </button>
                </div>

                {onAddEmptyFolderName && (
                  <div className="pt-3 border-t border-rose-500/20 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={emptyFolderInput}
                      onChange={(e) => setEmptyFolderInput(e.target.value)}
                      placeholder="Or add an empty folder / season (e.g. Kingdom [Anime] or Yellowjackets/Season 2)"
                      className="flex-1 px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                    />
                    <button
                      type="button"
                      disabled={scanning || !emptyFolderInput.trim()}
                      onClick={async () => {
                        if (!emptyFolderInput.trim()) return;
                        setScanning(true);
                        try {
                          await onAddEmptyFolderName(emptyFolderInput.trim());
                          setEmptyFolderInput('');
                          onClose();
                        } finally {
                          setScanning(false);
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      + Add Empty Folder / Season
                    </button>
                  </div>
                )}
              </div>

              {/* Option B: Server Filesystem Path (Required for streaming to other LAN devices) */}
              <form
                onSubmit={handleScanSubmit}
                className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="root-path-input"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Host PC Server Folder Path (Used for Multi-Device LAN Streaming)
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      setPathInput(capabilities.defaultSamplePath);
                      loadDirectoryBrowser(capabilities.defaultSamplePath);
                      setScanning(true);
                      try {
                        await onApplyRootPath(capabilities.defaultSamplePath);
                        onClose();
                      } finally {
                        setScanning(false);
                      }
                    }}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    Restore Sample Library (AniList &amp; TMDB Demo)
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    id="root-path-input"
                    type="text"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    placeholder="e.g. C:\Users\You\Videos or D:\Media"
                    className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={scanning}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                    <span>{scanning ? 'Scanning...' : 'Set Primary Server Path'}</span>
                  </button>
                </div>

                {onAddServerFolder && (
                  <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                    <input
                      type="text"
                      value={additionalPathInput}
                      onChange={(e) => setAdditionalPathInput(e.target.value)}
                      placeholder="Add another server folder path (e.g. E:\Anime or F:\Movies)"
                      className="flex-1 px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                    />
                    <button
                      type="button"
                      disabled={scanning || !additionalPathInput.trim()}
                      onClick={async () => {
                        setErrorMsg(null);
                        setScanning(true);
                        try {
                          await onAddServerFolder(additionalPathInput.trim());
                          setAdditionalPathInput('');
                        } catch (err: unknown) {
                          setErrorMsg(
                            err instanceof Error ? err.message : 'Unable to add folder path.'
                          );
                        } finally {
                          setScanning(false);
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      + Add Additional Server Folder
                    </button>
                  </div>
                )}

                {errorMsg && (
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </form>

              {/* Interactive Server Directory Browser */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-rose-500" />
                    <span>Host PC Directory Explorer</span>
                  </span>
                  {browsingData?.parentPath && (
                    <button
                      type="button"
                      onClick={() => {
                        if (browsingData.parentPath) {
                          setPathInput(browsingData.parentPath);
                          loadDirectoryBrowser(browsingData.parentPath);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-500 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      <span>Up One Folder</span>
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 max-h-40 overflow-y-auto space-y-1">
                  {loadingDirs ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Reading directories...</p>
                  ) : browsingData && browsingData.directories.length > 0 ? (
                    browsingData.directories.map((dir) => (
                      <button
                        key={dir.fullPath}
                        type="button"
                        onClick={() => {
                          setPathInput(dir.fullPath);
                          loadDirectoryBrowser(dir.fullPath);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs hover:bg-slate-200/70 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2 font-mono text-slate-800 dark:text-slate-200 truncate">
                          <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="truncate">{dir.name}</span>
                        </span>
                        {dir.videoCountHint > 0 && (
                          <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                            {dir.videoCountHint} video{dir.videoCountHint === 1 ? '' : 's'}
                          </span>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
                      No subdirectories in <span className="font-mono">{browsingData?.currentPath}</span>
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'lan' && (
            <div className="space-y-6">
              {/* 1. Detected LAN URLs */}
              <div className="p-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-display font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                      <Wifi className="w-5 h-5 text-emerald-500" />
                      <span>Stream from This Host PC to Any Device on Your Wi-Fi / LAN</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      CineVault listens on <code className="font-mono">0.0.0.0:3000</code> and delivers videos via HTTP Range Requests (<code className="font-mono">206 Partial Content</code>) and live FFmpeg fragmented MP4 remuxing. Other devices stream directly without copying files.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Connect Other Devices Using Your Host PC&apos;s Local Network URL:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(networkInfo?.lanUrls && networkInfo.lanUrls.length > 0
                      ? networkInfo.lanUrls
                      : ['http://<YOUR-PC-LAN-IP>:3000']
                    ).map((url) => (
                      <div
                        key={url}
                        className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        <span className="truncate font-semibold">{url}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(url, url)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 text-[11px] font-sans font-medium cursor-pointer shrink-0"
                        >
                          {copiedText === url ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-500" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy URL</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Tip: To manually verify your PC&apos;s IPv4 address on Windows, open Command Prompt or PowerShell and run <code className="font-mono">ipconfig</code>, then look for <strong>IPv4 Address</strong> (e.g., <code className="font-mono">192.168.1.x</code>) and append <code className="font-mono">:3000</code>.
                  </p>
                </div>
              </div>

              {/* 2. Supported Devices Guide */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                    <Monitor className="w-4 h-4 text-rose-500" />
                    <span>Other PCs &amp; Laptops</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Open Chrome, Edge, Firefox, or Safari on the same LAN and enter the Host PC URL above. Watching status &amp; timestamps sync via SQLite.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                    <Smartphone className="w-4 h-4 text-rose-500" />
                    <span>Smartphones &amp; Tablets</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Connect to the same Wi-Fi network and open the LAN URL in mobile Safari or Chrome. Supports touch scrubbing and resume playback.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                    <Tv className="w-4 h-4 text-rose-500" />
                    <span>Smart TVs</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Open your TV&apos;s web browser, enter the LAN URL, and enable <strong>TV Mode</strong> in the toolbar for 10-foot D-Pad remote navigation.
                  </p>
                </div>
              </div>

              {/* 3. Windows Firewall Permissions */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-500" />
                    <span>Windows Firewall Setup (Allow Inbound TCP Port 3000 on Private Network)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(firewallCmd, 'firewall')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[11px] font-medium cursor-pointer"
                  >
                    {copiedText === 'firewall' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>Copied Rule</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy PowerShell Command</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  If other devices on your Wi-Fi cannot connect to your PC, Windows Defender Firewall may be blocking inbound connections to Node.js on port 3000. Run this command once in an <strong>Administrator PowerShell</strong> window:
                </p>
                <pre className="p-3 rounded-lg bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                  {firewallCmd}
                </pre>
              </div>

              {/* 4. Optional LAN PIN / Passcode Protection & Security Explanation */}
              <form
                onSubmit={handleSavePinConfig}
                className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="font-display font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                      <Lock className="w-4 h-4 text-rose-500" />
                      <span>Optional LAN PIN / Passcode Protection</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      This Host PC (<code className="font-mono">localhost</code>) is always trusted automatically. When enabled, other devices on your Wi-Fi must enter your PIN before browsing or streaming.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={pinEnabled}
                      onChange={(e) => setPinEnabled(e.target.checked)}
                      className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                    />
                    <span>Require PIN for LAN Devices</span>
                  </label>
                </div>

                {pinEnabled && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <input
                      type="password"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      placeholder="Enter new 4–8 digit PIN code (e.g. 2580)"
                      maxLength={12}
                      className="flex-1 px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                      required={pinEnabled}
                    />
                    <button
                      type="submit"
                      disabled={pinSaving}
                      className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      {pinSaving ? 'Saving PIN...' : 'Save LAN PIN'}
                    </button>
                  </div>
                )}

                {!pinEnabled && networkInfo?.pinProtectionEnabled && (
                  <button
                    type="submit"
                    disabled={pinSaving}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Disable LAN PIN Protection
                  </button>
                )}

                {pinStatusMsg && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {pinStatusMsg}
                  </p>
                )}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                  <p>
                    <strong>Security &amp; Access Boundaries:</strong> Streaming APIs (<code className="font-mono">/api/stream</code>, <code className="font-mono">/api/subtitles</code>, <code className="font-mono">/api/artwork</code>) strictly validate <code className="font-mono">path.resolve()</code> against your explicitly configured media folders so no client can traverse arbitrary files on your PC. The server is bound to your local network and is never exposed to the public internet by default.
                  </p>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6">
              {/* Completion Threshold & Playback Preferences */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Automatic Completion Threshold (90% Agreed Default)</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Videos are automatically marked as <strong>Completed</strong> when playback reaches{' '}
                    <strong>{Math.round((preferences?.completionThreshold || 0.9) * 100)}%</strong> of total duration.
                  </p>
                </div>

                {onUpdatePreferences && (
                  <select
                    value={String(preferences?.completionThreshold || 0.9)}
                    onChange={(e) =>
                      onUpdatePreferences({ completionThreshold: parseFloat(e.target.value) })
                    }
                    className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-900 dark:text-white cursor-pointer"
                  >
                    <option value="0.85">85% Watched → Completed</option>
                    <option value="0.9">90% Watched → Completed (Recommended)</option>
                    <option value="0.95">95% Watched → Completed</option>
                  </select>
                )}
              </div>

              {/* Watch History List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    Persisted Viewing History ({watchHistory.length})
                  </h3>
                  {watchHistory.length > 0 && onClearWatchHistory && (
                    <button
                      type="button"
                      onClick={onClearWatchHistory}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Watch History</span>
                    </button>
                  )}
                </div>

                {watchHistory.length === 0 ? (
                  <div className="p-8 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                    No watch history recorded yet. Start watching any movie or episode and your timestamp, watching status, and last-watched date will be persisted here across sessions and devices.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {watchHistory.map((entry) => {
                      const pct =
                        entry.duration > 0
                          ? Math.min(100, Math.round((entry.currentTime / entry.duration) * 100))
                          : 0;
                      return (
                        <div
                          key={entry.episodeId}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                              <span
                                className={
                                  String(entry.status).toLowerCase() === 'completed'
                                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold capitalize'
                                    : 'text-amber-600 dark:text-amber-400 font-semibold capitalize'
                                }
                              >
                                {entry.status}
                              </span>
                              <span>·</span>
                              <span>
                                S{String(entry.seasonNumber).padStart(2, '0')}E
                                {String(entry.episodeNumber).padStart(2, '0')}
                              </span>
                              <span>·</span>
                              <span>
                                {formatTimecode(entry.currentTime)} / {formatTimecode(entry.duration)} ({pct}%)
                              </span>
                              <span>·</span>
                              <span>
                                {new Date(entry.lastWatched || entry.watchedAt).toLocaleString()}
                              </span>
                            </div>

                            <h4 className="font-display font-semibold text-sm text-slate-900 dark:text-white truncate">
                              {entry.mediaTitle} — {entry.episodeTitle}
                            </h4>
                          </div>

                          {onResumeHistoryEntry && (
                            <button
                              type="button"
                              onClick={() => {
                                onResumeHistoryEntry(entry);
                                onClose();
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>
                                {String(entry.status).toLowerCase() === 'completed'
                                  ? 'Watch Again'
                                  : 'Resume'}
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
