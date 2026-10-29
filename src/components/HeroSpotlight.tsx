import React, { useState } from 'react';
import { Play, ListVideo, Bookmark, Edit3, Film } from 'lucide-react';
import { MediaEpisode, MediaItem } from '../types/media';
import {
  formatCategoryLabel,
  formatDurationHuman,
  formatRemainingTime,
  formatTimecode,
} from '../utils/formatters';

interface HeroSpotlightProps {
  item: MediaItem;
  targetEpisode?: MediaEpisode;
  onPlayEpisode: (item: MediaItem, episode: MediaEpisode) => void;
  onOpenSeriesDetails: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
  onOpenEditMetadata: (item: MediaItem) => void;
  tvMode: boolean;
}

export const HeroSpotlight: React.FC<HeroSpotlightProps> = ({
  item,
  targetEpisode,
  onPlayEpisode,
  onOpenSeriesDetails,
  onToggleFavorite,
  onOpenEditMetadata,
  tvMode,
}) => {
  const [imgError, setImgError] = useState(false);

  const hasProgress = Boolean(
    targetEpisode && targetEpisode.progress.currentTime > 0 && !targetEpisode.progress.completed
  );
  const progressPercent =
    targetEpisode && targetEpisode.progress.duration > 0
      ? Math.min(100, Math.round((targetEpisode.progress.currentTime / targetEpisode.progress.duration) * 100))
      : 0;

  const backdropSrc = item.bannerUrl || item.posterUrl;
  const providerLabel =
    item.metadataProvider === 'anilist'
      ? 'AniList'
      : item.metadataProvider === 'tmdb'
      ? 'TMDB'
      : 'Local';

  return (
    <section
      aria-label="Featured Media Spotlight"
      className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800/90 bg-slate-900 text-white"
    >
      {/* Background visual layer with measured contrast scrim */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950/60" />

      {!imgError && backdropSrc && (
        <img
          src={backdropSrc}
          alt={item.title}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="absolute right-0 top-0 h-full w-full md:w-3/4 object-cover opacity-40 md:opacity-50 select-none pointer-events-none"
        />
      )}

      {/* Measured contrast scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/30 md:bg-gradient-to-r md:from-slate-950 md:via-slate-950/90 md:to-slate-950/25" />

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 items-stretch gap-6 p-6 sm:p-8 lg:p-10">
        {/* Left Content Column */}
        <div className="lg:col-span-8 flex flex-col justify-between space-y-5">
          <div className="space-y-3">
            {/* Unboxed metadata kicker (Zero-Pill discipline) */}
            <div className={`flex flex-wrap items-center gap-2 text-rose-400 font-medium ${tvMode ? 'text-sm' : 'text-xs'}`}>
              <span>{hasProgress ? 'Continue Watching' : 'Featured in Library'}</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-200">{formatCategoryLabel(item.category)}</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-mono tabular-nums">{item.releaseYear}</span>
              {typeof item.ratingScore === 'number' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400 font-mono tabular-nums">
                    {item.ratingScore}% {providerLabel} Score
                  </span>
                </>
              )}
              {item.studioOrNetwork && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300">{item.studioOrNetwork}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-mono tabular-nums">
                {item.totalEpisodes === 0
                  ? 'Empty Folder (0 Eps)'
                  : item.autoType === 'series'
                  ? `${item.totalEpisodes} ${item.totalEpisodes === 1 ? 'Episode' : 'Episodes'}`
                  : targetEpisode
                  ? formatDurationHuman(targetEpisode.estimatedDurationSec)
                  : 'Movie'}
              </span>
            </div>

            <h1
              className={`font-display font-bold tracking-tight text-white max-w-2xl ${
                tvMode ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-4xl'
              }`}
            >
              {item.title}
            </h1>

            {/* Genres as quiet unboxed inline text */}
            {item.genres && item.genres.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                {item.genres.map((g, idx) => (
                  <React.Fragment key={g}>
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <span>{g}</span>
                  </React.Fragment>
                ))}
                {targetEpisode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono uppercase text-slate-400">{targetEpisode.containerFormat}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-400">{targetEpisode.resolutionLabel}</span>
                  </>
                )}
              </div>
            )}

            <p className={`text-slate-300 max-w-2xl leading-relaxed line-clamp-3 ${tvMode ? 'text-base sm:text-lg' : 'text-sm sm:text-base'}`}>
              {item.synopsis}
            </p>
          </div>

          {/* Active Episode & Resume Progress Bar */}
          <div className="space-y-4 pt-1">
            {hasProgress && targetEpisode && (
              <div className="max-w-md space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-300 font-mono tabular-nums">
                  <span>
                    {item.autoType === 'series'
                      ? `S${String(targetEpisode.seasonNumber).padStart(2, '0')} · E${String(
                          targetEpisode.episodeNumber
                        ).padStart(2, '0')} — ${targetEpisode.title}`
                      : targetEpisode.title}
                  </span>
                  <span>
                    {formatTimecode(targetEpisode.progress.currentTime)} /{' '}
                    {formatTimecode(targetEpisode.progress.duration)} (
                    {formatRemainingTime(targetEpisode.progress.currentTime, targetEpisode.progress.duration)})
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Primary & Secondary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {targetEpisode ? (
                <button
                  type="button"
                  data-focusable="true"
                  onClick={() => onPlayEpisode(item, targetEpisode)}
                  className={`inline-flex items-center gap-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tvMode ? 'px-7 py-3.5 text-base' : 'px-5 py-2.5 text-sm'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {hasProgress
                      ? item.autoType === 'series'
                        ? `Resume S${String(targetEpisode.seasonNumber).padStart(2, '0')}E${String(
                            targetEpisode.episodeNumber
                          ).padStart(2, '0')}`
                        : 'Resume Movie'
                      : item.autoType === 'series'
                      ? 'Play S01E01'
                      : 'Play Movie'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  data-focusable="true"
                  onClick={() => onOpenSeriesDetails(item)}
                  className={`inline-flex items-center gap-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tvMode ? 'px-7 py-3.5 text-base' : 'px-5 py-2.5 text-sm'
                  }`}
                >
                  <ListVideo className="w-4 h-4" />
                  <span>Open Empty Folder</span>
                </button>
              )}

              {item.autoType === 'series' && targetEpisode && (
                <button
                  type="button"
                  data-focusable="true"
                  onClick={() => onOpenSeriesDetails(item)}
                  className={`inline-flex items-center gap-2 bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tvMode ? 'px-6 py-3.5 text-base' : 'px-4 py-2.5 text-sm'
                  }`}
                >
                  <ListVideo className="w-4 h-4" />
                  <span>Episodes ({item.totalEpisodes})</span>
                </button>
              )}

              <button
                type="button"
                data-focusable="true"
                onClick={() => onToggleFavorite(item)}
                className={`inline-flex items-center gap-2 border font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tvMode ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-sm'
                } ${
                  item.isFavorite
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <Bookmark className={`w-4 h-4 ${item.isFavorite ? 'fill-current text-amber-400' : ''}`} />
                <span>{item.isFavorite ? 'In Watchlist' : 'Add to Watchlist'}</span>
              </button>

              <button
                type="button"
                data-focusable="true"
                onClick={() => onOpenEditMetadata(item)}
                className={`inline-flex items-center gap-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tvMode ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-sm'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                <span>Match AniList / TMDB</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Poster Preview on Desktop */}
        <div className="hidden lg:flex lg:col-span-4 justify-end items-center">
          <div className="w-48 xl:w-52 aspect-[3/4] rounded-xl overflow-hidden border border-slate-700/80 bg-slate-900 relative shadow-2xl">
            {!imgError && item.posterUrl ? (
              <img
                src={item.posterUrl}
                alt={item.title}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-slate-800 to-slate-950">
                <Film className="w-10 h-10 text-rose-500 mb-2" />
                <span className="font-display font-semibold text-sm text-white">{item.title}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
