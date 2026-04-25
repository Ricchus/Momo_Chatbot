import { decompressFrames, parseGIF } from "gifuct-js";

const MIN_FRAME_DELAY_MS = 20;

export type DecodedGifFrame = {
  delayMs: number;
  disposalType: number;
  dims: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  patch: ImageData;
};

export type DecodedGifClip = {
  src: string;
  width: number;
  height: number;
  totalDurationMs: number;
  frames: DecodedGifFrame[];
};

const gifClipCache = new Map<string, Promise<DecodedGifClip>>();
const resolvedGifClipCache = new Map<string, DecodedGifClip>();

function normalizeFrameDelay(delayMs: number) {
  return Math.max(MIN_FRAME_DELAY_MS, delayMs || MIN_FRAME_DELAY_MS);
}

export function loadGifClip(src: string) {
  const resolved = resolvedGifClipCache.get(src);
  if (resolved) {
    return Promise.resolve(resolved);
  }

  const cached = gifClipCache.get(src);
  if (cached) {
    return cached;
  }

  const pending = fetch(src)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load gif: ${src} (${response.status})`);
      }

      return response.arrayBuffer();
    })
    .then((buffer) => {
      const parsedGif = parseGIF(buffer);
      const parsedFrames = decompressFrames(parsedGif, true);

      if (parsedFrames.length === 0) {
        throw new Error(`Gif has no decodable frames: ${src}`);
      }

      const frames = parsedFrames.map((frame) => ({
        delayMs: normalizeFrameDelay(frame.delay),
        disposalType: frame.disposalType ?? 0,
        dims: frame.dims,
        patch: new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height)
      }));

      const decodedClip = {
        src,
        width: parsedGif.lsd.width || parsedFrames[0].dims.width,
        height: parsedGif.lsd.height || parsedFrames[0].dims.height,
        totalDurationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0),
        frames
      };

      resolvedGifClipCache.set(src, decodedClip);
      return decodedClip;
    })
    .catch((error) => {
      gifClipCache.delete(src);
      resolvedGifClipCache.delete(src);
      throw error;
    });

  gifClipCache.set(src, pending);
  return pending;
}

export function preloadGifClip(src: string) {
  return loadGifClip(src).then(
    () => undefined,
    () => undefined
  );
}

export function getCachedGifClip(src: string) {
  return resolvedGifClipCache.get(src) ?? null;
}
