#!/usr/bin/env node
/**
 * Pick the GitHub Release title for a version: `vX.Y.Z — "<pun>"`.
 *
 * Titles come from scripts/release-titles.txt (one per line). The version's position among all
 * semver-sorted `v*` tags is its index into that list (wrapping if it runs out), so each release gets
 * a stable, distinct title with no per-release bookkeeping. The release workflow uses the output as the
 * Release name; run it locally to preview: `node scripts/release-title.mjs [vX.Y.Z]`.
 *
 * Flags: `--remaining` prints just how many unused titles are left after this one (for low-list checks).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Warn (here and in the workflow) once this few unused titles remain, so the list gets topped up.
export const LOW_TITLES_THRESHOLD = 5;

function git(args) {
	try {
		return execFileSync("git", args, { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

const ver = (v) => v.replace(/^v/, "").trim();

// semver-ish compare: numeric segment-by-segment; a release (1.0.0) sorts after its prerelease (1.0.0-rc).
function cmp(a, b) {
	const pa = ver(a).split(/[.-]/);
	const pb = ver(b).split(/[.-]/);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? "";
		const y = pb[i] ?? "";
		const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
		if (nx && ny) {
			if (+x !== +y) return +x - +y;
		} else if (x !== y) {
			if (x === "") return 1;
			if (y === "") return -1;
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/** Resolve the title + list stats for a version (defaults to plugin.json's version). */
export function pickTitle(version) {
	const titles = readFileSync(join(here, "release-titles.txt"), "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));

	const current = ver(
		version || process.env.GITHUB_REF_NAME || JSON.parse(readFileSync(join(here, "..", "plugin.json"), "utf8")).version,
	);

	const tags = git(["tag", "-l", "v*"]).split("\n").map((t) => ver(t)).filter(Boolean);
	if (!tags.includes(current)) tags.push(current);
	tags.sort(cmp);
	const idx = tags.indexOf(current);

	const title = titles.length ? titles[idx % titles.length] : "";
	return {
		version: current,
		title,
		label: title ? `v${current} — "${title}"` : `v${current}`,
		index: idx,
		total: titles.length,
		remaining: Math.max(0, titles.length - 1 - idx),
	};
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const args = process.argv.slice(2);
	const remainingOnly = args.includes("--remaining");
	const version = args.find((a) => !a.startsWith("-"));
	const r = pickTitle(version);

	if (remainingOnly) {
		process.stdout.write(String(r.remaining));
	} else {
		if (r.remaining <= LOW_TITLES_THRESHOLD) {
			process.stderr.write(
				`⚠️  Only ${r.remaining} unused release title(s) left after this one — add more to scripts/release-titles.txt (it wraps around for now).\n`,
			);
		}
		process.stdout.write(r.label);
	}
}
