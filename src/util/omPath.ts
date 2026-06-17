/**
 * Minimal object-model path resolver — `resolveOmPath(model, "move.axes")` walks dotted paths and
 * numeric array indices, returning `undefined` for any missing segment. Mirrors the helper used by
 * Flexible-Layouts' widgets so the eventual merge is seamless. Pure and dependency-free.
 */
export function resolveOmPath(root: unknown, path: string): unknown {
	if (!path) return root;
	let cur: unknown = root;
	for (const rawKey of path.split(".")) {
		const key = rawKey.trim();
		if (key === "") continue;
		if (cur == null) return undefined;
		if (Array.isArray(cur)) {
			const idx = Number(key);
			cur = Number.isInteger(idx) ? cur[idx] : undefined;
		} else if (typeof cur === "object") {
			cur = (cur as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return cur;
}
