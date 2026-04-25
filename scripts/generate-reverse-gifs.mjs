import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AVATAR_TRANSITION_FPS, getTransitionTargetFps } from "./avatar-pipeline-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const transitionsDir = path.join(projectRoot, "public", "avatar", "transitions");
const outputDir = path.join(projectRoot, "generated", "avatar", "reverse");

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function getTransitionFiles() {
  if (!fs.existsSync(transitionsDir)) {
    return [];
  }

  return fs
    .readdirSync(transitionsDir)
    .filter((file) => /\.gif$/i.test(file))
    .sort();
}

function hasFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.error) {
    return {
      available: false,
      reason:
        result.error.code === "ENOENT"
          ? "ffmpeg not found in PATH"
          : result.error.message
    };
  }

  return {
    available: result.status === 0,
    reason: result.status === 0 ? null : (result.stderr || result.stdout || "ffmpeg exited with a non-zero status").trim()
  };
}

function reverseOutputName(file) {
  return `${path.basename(file, path.extname(file))}__rev.gif`;
}

function reverseGif(inputPath, outputPath, targetFps) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      `[0:v] fps=${targetFps},reverse,split [rev_palette][rev_out];[rev_palette] palettegen [palette];[rev_out][palette] paletteuse`,
      "-gifflags",
      "-offsetting",
      "-loop",
      "-1",
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

function main() {
  const files = getTransitionFiles();
  const ffmpeg = hasFfmpeg();
  const failures = [];
  const successes = [];

  if (files.length === 0) {
    console.log(`No transition GIFs found in ${toPosixPath(path.relative(projectRoot, transitionsDir))}.`);
    return;
  }

  if (!ffmpeg.available) {
    for (const file of files) {
      failures.push({
        file,
        reason: `${ffmpeg.reason}. Install ffmpeg and rerun this script.`
      });
    }
  } else {
    fs.mkdirSync(outputDir, { recursive: true });

    for (const file of files) {
      const inputPath = path.join(transitionsDir, file);
      const assetId = path.basename(file, path.extname(file));
      const targetFps = getTransitionTargetFps(assetId);
      const outputName = reverseOutputName(file);
      const outputPath = path.join(outputDir, outputName);
      const result = reverseGif(inputPath, outputPath, targetFps);

      if (result.ok) {
        successes.push({
          source: file,
          output: outputName,
          targetFps
        });
        continue;
      }

      failures.push({
        file,
        reason: result.reason
      });
    }
  }

  console.log(
    `Scanned ${files.length} transition GIF(s) from ${toPosixPath(path.relative(projectRoot, transitionsDir))}.`
  );
  console.log(`Default transition playback rate: ${AVATAR_TRANSITION_FPS} fps.`);

  if (successes.length > 0) {
    console.log(
      `Generated ${successes.length} reverse GIF(s) in ${toPosixPath(path.relative(projectRoot, outputDir))}.`
    );
    for (const success of successes) {
      console.log(`- ${success.source} -> ${success.output} @ ${success.targetFps}fps`);
    }
  } else {
    console.log("Generated 0 reverse GIF(s).");
  }

  if (failures.length > 0) {
    console.error(`Failed ${failures.length} transition GIF(s):`);
    for (const failure of failures) {
      console.error(`- ${failure.file}: ${failure.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All transition GIFs were reversed successfully.");
}

main();
