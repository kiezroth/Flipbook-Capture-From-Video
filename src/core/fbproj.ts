export type VideoSource =
  | { kind: 'file'; path: string }
  // start/end are byte offsets of the stored entry inside the zip; end is exclusive (matches ffmpeg subfile `end`)
  | { kind: 'zipEntry'; zipPath: string; start: number; end: number; fileName: string }

/** The `-i` argument ffmpeg/ffprobe needs to read this source. */
export function ffmpegInput(src: VideoSource): string {
  return src.kind === 'file' ? src.path : `subfile,,start,${src.start},end,${src.end},,:${src.zipPath}`
}
