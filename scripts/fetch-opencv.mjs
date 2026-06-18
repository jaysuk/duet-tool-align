#!/usr/bin/env node
/**
 * Fetch the OpenCV.js runtime into `dwc/DuetToolAlign/opencv.js` so the plugin ships it as a bundled
 * asset (served from DWC's web root; loaded at runtime via `pluginAssetUrl`). Run before building the
 * plugin package (build.bat and the release workflow do this); the file is gitignored, not committed.
 *
 *   node scripts/fetch-opencv.mjs [version]   # default version below
 *
 * OpenCV 4.9.0's docs build is a single self-contained file (~10 MB, WASM inlined), so there's no
 * separate .wasm to ship.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2] || "4.9.0";
const url = `https://docs.opencv.org/${version}/opencv.js`;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dwc", "DuetToolAlign");
const outFile = join(outDir, "opencv.js");

// Skip the download if a non-trivial copy is already present (keeps repeat builds fast).
if (existsSync(outFile) && statSync(outFile).size > 1_000_000) {
	console.log(`opencv.js already present (${(statSync(outFile).size / 1e6).toFixed(1)} MB) — skipping fetch`);
	process.exit(0);
}

console.log(`Downloading OpenCV.js ${version}\n  ${url}`);
const res = await fetch(url, { headers: { Accept: "*/*" } });
if (!res.ok) {
	console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
	process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length < 1_000_000) {
	console.error(`Downloaded file is suspiciously small (${buf.length} bytes) — aborting`);
	process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, buf);
console.log(`opencv.js (${(buf.length / 1e6).toFixed(1)} MB) -> dwc/DuetToolAlign/opencv.js`);
