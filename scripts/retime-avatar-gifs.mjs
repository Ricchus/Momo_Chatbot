import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AVATAR_LOOP_FPS,
  AVATAR_TRANSITION_FPS,
  getLoopTargetFps,
  getTransitionTargetFps
} from "./avatar-pipeline-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const inputGroups = [
  {
    kind: "loops",
    root: path.join(projectRoot, "public", "avatar", "loops")
  },
  {
    kind: "transitions",
    root: path.join(projectRoot, "public", "avatar", "transitions")
  }
];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maomao-avatar-retime-"));

function buildFilterGraph(targetFps) {
  return (
    `[0:v]fps=${targetFps},` +
    `split[pal_src][gif_src];` +
    `[pal_src]palettegen=reserve_transparent=1[palette];` +
    `[gif_src][palette]paletteuse=alpha_threshold=96`
  );
}

function toPosixPath(filePath) {
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

function buildTempOutputPath(inputPath) {
  return path.join(tempRoot, path.relative(projectRoot, inputPath));
}

function getAssetId(inputPath) {
  return path.basename(inputPath, path.extname(inputPath));
}

function resolveTargetFps(kind, inputPath) {
  const assetId = getAssetId(inputPath);
  return kind === "transitions" ? getTransitionTargetFps(assetId) : getLoopTargetFps(assetId);
}

function transcodeGif(inputPath, outputPath, targetFps) {
  ensureDir(outputPath);

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      buildFilterGraph(targetFps),
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

function replaceOriginalFile(sourcePath, tempPath) {
  const backupPath = `${sourcePath}.bak`;

  fs.renameSync(sourcePath, backupPath);
  try {
    fs.copyFileSync(tempPath, sourcePath);
    fs.rmSync(backupPath, { force: true });
  } catch (error) {
    fs.renameSync(backupPath, sourcePath);
    throw error;
  }
}

function main() {
  const failures = [];
  const successes = [];

  for (const group of inputGroups) {
    const files = findGifFiles(group.root);

    for (const filePath of files) {
      const tempPath = buildTempOutputPath(filePath);
      const targetFps = resolveTargetFps(group.kind, filePath);
      const result = transcodeGif(filePath, tempPath, targetFps);

      if (!result.ok) {
        failures.push({
          file: filePath,
          reason: result.reason
        });
        continue;
      }

      replaceOriginalFile(filePath, tempPath);
      successes.push({
        filePath,
        targetFps
      });
    }
  }

  console.log(
    `Retimed ${successes.length} GIF(s). Default loop fps: ${AVATAR_LOOP_FPS}. Default transition fps: ${AVATAR_TRANSITION_FPS}.`
  );
  for (const success of successes) {
    console.log(`- ${toPosixPath(path.relative(projectRoot, success.filePath))} @ ${success.targetFps}fps`);
  }

  if (failures.length > 0) {
    console.error(`Failed ${failures.length} GIF(s):`);
    for (const failure of failures) {
      console.error(`- ${toPosixPath(path.relative(projectRoot, failure.file))}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

try {
  main();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
