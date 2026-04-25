import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AVATAR_LOOP_FPS, AVATAR_TRANSITION_FPS } from "./avatar-pipeline-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const loopsRoot = path.join(projectRoot, "public", "avatar", "loops");
const transitionsRoot = path.join(projectRoot, "public", "avatar", "transitions");
const reverseRoot = path.join(projectRoot, "public", "avatar", "transitions_reverse");
const referenceGifPath = path.join(
  loopsRoot,
  "idle_neutral",
  "idle_neutral_1.gif"
);
const previewRoot = path.join(projectRoot, "tmp", "avatar-background-match-preview");
const reportPath = path.join(previewRoot, "report.json");

const ANALYSIS_SIZE = 128;
const ANALYSIS_FRAME_SIZE = ANALYSIS_SIZE * ANALYSIS_SIZE * 3;
const SAMPLE_X_RATIO = 0.14;
const SAMPLE_Y_RATIO = 0.5;
const SAMPLE_RADIUS = 3;
const MIN_LUMA = 175;
const MAX_CHANNEL_SPREAD = 24;
const MAX_CHANNEL_DELTA = 40;
const DELTA_WEIGHT = 1;
const BRIGHTNESS_LIFT = 12;

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getTargetFpsForPath(filePath) {
  return filePath.startsWith(loopsRoot) ? AVATAR_LOOP_FPS : AVATAR_TRANSITION_FPS;
}

function findGifFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (/\.gif$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr || "";
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString("utf8")
      : result.stdout || "";
    const combined = `${stderr}\n${stdout}`.trim();
    const lines = combined.split("\n").map((line) => line.trim()).filter(Boolean);
    throw new Error(lines.at(-1) || `${command} exited with status ${result.status}`);
  }

  return result;
}

function extractFrameBuffer(inputPath, targetFps) {
  const result = runCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-vf",
      `fps=${targetFps},scale=${ANALYSIS_SIZE}:${ANALYSIS_SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=${ANALYSIS_SIZE}:${ANALYSIS_SIZE},format=rgb24`,
      "-f",
      "rawvideo",
      "-"
    ],
    { encoding: null }
  );

  const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
  if (buffer.length < ANALYSIS_FRAME_SIZE) {
    throw new Error("not enough decoded frame data");
  }

  const remainder = buffer.length % ANALYSIS_FRAME_SIZE;
  return remainder === 0 ? buffer : buffer.subarray(0, buffer.length - remainder);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  return sorted[mid];
}

function samplePatchAt(buffer, frameOffset, centerX, centerY) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = Math.max(0, centerY - SAMPLE_RADIUS); y <= Math.min(ANALYSIS_SIZE - 1, centerY + SAMPLE_RADIUS); y += 1) {
    for (let x = Math.max(0, centerX - SAMPLE_RADIUS); x <= Math.min(ANALYSIS_SIZE - 1, centerX + SAMPLE_RADIUS); x += 1) {
      const pixelOffset = frameOffset + (y * ANALYSIS_SIZE + x) * 3;
      r += buffer[pixelOffset];
      g += buffer[pixelOffset + 1];
      b += buffer[pixelOffset + 2];
      count += 1;
    }
  }

  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);
  const max = Math.max(avgR, avgG, avgB);
  const min = Math.min(avgR, avgG, avgB);

  return {
    r: avgR,
    g: avgG,
    b: avgB,
    luma: 0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB,
    spread: max - min
  };
}

function collectFrameSamples(buffer) {
  const sampleX = Math.round((ANALYSIS_SIZE - 1) * SAMPLE_X_RATIO);
  const sampleY = Math.round((ANALYSIS_SIZE - 1) * SAMPLE_Y_RATIO);
  const samples = [];

  for (let offset = 0; offset + ANALYSIS_FRAME_SIZE <= buffer.length; offset += ANALYSIS_FRAME_SIZE) {
    samples.push(samplePatchAt(buffer, offset, sampleX, sampleY));
  }

  return {
    samples,
    samplePoint: {
      x: sampleX,
      y: sampleY,
      xRatio: SAMPLE_X_RATIO,
      yRatio: SAMPLE_Y_RATIO,
      radius: SAMPLE_RADIUS
    }
  };
}

function summarizeFrameSamples(frameSamples, samplePoint) {
  const samples = frameSamples;
  const preferredSamples = samples.filter(
    (sample) => sample.luma >= MIN_LUMA && sample.spread <= MAX_CHANNEL_SPREAD
  );
  const sourceSamples = preferredSamples.length >= Math.max(4, Math.round(samples.length * 0.2))
    ? preferredSamples
    : samples;

  return {
    r: median(sourceSamples.map((sample) => sample.r)),
    g: median(sourceSamples.map((sample) => sample.g)),
    b: median(sourceSamples.map((sample) => sample.b)),
    sampleCount: sourceSamples.length,
    totalFrameCount: samples.length,
    sampleMode: preferredSamples.length === sourceSamples.length ? "neutral-point-median" : "point-median-fallback",
    samplePoint
  };
}

function analyzeGif(inputPath) {
  const targetFps = getTargetFpsForPath(inputPath);
  const buffer = extractFrameBuffer(inputPath, targetFps);
  const { samples, samplePoint } = collectFrameSamples(buffer);
  return {
    targetFps,
    frameSamples: samples,
    summary: summarizeFrameSamples(samples, samplePoint)
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeAdjustment(target, source) {
  const r = clamp(Math.round((target.r - source.r) * DELTA_WEIGHT) + BRIGHTNESS_LIFT, -MAX_CHANNEL_DELTA, MAX_CHANNEL_DELTA);
  const g = clamp(Math.round((target.g - source.g) * DELTA_WEIGHT) + BRIGHTNESS_LIFT, -MAX_CHANNEL_DELTA, MAX_CHANNEL_DELTA);
  const b = clamp(Math.round((target.b - source.b) * DELTA_WEIGHT) + BRIGHTNESS_LIFT, -MAX_CHANNEL_DELTA, MAX_CHANNEL_DELTA);
  return { r, g, b };
}

function buildFrameAdjustments(target, frameSamples) {
  return frameSamples.map((sample) => computeAdjustment(target, sample));
}

function buildChannelDeltaExpression(frameAdjustments, channel) {
  if (frameAdjustments.length === 0) {
    return "0";
  }

  const segments = [];
  let start = 0;
  let current = frameAdjustments[0][channel];

  for (let index = 1; index < frameAdjustments.length; index += 1) {
    const nextValue = frameAdjustments[index][channel];
    if (nextValue === current) {
      continue;
    }

    segments.push({ start, end: index - 1, value: current });
    start = index;
    current = nextValue;
  }

  segments.push({ start, end: frameAdjustments.length - 1, value: current });

  let expression = "0";
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    expression = `if(between(N,${segment.start},${segment.end}),${segment.value},${expression})`;
  }

  return expression;
}

function buildFilterGraph(frameAdjustments, targetFps) {
  const rDelta = buildChannelDeltaExpression(frameAdjustments, "r");
  const gDelta = buildChannelDeltaExpression(frameAdjustments, "g");
  const bDelta = buildChannelDeltaExpression(frameAdjustments, "b");

  return (
    `[0:v]fps=${targetFps},` +
    `format=rgb24,` +
    `geq=` +
    `r='clip(r(X,Y)+(${rDelta}),0,255)':` +
    `g='clip(g(X,Y)+(${gDelta}),0,255)':` +
    `b='clip(b(X,Y)+(${bDelta}),0,255)',` +
    `split[pal_src][gif_src];` +
    `[pal_src]palettegen=stats_mode=full[palette];` +
    `[gif_src][palette]paletteuse=dither=bayer:bayer_scale=3`
  );
}

function runFfmpegGrade(inputPath, outputPath, frameAdjustments, targetFps) {
  ensureDirForFile(outputPath);
  runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    buildFilterGraph(frameAdjustments, targetFps),
    "-gifflags",
    "-offsetting",
    "-loop",
    "0",
    outputPath
  ]);
}

function frameLumaRange(frameSamples) {
  if (frameSamples.length === 0) {
    return 0;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const sample of frameSamples) {
    min = Math.min(min, sample.luma);
    max = Math.max(max, sample.luma);
  }

  return Number((max - min).toFixed(2));
}

function adjustmentRange(frameAdjustments, channel) {
  const values = frameAdjustments.map((adjustment) => adjustment[channel]);
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function groupInputs() {
  return [
    { label: "loops", root: loopsRoot },
    { label: "transitions", root: transitionsRoot },
    { label: "transitions_reverse", root: reverseRoot }
  ];
}

function previewOutputPath(sourcePath) {
  return path.join(previewRoot, path.relative(projectRoot, sourcePath));
}

function writeReport(report) {
  ensureDirForFile(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function main() {
  if (!fs.existsSync(referenceGifPath)) {
    throw new Error(`reference GIF not found: ${toPosix(path.relative(projectRoot, referenceGifPath))}`);
  }

  const inputs = groupInputs()
    .flatMap(({ label, root }) =>
      findGifFiles(root).map((filePath) => ({
        label,
        sourcePath: filePath
      }))
    )
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  fs.rmSync(previewRoot, { recursive: true, force: true });
  fs.mkdirSync(previewRoot, { recursive: true });

  const referenceAnalysis = analyzeGif(referenceGifPath);
  const targetBackground = referenceAnalysis.summary;
  const successes = [];
  const failures = [];

  for (const input of inputs) {
    const relativeSource = toPosix(path.relative(projectRoot, input.sourcePath));
    const outputPath = previewOutputPath(input.sourcePath);

    try {
      const sourceAnalysis = analyzeGif(input.sourcePath);
      const frameAdjustments = buildFrameAdjustments(targetBackground, sourceAnalysis.frameSamples);
      runFfmpegGrade(input.sourcePath, outputPath, frameAdjustments, sourceAnalysis.targetFps);

      successes.push({
        kind: input.label,
        source: relativeSource,
        output: toPosix(path.relative(projectRoot, outputPath)),
        targetFps: sourceAnalysis.targetFps,
        background: sourceAnalysis.summary,
        frameLumaRange: frameLumaRange(sourceAnalysis.frameSamples),
        adjustmentRange: {
          r: adjustmentRange(frameAdjustments, "r"),
          g: adjustmentRange(frameAdjustments, "g"),
          b: adjustmentRange(frameAdjustments, "b")
        }
      });
    } catch (error) {
      failures.push({
        kind: input.label,
        source: relativeSource,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const report = {
    reference: toPosix(path.relative(projectRoot, referenceGifPath)),
    previewRoot: toPosix(path.relative(projectRoot, previewRoot)),
    targetFps: {
      loops: AVATAR_LOOP_FPS,
      transitions: AVATAR_TRANSITION_FPS
    },
    analysis: {
      referenceFps: referenceAnalysis.targetFps,
      size: ANALYSIS_SIZE,
      samplePoint: targetBackground.samplePoint,
      minLuma: MIN_LUMA,
      maxChannelSpread: MAX_CHANNEL_SPREAD,
      brightnessLift: BRIGHTNESS_LIFT,
      maxChannelDelta: MAX_CHANNEL_DELTA,
      referenceFrameLumaRange: frameLumaRange(referenceAnalysis.frameSamples)
    },
    targetBackground,
    processed: successes,
    failures
  };

  writeReport(report);

  console.log(`Reference: ${report.reference}`);
  console.log(
    `Target background RGB: (${targetBackground.r}, ${targetBackground.g}, ${targetBackground.b}) via ${targetBackground.sampleMode}`
  );
  console.log(`Preview root: ${report.previewRoot}`);
  console.log(`Processed: ${successes.length}`);

  for (const entry of successes) {
    console.log(
      `- ${entry.output}  bg=(${entry.background.r},${entry.background.g},${entry.background.b})` +
      `  fps=${entry.targetFps}` +
      `  lumaRange=${entry.frameLumaRange}` +
      `  deltaR=[${entry.adjustmentRange.r.min},${entry.adjustmentRange.r.max}]` +
      `  deltaG=[${entry.adjustmentRange.g.min},${entry.adjustmentRange.g.max}]` +
      `  deltaB=[${entry.adjustmentRange.b.min},${entry.adjustmentRange.b.max}]`
    );
  }

  if (failures.length > 0) {
    console.error(`Failures: ${failures.length}`);
    for (const failure of failures) {
      console.error(`- ${failure.source}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

main();
