import { MediaCategory } from '../types/media';

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    const hh = String(hrs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatDurationHuman(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '24m';
  const totalMins = Math.round(seconds / 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

export function formatRemainingTime(currentTime: number, duration: number): string {
  const remaining = Math.max(0, duration - currentTime);
  const mins = Math.ceil(remaining / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m left`;
  }
  return `${mins}m left`;
}

export function formatCategoryLabel(category: MediaCategory): string {
  switch (category) {
    case 'anime':
      return 'Anime';
    case 'tv':
      return 'TV Show';
    case 'movies':
      return 'Movie';
    case 'other':
      return 'Other Video';
  }
}

export interface ParsedCue {
  startTime: number;
  endTime: number;
  text: string;
}

function parseTimestampToSeconds(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

export function parseVttOrSrtCues(content: string): ParsedCue[] {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT.*?\n+/i, '')
    .trim();

  if (!normalized) return [];

  const blocks = normalized.split(/\n\s*\n/);
  const cues: ParsedCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowLineIdx === -1) continue;

    const timeLine = lines[arrowLineIdx];
    const [startStr, endWithSettings] = timeLine.split('-->');
    const endStr = (endWithSettings || '').trim().split(/\s+/)[0];

    const startTime = parseTimestampToSeconds(startStr);
    const endTime = parseTimestampToSeconds(endStr);
    const text = lines.slice(arrowLineIdx + 1).join('\n');

    if (text && endTime > startTime) {
      cues.push({ startTime, endTime, text });
    }
  }

  return cues;
}
