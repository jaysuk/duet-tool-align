/**
 * Pure tool-offset maths.
 *
 * COPIED VERBATIM from Flexible-Layouts (src/util/toolAlign.ts) so this plugin computes offsets
 * identically and the eventual merge back into FL is a no-op for this module.
 *
 * Each tool's offset is taken relative to a reference tool: O_t = O_ref + s·(M_t − M_ref) per axis,
 * where M is the captured machine position and s is the (optional) inversion sign. Only axes captured
 * on BOTH the reference and the tool contribute, so XY (from the camera) and Z (from a switch/probe)
 * can be calibrated independently.
 */

export interface AxisCapture {
	x?: number;
	y?: number;
	z?: number;
}

export interface ToolOffset {
	x?: number;
	y?: number;
	z?: number;
}

/** Compute a tool's offset relative to the reference, carrying the reference's existing G10 offset. */
export function computeToolOffset(
	ref: AxisCapture,
	tool: AxisCapture,
	refOffset: ToolOffset,
	invert: boolean,
): ToolOffset {
	const s = invert ? -1 : 1;
	const out: ToolOffset = {};
	const axes: Array<keyof AxisCapture> = ["x", "y", "z"];
	for (const axis of axes) {
		const r = ref[axis];
		const t = tool[axis];
		if (typeof r === "number" && typeof t === "number") {
			out[axis] = (refOffset[axis] ?? 0) + s * (t - r);
		}
	}
	return out;
}

/** Build a `G10 P<tool> [X..] [Y..] [Z..]` command, or null when no axis is set. */
export function formatG10(toolNumber: number, off: ToolOffset, precision = 3): string | null {
	const parts: Array<string> = [];
	if (typeof off.x === "number") parts.push(`X${off.x.toFixed(precision)}`);
	if (typeof off.y === "number") parts.push(`Y${off.y.toFixed(precision)}`);
	if (typeof off.z === "number") parts.push(`Z${off.z.toFixed(precision)}`);
	return parts.length ? `G10 P${toolNumber} ${parts.join(" ")}` : null;
}
