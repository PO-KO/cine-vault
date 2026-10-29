import { AudioTrack } from '../types/media';

export interface MkvHeaderInfo {
  compactHeaderBytes: Uint8Array;
  rawHeaderBlob: Blob;
  firstClusterOffset: number;
  timecodeScaleSec: number;
  durationSec: number | null;
  isHevc: boolean;
  audioTracks: AudioTrack[];
  audioTrackNumbers: Set<number>;
  videoTrackNumbers: Set<number>;
}

export interface TranscodedAudioSegment {
  audioBuffer: AudioBuffer | null;
  blobUrl: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  nextClusterOffset: number | null;
  isCompleteFile: boolean;
  audioTrackIndex: number;
}

const headerCache = new WeakMap<Blob, MkvHeaderInfo>();

function readEbmlId(buf: Uint8Array, pos: number): { idLen: number; id: number } {
  if (pos >= buf.length) return { idLen: 1, id: 0 };
  const b = buf[pos];
  if (b & 0x80) return { idLen: 1, id: b };
  if (b & 0x40 && pos + 1 < buf.length) {
    return { idLen: 2, id: (b << 8) | buf[pos + 1] };
  }
  if (b & 0x20 && pos + 2 < buf.length) {
    return { idLen: 3, id: (b << 16) | (buf[pos + 1] << 8) | buf[pos + 2] };
  }
  if (b & 0x10 && pos + 3 < buf.length) {
    return {
      idLen: 4,
      id: ((b << 24) >>> 0) + ((buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]),
    };
  }
  return { idLen: 1, id: b };
}

function readEbmlVint(buf: Uint8Array, pos: number): { len: number; value: number; isUnknown: boolean } {
  if (pos >= buf.length) return { len: 1, value: 0, isUnknown: false };
  const b = buf[pos];
  if (b === 0) return { len: 1, value: 0, isUnknown: false };

  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (b & mask) === 0) {
    len++;
    mask >>= 1;
  }
  if (len > 8 || pos + len > buf.length) {
    return { len: 1, value: 0, isUnknown: false };
  }

  let value = b & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const byte = buf[pos + i];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }

  return { len, value, isUnknown: allOnes };
}

function readUint(buf: Uint8Array, pos: number, len: number): number {
  let val = 0;
  const end = Math.min(buf.length, pos + len);
  for (let i = pos; i < end; i++) {
    val = val * 256 + buf[i];
  }
  return val;
}

function readFloat(buf: Uint8Array, pos: number, len: number): number | null {
  if (pos + len > buf.length) return null;
  const view = new DataView(buf.buffer, buf.byteOffset + pos, len);
  if (len === 4) return view.getFloat32(0, false);
  if (len === 8) return view.getFloat64(0, false);
  return null;
}

function readAscii(buf: Uint8Array, pos: number, len: number): string {
  let out = '';
  const end = Math.min(buf.length, pos + len);
  for (let i = pos; i < end; i++) {
    const c = buf[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

/**
 * Checks whether buf[i..i+3] is a genuine Matroska Cluster header (0x1F 0x43 0xB6 0x75),
 * NOT a SeekID pointer (0x53 0xAB 0x84) inside SeekHead.
 */
function isRealClusterAt(buf: Uint8Array, i: number): boolean {
  if (i < 0 || i + 10 > buf.length) return false;
  if (
    buf[i] !== 0x1f ||
    buf[i + 1] !== 0x43 ||
    buf[i + 2] !== 0xb6 ||
    buf[i + 3] !== 0x75
  ) {
    return false;
  }
  if (i >= 3 && buf[i - 3] === 0x53 && buf[i - 2] === 0xab && buf[i - 1] === 0x84) {
    return false;
  }
  const { len: vintLen } = readEbmlVint(buf, i + 4);
  const childStart = i + 4 + vintLen;
  if (childStart >= buf.length) return false;
  const firstChildId = buf[childStart];
  // Valid Cluster child elements: Timestamp (0xE7), CRC-32 (0xBF), Void (0xEC), Position (0xA7), PrevSize (0xAB), SimpleBlock (0xA3), BlockGroup (0xA0)
  return (
    firstChildId === 0xe7 ||
    firstChildId === 0xbf ||
    firstChildId === 0xec ||
    firstChildId === 0xa7 ||
    firstChildId === 0xab ||
    firstChildId === 0xa3 ||
    firstChildId === 0xa0
  );
}

function findNextRealCluster(buf: Uint8Array, startFrom = 0): number {
  const limit = buf.length - 10;
  for (let i = startFrom; i <= limit; i++) {
    if (buf[i] === 0x1f && isRealClusterAt(buf, i)) {
      return i;
    }
  }
  return -1;
}

function findLastRealCluster(buf: Uint8Array): number {
  for (let i = buf.length - 12; i >= 0; i--) {
    if (buf[i] === 0x1f && isRealClusterAt(buf, i)) {
      return i;
    }
  }
  return -1;
}

function findTopLevelElement(
  buf: Uint8Array,
  id0: number,
  id1: number,
  id2: number,
  id3: number
): { bytes: Uint8Array; startOffset: number; endOffset: number } | null {
  const limit = buf.length - 10;
  for (let i = 0; i <= limit; i++) {
    if (
      buf[i] === id0 &&
      buf[i + 1] === id1 &&
      buf[i + 2] === id2 &&
      buf[i + 3] === id3
    ) {
      if (i >= 3 && buf[i - 3] === 0x53 && buf[i - 2] === 0xab && buf[i - 1] === 0x84) {
        continue;
      }
      const { len: vintLen, value: elSize } = readEbmlVint(buf, i + 4);
      const endOffset = Math.min(buf.length, i + 4 + vintLen + elSize);
      return {
        bytes: buf.subarray(i, endOffset),
        startOffset: i,
        endOffset,
      };
    }
  }
  return null;
}

function parseTimecodeScaleSec(headerBuf: Uint8Array): number {
  const limit = headerBuf.length - 12;
  for (let i = 0; i <= limit; i++) {
    if (
      headerBuf[i] === 0x2a &&
      headerBuf[i + 1] === 0xd7 &&
      headerBuf[i + 2] === 0xb1
    ) {
      const { len, value: elSize } = readEbmlVint(headerBuf, i + 3);
      if (elSize >= 1 && elSize <= 8 && i + 3 + len + elSize <= headerBuf.length) {
        const val = readUint(headerBuf, i + 3 + len, elSize);
        if (val > 0) {
          return val / 1_000_000_000;
        }
      }
    }
  }
  return 0.001;
}

function parseInfoDurationSec(infoBytes: Uint8Array, timecodeScaleSec: number): number | null {
  const limit = infoBytes.length - 6;
  for (let i = 0; i <= limit; i++) {
    if (infoBytes[i] === 0x44 && infoBytes[i + 1] === 0x89) {
      const { len, value: elSize } = readEbmlVint(infoBytes, i + 2);
      if ((elSize === 4 || elSize === 8) && i + 2 + len + elSize <= infoBytes.length) {
        const rawDur = readFloat(infoBytes, i + 2 + len, elSize);
        if (rawDur !== null && rawDur > 0 && Number.isFinite(rawDur)) {
          return rawDur * timecodeScaleSec;
        }
      }
    }
  }
  return null;
}

function readClusterTimestampSec(
  buf: Uint8Array,
  clusterIndex: number,
  timecodeScaleSec: number
): number | null {
  if (!isRealClusterAt(buf, clusterIndex)) return null;
  const { len: vintLen } = readEbmlVint(buf, clusterIndex + 4);
  let p = clusterIndex + 4 + vintLen;
  const searchEnd = Math.min(buf.length - 2, p + 64);

  while (p < searchEnd) {
    const eid = buf[p];
    const { len: sLen, value: eSize } = readEbmlVint(buf, p + 1);
    const body = p + 1 + sLen;
    if (eid === 0xe7 && eSize >= 0 && eSize <= 8 && body + eSize <= buf.length) {
      const rawTs = readUint(buf, body, eSize);
      return rawTs * timecodeScaleSec;
    }
    if (eid === 0xbf || eid === 0xec || eid === 0xa7 || eid === 0xab) {
      p = body + eSize;
    } else {
      break;
    }
  }
  return null;
}

function scanAllClustersInBuffer(
  buf: Uint8Array,
  baseOffset: number,
  timecodeScaleSec: number
): { absOffset: number; ts: number }[] {
  const results: { absOffset: number; ts: number }[] = [];
  const limit = buf.length - 12;
  let i = 0;
  while (i <= limit) {
    if (buf[i] === 0x1f && isRealClusterAt(buf, i)) {
      const ts = readClusterTimestampSec(buf, i, timecodeScaleSec);
      if (ts !== null && Number.isFinite(ts)) {
        results.push({ absOffset: baseOffset + i, ts });
      }
      // Advance past Cluster header
      i += 12;
    } else {
      i++;
    }
  }
  return results;
}

/**
 * Parses the local Matroska header, discovers all Video & Audio tracks, duration, and codec info.
 */
export async function getMkvHeaderInfo(file: Blob): Promise<MkvHeaderInfo | null> {
  const cached = headerCache.get(file);
  if (cached) return cached;

  const initialReadSize = Math.min(file.size, 2 * 1024 * 1024);
  let scanBuf = new Uint8Array(await file.slice(0, initialReadSize).arrayBuffer());

  if (
    scanBuf.length < 32 ||
    scanBuf[0] !== 0x1a ||
    scanBuf[1] !== 0x45 ||
    scanBuf[2] !== 0xdf ||
    scanBuf[3] !== 0xa3
  ) {
    return null;
  }

  let tracksElem = findTopLevelElement(scanBuf, 0x16, 0x54, 0xae, 0x6b);
  let firstClusterOffset = findNextRealCluster(
    scanBuf,
    tracksElem ? tracksElem.endOffset : 32
  );

  if (firstClusterOffset === -1 && file.size > initialReadSize) {
    const extendedSize = Math.min(file.size, 16 * 1024 * 1024);
    scanBuf = new Uint8Array(await file.slice(0, extendedSize).arrayBuffer());
    tracksElem = findTopLevelElement(scanBuf, 0x16, 0x54, 0xae, 0x6b);
    firstClusterOffset = findNextRealCluster(
      scanBuf,
      tracksElem ? tracksElem.endOffset : 32
    );
  }

  if (firstClusterOffset === -1) {
    return null;
  }

  const headerSlice = scanBuf.subarray(0, firstClusterOffset);
  const timecodeScaleSec = parseTimecodeScaleSec(headerSlice);
  const infoElem = findTopLevelElement(headerSlice, 0x15, 0x49, 0xa9, 0x66);
  let durationSec = infoElem ? parseInfoDurationSec(infoElem.bytes, timecodeScaleSec) : null;

  // If Duration was not present in Info, inspect the last Clusters in the final 8 MB of the file
  if ((!durationSec || durationSec < 5) && file.size > firstClusterOffset + 32 * 1024) {
    try {
      const tailStart = Math.max(firstClusterOffset, file.size - 8 * 1024 * 1024);
      const tailBuf = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
      const lastCIdx = findLastRealCluster(tailBuf);
      if (lastCIdx !== -1) {
        const lastTs = readClusterTimestampSec(tailBuf, lastCIdx, timecodeScaleSec);
        if (lastTs !== null && lastTs > 0) {
          durationSec = lastTs + 4;
        }
      }
    } catch {}
  }

  const audioTracks: AudioTrack[] = [];
  const audioTrackNumbers = new Set<number>();
  const videoTrackNumbers = new Set<number>();
  let isHevc = false;

  if (tracksElem) {
    const tBuf = tracksElem.bytes;
    const { len: tVintLen, value: tTotalSize } = readEbmlVint(tBuf, 4);
    let p = 4 + tVintLen;
    const tEnd = Math.min(tBuf.length, p + tTotalSize);

    while (p < tEnd) {
      const { idLen, id } = readEbmlId(tBuf, p);
      const { len: sLen, value: eSize } = readEbmlVint(tBuf, p + idLen);
      const bodyStart = p + idLen + sLen;
      const bodyEnd = Math.min(tEnd, bodyStart + eSize);

      if (id === 0xae) {
        let ep = bodyStart;
        let trackNum = 0;
        let trackType = 0;
        let codecId = '';
        let lang = 'und';
        let name = '';
        let channels = 2;

        while (ep < bodyEnd) {
          const { idLen: cIdLen, id: cId } = readEbmlId(tBuf, ep);
          const { len: cSLen, value: cSize } = readEbmlVint(tBuf, ep + cIdLen);
          const cBody = ep + cIdLen + cSLen;
          const cEnd = Math.min(bodyEnd, cBody + cSize);

          if (cId === 0xd7) {
            trackNum = readUint(tBuf, cBody, cSize);
          } else if (cId === 0x83) {
            trackType = readUint(tBuf, cBody, cSize);
          } else if (cId === 0x86) {
            codecId = readAscii(tBuf, cBody, cSize);
          } else if (cId === 0x22b59c || cId === 0x22b59d) {
            lang = readAscii(tBuf, cBody, cSize).toLowerCase() || 'und';
          } else if (cId === 0x536e) {
            name = readAscii(tBuf, cBody, cSize);
          } else if (cId === 0xe1) {
            let ap = cBody;
            while (ap < cEnd) {
              const { idLen: aIdLen, id: aId } = readEbmlId(tBuf, ap);
              const { len: aSLen, value: aSize } = readEbmlVint(tBuf, ap + aIdLen);
              const aBody = ap + aIdLen + aSLen;
              if (aId === 0x9f) {
                channels = readUint(tBuf, aBody, aSize);
              }
              ap = aBody + aSize;
            }
          }
          ep = cEnd;
        }

        if (trackType === 1 && trackNum > 0) {
          videoTrackNumbers.add(trackNum);
          if (/HEVC|H265|MPEGH/i.test(codecId)) {
            isHevc = true;
          }
        } else if (trackType === 2 && trackNum > 0) {
          audioTrackNumbers.add(trackNum);

          const cleanCodec = codecId.replace(/^A_/, '').split('/')[0] || 'AUDIO';
          const channelDesc =
            channels >= 8
              ? '7.1 Surround'
              : channels >= 6
              ? '5.1 Surround'
              : channels === 1
              ? '1.0 Mono'
              : '2.0 Stereo';

          const langLabel =
            lang.startsWith('jp') || lang.startsWith('ja')
              ? 'Japanese'
              : lang.startsWith('en')
              ? 'English'
              : lang.startsWith('es') || lang.startsWith('sp')
              ? 'Spanish'
              : lang.startsWith('fr')
              ? 'French'
              : lang.startsWith('de') || lang.startsWith('ge')
              ? 'German'
              : lang.startsWith('ar')
              ? 'Arabic'
              : `Audio Track ${audioTracks.length + 1}`;

          const idx = audioTracks.length;
          audioTracks.push({
            id: `audio-${idx}`,
            index: idx,
            label: `${langLabel}${name ? ` (${name})` : ''} · ${cleanCodec}`,
            language: lang,
            codec: cleanCodec,
            channels: channelDesc,
          });
        }
      }
      p = bodyEnd;
    }
  }

  const info: MkvHeaderInfo = {
    compactHeaderBytes: new Uint8Array(headerSlice),
    rawHeaderBlob: file.slice(0, firstClusterOffset),
    firstClusterOffset,
    timecodeScaleSec,
    durationSec,
    isHevc,
    audioTracks,
    audioTrackNumbers,
    videoTrackNumbers,
  };
  headerCache.set(file, info);
  return info;
}

/**
 * Binary-searches the local MKV file for the Cluster corresponding to `targetTimeSec`.
 */
export async function findClusterForTime(
  file: Blob,
  header: MkvHeaderInfo,
  targetTimeSec: number
): Promise<{ byteOffset: number; startTimeSec: number }> {
  if (targetTimeSec <= 1.0) {
    return { byteOffset: header.firstClusterOffset, startTimeSec: 0 };
  }

  let low = header.firstClusterOffset;
  let high = file.size;
  let bestOffset = header.firstClusterOffset;
  let bestTimeSec = 0;

  const windowSize = 4 * 1024 * 1024; // 4 MB window handles high-bitrate 1080p/4K clusters reliably

  for (let iter = 0; iter < 12; iter++) {
    if (high - low <= windowSize) break;
    const mid = Math.floor((low + high) / 2);
    const readEnd = Math.min(file.size, mid + windowSize);
    const buf = new Uint8Array(await file.slice(mid, readEnd).arrayBuffer());

    let clusters = scanAllClustersInBuffer(buf, mid, header.timecodeScaleSec);

    if (clusters.length === 0 && mid > low) {
      const backStart = Math.max(low, mid - windowSize);
      const backBuf = new Uint8Array(await file.slice(backStart, mid).arrayBuffer());
      clusters = scanAllClustersInBuffer(backBuf, backStart, header.timecodeScaleSec);
      if (clusters.length === 0) {
        high = backStart;
        continue;
      }
    }

    if (clusters.length === 0) {
      high = mid;
      continue;
    }

    for (const c of clusters) {
      if (c.ts <= targetTimeSec && c.ts >= bestTimeSec) {
        bestOffset = c.absOffset;
        bestTimeSec = c.ts;
      }
    }

    const firstCluster = clusters[0];
    const lastCluster = clusters[clusters.length - 1];

    if (firstCluster.ts > targetTimeSec) {
      high = firstCluster.absOffset;
    } else if (lastCluster.ts <= targetTimeSec) {
      low = lastCluster.absOffset;
    } else {
      // targetTimeSec is bracketed between firstCluster and lastCluster inside this window!
      return { byteOffset: bestOffset, startTimeSec: bestTimeSec };
    }
  }

  if (high > low) {
    const finalReadEnd = Math.min(file.size, low + windowSize);
    const finalBuf = new Uint8Array(await file.slice(low, finalReadEnd).arrayBuffer());
    const finalClusters = scanAllClustersInBuffer(finalBuf, low, header.timecodeScaleSec);
    for (const c of finalClusters) {
      if (c.ts <= targetTimeSec && c.ts >= bestTimeSec) {
        bestOffset = c.absOffset;
        bestTimeSec = c.ts;
      }
    }
  }

  return { byteOffset: bestOffset, startTimeSec: bestTimeSec };
}

/**
 * Streams a local MKV/AVI file in 2MB chunks into `/api/remux-mp4?sessionId=...` with backpressure,
 * allowing `<video src="/api/remux-mp4?sessionId=...">` to play the MKV file directly as a native `.mp4` stream!
 */
export async function feedLocalMkvToMp4RemuxSession(options: {
  sessionId: string;
  file: Blob;
  header: MkvHeaderInfo | null;
  startByteOffset: number;
  audioTrackIndex: number;
  isHevc: boolean;
  isAvi: boolean;
  signal: AbortSignal;
}): Promise<void> {
  const {
    sessionId,
    file,
    header,
    startByteOffset,
    audioTrackIndex,
    isHevc,
    isAvi,
    signal,
  } = options;

  const queryBase = `sessionId=${encodeURIComponent(sessionId)}&audioTrack=${audioTrackIndex}&isHevc=${
    isHevc ? '1' : '0'
  }&isAvi=${isAvi ? '1' : '0'}`;

  let offset = startByteOffset;
  let isFirstChunk = true;

  try {
    while (offset < file.size && !signal.aborted) {
      const chunkSize = isFirstChunk ? 1536 * 1024 : 2560 * 1024; // 1.5MB first chunk for fast startup, then 2.5MB
      const nextOffset = Math.min(file.size, offset + chunkSize);
      const isEof = nextOffset >= file.size;

      let chunkBlob: Blob;
      if (isFirstChunk && header && startByteOffset > header.firstClusterOffset) {
        // Prepend the untouched Matroska header [0..firstClusterOffset] when starting from a mid-file seek offset
        chunkBlob = new Blob([header.rawHeaderBlob, file.slice(offset, nextOffset)]);
      } else if (isFirstChunk && header && startByteOffset === header.firstClusterOffset) {
        chunkBlob = file.slice(0, nextOffset);
      } else {
        chunkBlob = file.slice(offset, nextOffset);
      }

      isFirstChunk = false;
      offset = nextOffset;

      const res = await fetch(`/api/remux-mp4?${queryBase}&eof=${isEof ? '1' : '0'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunkBlob,
        signal,
      });

      if (!res.ok) {
        break;
      }
    }
  } catch {
    // Aborted or stream closed
  } finally {
    if (signal.aborted) {
      fetch(`/api/remux-mp4?sessionId=${encodeURIComponent(sessionId)}&action=abort`, {
        method: 'POST',
      }).catch(() => {});
    }
  }
}
