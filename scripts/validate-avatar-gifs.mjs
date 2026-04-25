import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const inputRoots = [
  path.join(projectRoot, "public", "avatar", "loops"),
  path.join(projectRoot, "public", "avatar", "transitions")
];

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

function inspectGif(filePath) {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-pix_fmt", "rgba", "-f", "framemd5", "-"],
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
    return {
      ok: false,
      reason: (result.stderr || result.stdout || "ffmpeg exited with a non-zero status").trim()
    };
  }

  const hashes = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s*,\s*/).at(-1))
    .filter(Boolean);

  if (hashes.length === 0) {
    return {
      ok: false,
      reason: "No decoded frames were reported by ffmpeg."
    };
  }

  return {
    ok: true,
    frameCount: hashes.length,
    uniqueFrameCount: new Set(hashes).size
  };
}

function main() {
  const files = inputRoots.flatMap(findGifFiles);
  const warnings = [];
  const failures = [];

  for (const filePath of files) {
    const inspection = inspectGif(filePath);
    if (!inspection.ok) {
      failures.push({
        filePath,
        reason: inspection.reason
      });
      continue;
    }

    if (inspection.uniqueFrameCount === 1 && inspection.frameCount > 1) {
      warnings.push({
        filePath,
        frameCount: inspection.frameCount
      });
    }
  }

  console.log(`Validated ${files.length} GIF(s).`);

  if (warnings.length > 0) {
    console.warn("Static-animation warnings:");
    for (const warning of warnings) {
      console.warn(
        `- ${toPosixPath(path.relative(projectRoot, warning.filePath))}: ${warning.frameCount} frames decoded, but all frames are identical`
      );
    }
  } else {
    console.log("No visually static multi-frame GIFs detected.");
  }

  if (failures.length > 0) {
    console.error("Validation failures:");
    for (const failure of failures) {
      console.error(`- ${toPosixPath(path.relative(projectRoot, failure.filePath))}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

main();
