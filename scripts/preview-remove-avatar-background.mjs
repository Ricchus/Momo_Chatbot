import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AVATAR_LOOP_FPS, AVATAR_TRANSITION_FPS } from "./avatar-pipeline-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const loopsRoot = path.join(projectRoot, "public", "avatar", "loops");
const transitionsRoot = path.join(projectRoot, "public", "avatar", "transitions");
const previewRoot = path.join(projectRoot, "tmp", "avatar-background-preview");
const previewLoopsRoot = path.join(previewRoot, "public", "avatar", "loops");
const previewTransitionsRoot = path.join(previewRoot, "public", "avatar", "transitions");
const previewReverseRoot = path.join(previewRoot, "generated", "avatar", "reverse");

const LOOP_FILTER_GRAPH =
  `[0:v]fps=${AVATAR_LOOP_FPS},` +
  `colorkey=0xFFFFFF:0.06:0.01,` +
  `colorkey=0xEDEDED:0.05:0.01,` +
  `split[pal_src][gif_src];` +
  `[pal_src]palettegen=reserve_transparent=1[palette];` +
  `[gif_src][palette]paletteuse=alpha_threshold=96`;
const TRANSITION_FILTER_GRAPH =
  `[0:v]fps=${AVATAR_TRANSITION_FPS},` +
  `colorkey=0xFFFFFF:0.06:0.01,` +
  `colorkey=0xE8E8E8:0.08:0.02,` +
  `split[pal_src][gif_src];` +
  `[pal_src]palettegen=reserve_transparent=1[palette];` +
  `[gif_src][palette]paletteuse=alpha_threshold=96`;
const REVERSE_FILTER_GRAPH =
  `[0:v]fps=${AVATAR_TRANSITION_FPS},` +
  `reverse,` +
  `split[pal_src][gif_src];` +
  `[pal_src]palettegen=reserve_transparent=1[palette];` +
  `[gif_src][palette]paletteuse=alpha_threshold=96`;

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function findGifFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];
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
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runFfmpeg(inputPath, outputPath, filterGraph) {
  ensureDir(outputPath);
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      filterGraph,
      "-gifflags",
      "-offsetting",
      "-loop",
      "0",
      outputPath
    ],
    {
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  if (result.error) {
    return {
      ok: false,
      reason: result.error.message
    };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || "ffmpeg exited with a non-zero status").trim();
    const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      ok: false,
      reason: lines.at(-1) || stderr
    };
  }

  return { ok: true };
}

function previewPathForLoop(sourcePath) {
  return path.join(previewLoopsRoot, path.relative(loopsRoot, sourcePath));
}

function previewPathForTransition(sourcePath) {
  return path.join(previewTransitionsRoot, path.relative(transitionsRoot, sourcePath));
}

function reversePreviewPathForTransition(sourcePath) {
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(previewReverseRoot, `${baseName}__rev.gif`);
}

function processBatch(files, getOutputPath, filterGraph) {
  const successes = [];
  const failures = [];

  for (const sourcePath of files) {
    const outputPath = getOutputPath(sourcePath);
    const result = runFfmpeg(sourcePath, outputPath, filterGraph);

    if (result.ok) {
      successes.push({
        source: sourcePath,
        output: outputPath
      });
      continue;
    }

    failures.push({
      source: sourcePath,
      reason: result.reason
    });
  }

  return { successes, failures };
}

function processReversePreviews(processedTransitions) {
  const successes = [];
  const failures = [];

  for (const transition of processedTransitions) {
    const outputPath = reversePreviewPathForTransition(transition.source);
    const result = runFfmpeg(transition.output, outputPath, REVERSE_FILTER_GRAPH);

    if (result.ok) {
      successes.push({
        source: transition.output,
        output: outputPath
      });
      continue;
    }

    failures.push({
      source: transition.output,
      reason: result.reason
    });
  }

  return { successes, failures };
}

function logSection(title, entries) {
  if (entries.length === 0) {
    console.log(`${title}: 0`);
    return;
  }

  console.log(`${title}: ${entries.length}`);
  for (const entry of entries) {
    console.log(`- ${toPosix(path.relative(projectRoot, entry.output))}`);
  }
}

function logFailures(title, failures) {
  if (failures.length === 0) {
    return;
  }

  console.error(`${title}: ${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${toPosix(path.relative(projectRoot, failure.source))}: ${failure.reason}`);
  }
}

function main() {
  const loopFiles = findGifFiles(loopsRoot);
  const transitionFiles = findGifFiles(transitionsRoot);

  fs.rmSync(previewRoot, { recursive: true, force: true });
  fs.mkdirSync(previewRoot, { recursive: true });

  const loopResult = processBatch(loopFiles, previewPathForLoop, LOOP_FILTER_GRAPH);
  const transitionResult = processBatch(transitionFiles, previewPathForTransition, TRANSITION_FILTER_GRAPH);
  const reverseResult = processReversePreviews(transitionResult.successes);

  console.log(`Preview root: ${toPosix(path.relative(projectRoot, previewRoot))}`);
  console.log(`Loop fps: ${AVATAR_LOOP_FPS}`);
  console.log(`Transition fps: ${AVATAR_TRANSITION_FPS}`);
  logSection("Processed loops", loopResult.successes);
  logSection("Processed transitions", transitionResult.successes);
  logSection("Generated reverse previews", reverseResult.successes);

  const allFailures = [
    ...loopResult.failures,
    ...transitionResult.failures,
    ...reverseResult.failures
  ];
  logFailures("Failures", allFailures);

  if (allFailures.length > 0) {
    process.exitCode = 1;
  }
}

main();
