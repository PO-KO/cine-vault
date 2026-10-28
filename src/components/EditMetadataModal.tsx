import React, { useEffect, useState } from 'react';
import { X, Upload, RotateCcw, Check, Search, RefreshCw } from 'lucide-react';
import { ExternalMetadataMatch, MediaCategory, MediaItem } from '../types/media';

interface EditMetadataModalProps {
  item: MediaItem;
  onClose: () => void;
  onSave: (
    id: string,
    updates: {
      title: string;
      category: MediaCategory;
      synopsis: string;
      customPosterUrl: string;
      externalMatch?: ExternalMetadataMatch;
    }
  ) => Promise<void>;
}

export const EditMetadataModal: React.FC<EditMetadataModalProps> = ({ item, onClose, onSave }) => {
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState<MediaCategory>(item.category);
  const [synopsis, setSynopsis] = useState(item.synopsis);
  const [customPosterUrl, setCustomPosterUrl] = useState(item.customPosterUrl || '');
  const [selectedMatch, setSelectedMatch] = useState<ExternalMetadataMatch | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Live AniList / TMDB Search state
  const [searchQuery, setSearchQuery] = useState(item.originalTitle || item.title);
  const [searchProvider, setSearchProvider] = useState<'anilist' | 'tmdb_movie' | 'tmdb_tv'>(
    item.category === 'anime' ? 'anilist' : item.category === 'tv' ? 'tmdb_tv' : 'tmdb_movie'
  );
  const [searchResults, setSearchResults] = useState<ExternalMetadataMatch[]>([]);
  const [searching, setSearching] = useState(false);

  const categories: { id: MediaCategory; label: string; desc: string }[] = [
    { id: 'anime', label: 'Anime (AniList)', desc: 'Fetches posters, story & genres from AniList' },
    { id: 'tv', label: 'TV Shows (TMDB)', desc: 'Fetches series artwork & overview from TMDB' },
    { id: 'movies', label: 'Movies (TMDB)', desc: 'Fetches film poster, genres & plot from TMDB' },
    { id: 'other', label: 'Other Video', desc: 'Lectures, home videos, or studio reels' },
  ];

  const runProviderSearch = async (q: string, prov: 'anilist' | 'tmdb_movie' | 'tmdb_tv') => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/metadata?q=${encodeURIComponent(q.trim())}&provider=${encodeURIComponent(prov)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    runProviderSearch(searchQuery, searchProvider);
  }, [searchProvider]);

  const handleApplyExternalMatch = (match: ExternalMetadataMatch) => {
    setSelectedMatch(match);
    setTitle(match.title);
    setSynopsis(match.synopsis);
    setCustomPosterUrl(match.posterUrl);
    if (match.provider === 'anilist') {
      setCategory('anime');
    } else if (match.mediaType === 'TV') {
      setCategory('tv');
    } else if (match.mediaType === 'MOVIE') {
      setCategory('movies');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomPosterUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(item.id, {
        title: title.trim() || item.originalTitle,
        category,
        synopsis: synopsis.trim(),
        customPosterUrl: customPosterUrl.trim(),
        externalMatch: selectedMatch,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-metadata-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 id="edit-metadata-title" className="font-display font-bold text-lg text-slate-900 dark:text-white">
              Match AniList / TMDB & Edit Media Info
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-lg">
              Folder: {item.relativePath} · Auto-detected: {item.autoType.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* 1. Live AniList & TMDB Search Matcher */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Search Official Metadata (AniList for Anime · TMDB for Movies & TV)
              </span>

              <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-900 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSearchProvider('anilist')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    searchProvider === 'anilist'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  AniList (Anime)
                </button>
                <button
                  type="button"
                  onClick={() => setSearchProvider('tmdb_tv')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    searchProvider === 'tmdb_tv'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  TMDB (TV Show)
                </button>
                <button
                  type="button"
                  onClick={() => setSearchProvider('tmdb_movie')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    searchProvider === 'tmdb_movie'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  TMDB (Movie)
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runProviderSearch(searchQuery, searchProvider);
                    }
                  }}
                  placeholder="Type anime, movie, or TV show title..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => runProviderSearch(searchQuery, searchProvider)}
                disabled={searching}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${searching ? 'animate-spin' : ''}`} />
                <span>Search</span>
              </button>
            </div>

            {/* Search Results Grid */}
            {searching ? (
              <p className="text-xs text-slate-400 py-3 text-center">
                Querying {searchProvider === 'anilist' ? 'AniList GraphQL' : 'TMDB Catalog'}...
              </p>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
                {searchResults.map((resItem) => {
                  const isSelected = selectedMatch?.externalId === resItem.externalId;
                  return (
                    <button
                      key={`${resItem.provider}-${resItem.externalId}`}
                      type="button"
                      onClick={() => handleApplyExternalMatch(resItem)}
                      className={`flex items-start gap-3 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-rose-600 bg-rose-600/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-rose-500/50'
                      }`}
                    >
                      {resItem.posterUrl && (
                        <img
                          src={resItem.posterUrl}
                          alt={resItem.title}
                          referrerPolicy="no-referrer"
                          className="w-12 h-16 object-cover rounded-md shrink-0 bg-slate-800"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-display font-semibold text-xs text-slate-900 dark:text-white truncate">
                            {resItem.title}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {resItem.releaseYear} · {resItem.genres.slice(0, 2).join(' · ')}
                          {resItem.ratingScore ? ` · ${resItem.ratingScore}%` : ''}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                          {resItem.synopsis}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-2 text-center">
                No matches found. Try adjusting the title query above.
              </p>
            )}
          </div>

          {/* 2. Category Assignment */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Library Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {categories.map((cat) => {
                const selected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setCategory(cat.id);
                      if (cat.id === 'anime') setSearchProvider('anilist');
                      else if (cat.id === 'tv') setSearchProvider('tmdb_tv');
                      else if (cat.id === 'movies') setSearchProvider('tmdb_movie');
                    }}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      selected
                        ? 'border-rose-600 bg-rose-600/10 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs">{cat.label}</span>
                      {selected && <Check className="w-3.5 h-3.5 text-rose-500" />}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                      {cat.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Display Title & Poster */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="media-title-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Display Title
                </label>
                <button
                  type="button"
                  onClick={() => setTitle(item.originalTitle)}
                  className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
              <input
                id="media-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="poster-url-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Poster Artwork URL / Upload
                </label>
                {customPosterUrl && (
                  <button
                    type="button"
                    onClick={() => setCustomPosterUrl('')}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    Reset Poster
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="poster-url-input"
                  type="text"
                  value={customPosterUrl}
                  onChange={(e) => setCustomPosterUrl(e.target.value)}
                  placeholder="AniList / TMDB poster URL or upload..."
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                />
                <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>File</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          {/* 4. Story / Synopsis */}
          <div className="space-y-1.5">
            <label htmlFor="synopsis-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Story / Synopsis
            </label>
            <textarea
              id="synopsis-input"
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Metadata'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
