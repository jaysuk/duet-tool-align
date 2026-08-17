/**
 * Pure tool-offset maths.
 *
 * Originally copied verbatim from Flexible-Layouts (src/util/toolAlign.ts); FL's copy has the same
 * sign bug fixed here (see below) and needs the identical fix for that merge to stay a no-op.
 *
 * Each tool's offset is taken relative to a reference tool: O_t = O_ref + s·(M_ref − M_t) per axis,
 * where M is the captured machine position and s is the (optional) inversion sign. Only axes captured
 * on BOTH the reference and the tool contribute, so XY (from the camera) and Z (from a switch/probe)
 * can be calibrated independently.
 *
 * Sign, worked from RepRapFirmware's own G10 docs ("tool offsets are... subtracted from the required
 * printing locations during printing", i.e. machinePosition = commandedPosition − toolOffset):
 * picture tool 1 mounted 5mm further toward +X than the reference tool. Centred on the same physical
 * point, the reference reads machine X=100 and tool 1 reads X=95 (it needs 5mm less carriage travel,
 * since its nozzle already sticks out that much further). Commanding X=100 with tool 1 active must
 * land the carriage at X=95, so 95 = 100 − offset ⟹ offset = +5 = M_ref − M_t, not M_t − M_ref. The
 * previous (M_t − M_ref) default produced the offset with the sign backwards for every alignment run
 * unless "Invert offsets" was manually ticked to compensate.
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
			out[axis] = (refOffset[axis] ?? 0) + s * (r - t);
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
