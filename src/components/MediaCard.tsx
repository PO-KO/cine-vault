import React, { useState } from 'react';
import { Play, Bookmark, Edit3, ListVideo, CheckCircle2, Film } from 'lucide-react';
import { MediaEpisode, MediaItem } from '../types/media';
import { formatCategoryLabel, formatRemainingTime, formatTimecode } from '../utils/formatters';

interface MediaCardProps {
  item: MediaItem;
  onPlay: (item: MediaItem, episode?: MediaEpisode) => void;
  onOpenSeries: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
  onOpenEdit: (item: MediaItem) => void;
  onToggleWatched: (episode: MediaEpisode, completed: boolean) => void;
  tvMode: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  onPlay,
  onOpenSeries,
  onToggleFavorite,
  onOpenEdit,
  onToggleWatched,
  tvMode,
}) => {
  const [imgError, setImgError] = useState(false);

  const primaryEpisode = item.inProgressEpisode || item.episodes[0];
  const hasProgress = Boolean(
    primaryEpisode && primaryEpisode.progress.currentTime > 0 && !primaryEpisode.progress.completed
  );
  const isAllWatched = item.totalEpisodes > 0 && item.watchedEpisodes === item.totalEpisodes;
  const progressPercent =
    primaryEpisode && primaryEpisode.progress.duration > 0
      ? Math.min(100, Math.round((primaryEpisode.progress.currentTime / primaryEpisode.progress.duration) * 100))
      : 0;

  return (
    <article className="group flex flex-col rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 overflow-hidden transition-transform duration-150 hover:-translate-y-0.5">
      {/* Poster Container (3:4 Aspect Ratio) */}
      <div className="relative aspect-[3/4] w-full bg-slate-900 overflow-hidden">
        {!imgError && item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-103"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
            <Film className="w-10 h-10 text-rose-500 mb-3 opacity-80" />
            <span className="font-display font-semibold text-base text-slate-100 line-clamp-2">
              {item.title}
            </span>
            <span className="text-xs text-slate-400 mt-1">{formatCategoryLabel(item.category)}</span>
          </div>
        )}

        {/* Measured bottom contrast scrim for playback controls & progress bar */}
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/95 via-slate-950/50 to-transparent pointer-events-none" />

        {/* Primary Play Overlay Button (Accessible via Keyboard, TV Remote, Touch, and Mouse) */}
        <button
          type="button"
          data-focusable="true"
          onClick={() => onPlay(item, primaryEpisode)}
          aria-label={`Play ${item.title}`}
          className="absolute inset-0 flex items-center justify-center bg-slate-950/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 cursor-pointer"
        >
          <span className="w-14 h-14 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg transform transition-transform duration-150 group-hover:scale-105">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </span>
        </button>

        {/* Bottom-of-poster Progress / Resume indicator */}
        {hasProgress && primaryEpisode && (
          <div className="absolute inset-x-0 bottom-0 p-3 space-y-1.5 pointer-events-none">
            <div className="flex items-center justify-between text-[11px] text-slate-200 font-mono tabular-nums">
              <span>
                {item.autoType === 'series'
                  ? `S${String(primaryEpisode.seasonNumber).padStart(2, '0')}E${String(
                      primaryEpisode.episodeNumber
                    ).padStart(2, '0')}`
                  : formatTimecode(primaryEpisode.progress.currentTime)}
              </span>
              <span>
                {formatRemainingTime(primaryEpisode.progress.currentTime, primaryEpisode.progress.duration)}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800/90 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Card Body — Zero-Pill Discipline: leads directly with quiet inline text & primary title */}
      <div className="flex-1 flex flex-col justify-between p-4 space-y-3">
        <div className="space-y-1">
          {/* Unboxed metadata row with middle-dot separators */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span className="font-sans font-medium text-rose-600 dark:text-rose-400">
              {formatCategoryLabel(item.category)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {item.autoType === 'series'
                ? `${item.totalEpisodes} ${item.totalEpisodes === 1 ? 'Ep' : 'Eps'}`
                : primaryEpisode?.containerFormat.toUpperCase() || 'MP4'}
            </span>
            {item.autoType === 'series' && item.watchedEpisodes > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {item.watchedEpisodes}/{item.totalEpisodes} watched
                </span>
              </>
            )}
            {item.autoType === 'movie' && isAllWatched && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">Watched</span>
              </>
            )}
          </div>

          {/* Primary Title */}
          <h3
            className={`font-display font-semibold text-slate-900 dark:text-slate-100 line-clamp-1 ${
              tvMode ? 'text-lg' : 'text-base'
            }`}
            title={item.title}
          >
            {item.title}
          </h3>

          {/* Subtitle / Folder Path info */}
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
            {item.synopsis}
          </p>
        </div>

        {/* Action Toolbar — Touch (>=40px), Mouse & Smart TV Remote friendly */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-1.5">
          <button
            type="button"
            data-focusable="true"
            onClick={() => onPlay(item, primaryEpisode)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tvMode ? 'py-2.5 px-3 text-sm' : 'py-2 px-3 text-xs'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{hasProgress ? 'Resume' : 'Play'}</span>
          </button>

          {item.autoType === 'series' && (
            <button
              type="button"
              data-focusable="true"
              onClick={() => onOpenSeries(item)}
              title="Browse Seasons & Episodes"
              className={`inline-flex items-center justify-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tvMode ? 'py-2.5 px-3 text-sm' : 'py-2 px-2.5 text-xs'
              }`}
            >
              <ListVideo className="w-3.5 h-3.5" />
              <span>Eps</span>
            </button>
          )}

          <button
            type="button"
            data-focusable="true"
            onClick={() => onToggleFavorite(item)}
            title={item.isFavorite ? 'Remove from Watchlist' : 'Add to Watchlist'}
            aria-label={item.isFavorite ? 'Remove from Watchlist' : 'Add to Watchlist'}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              item.isFavorite
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${item.isFavorite ? 'fill-current' : ''}`} />
          </button>

          {primaryEpisode && (
            <button
              type="button"
              data-focusable="true"
              onClick={() => onToggleWatched(primaryEpisode, !primaryEpisode.progress.completed)}
              title={primaryEpisode.progress.completed ? 'Mark as Unwatched' : 'Mark as Watched'}
              aria-label={primaryEpisode.progress.completed ? 'Mark as Unwatched' : 'Mark as Watched'}
              className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                primaryEpisode.progress.completed
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            data-focusable="true"
            onClick={() => onOpenEdit(item)}
            title="Edit Title, Category & Custom Poster"
            aria-label={`Edit ${item.title}`}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
  );
};
