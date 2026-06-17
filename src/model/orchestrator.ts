/**
 * Motion + detection orchestration for calibration and auto-centring.
 *
 * Decoupled from Vue and from OpenCV behind two injected seams:
 *   - MachineIO: send G-code + read machine axis positions (the Vue layer wires this to DWC's
 *     machine store; tests pass a fake that records every sent code).
 *   - DetectOnce: grab one frame and return the nozzle's pixel centre (or null). The Vue layer wires
 *     this to grabFrame + OpenCV; tests script a sequence of fake detections.
 *
 * This is where the actual G-code is produced, so the test-kit's "assert the exact codes" style
 * covers the motion contract (relative jogs wrapped in M120/M121, finished with M400).
 */
import { calibrate, type CalibrationResult, calibrationPattern, type CalibrationSample } from "../cv/calibrate";
import { computeCorrection } from "../cv/alignLoop";
import type { Mat2, Vec2 } from "../cv/geometry";

export interface MachineIO {
	sendCode(code: string): Promise<unknown>;
	machinePos(letter: "X" | "Y" | "Z"): number | null;
}

/** Grab one frame and detect the nozzle pixel centre; null when nothing was found this frame. */
export type DetectOnce = () => Promise<Vec2 | null>;

export interface MotionParams {
	jogFeed: number;
	settleMs: number;
	tolerancePx: number;
	gain: number;
	maxStepMm: number;
	maxIterations: number;
	calibStepMm: number;
	/** Returns true to abort in-progress loops promptly (wired to the Stop button). */
	shouldAbort?: () => boolean;
}

/** Hook for progress/status reporting to the UI. */
export interface ProgressSink {
	status?: (message: string) => void;
	detection?: (px: Vec2 | null) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Relative XY jog wrapped to preserve absolute mode and finished with M400 so motion completes. */
export function jogCode(dx: number, dy: number, feed: number): string {
	return `M120\nG91\nG1 X${dx.toFixed(4)} Y${dy.toFixed(4)} F${feed}\nG90\nM121\nM400`;
}

async function jog(io: MachineIO, dx: number, dy: number, params: MotionParams): Promise<void> {
	if (dx === 0 && dy === 0) return;
	await io.sendCode(jogCode(dx, dy, params.jogFeed));
	if (params.settleMs > 0) await sleep(params.settleMs);
}

/**
 * Detect the nozzle and require it to be stable: take up to `attempts` frames, locking once
 * `samples` consecutive detections lie within `tolPx` of their mean (delegated to ConvergenceTracker
 * via repeated detect calls here for simplicity). Returns the locked centre or null on timeout.
 */
export async function detectStable(
	detectOnce: DetectOnce,
	opts: { tolPx: number; samples?: number; attempts?: number; shouldAbort?: () => boolean },
	progress?: ProgressSink,
): Promise<Vec2 | null> {
	const samples = opts.samples ?? 3;
	const attempts = opts.attempts ?? 30;
	const history: Array<Vec2> = [];
	for (let i = 0; i < attempts; i++) {
		if (opts.shouldAbort?.()) return null;
		const p = await detectOnce();
		progress?.detection?.(p);
		if (!p) {
			history.length = 0;
			continue;
		}
		history.push(p);
		if (history.length > samples) history.shift();
		if (history.length === samples) {
			const mean = history.reduce((a, q) => ({ x: a.x + q.x / samples, y: a.y + q.y / samples }), { x: 0, y: 0 });
			if (history.every((q) => Math.hypot(q.x - mean.x, q.y - mean.y) <= opts.tolPx)) {
				return mean;
			}
		}
	}
	return null;
}

/**
 * Run the calibration jog star from the current position. Detects at the origin, then visits each
 * star waypoint (incremental jogs), detecting at each, and returns to the origin. Builds
 * (mm, px-displacement) samples and solves the transform.
 */
export async function runCalibration(
	io: MachineIO,
	detectOnce: DetectOnce,
	params: MotionParams,
	progress?: ProgressSink,
): Promise<CalibrationResult> {
	const abort = params.shouldAbort;
	progress?.status?.("Detecting nozzle at start…");
	if (params.settleMs > 0) await sleep(params.settleMs);
	const origin = await detectStable(detectOnce, { tolPx: params.tolerancePx, shouldAbort: abort }, progress);
	if (abort?.()) return { ok: false, error: "aborted" };
	if (!origin) return { ok: false, error: "could not lock onto the nozzle at the start position" };

	const waypoints = calibrationPattern(params.calibStepMm);
	const samples: Array<CalibrationSample> = [];
	let current: Vec2 = { x: 0, y: 0 }; // current offset from start, in mm

	for (let i = 0; i < waypoints.length; i++) {
		if (abort?.()) break;
		const wp = waypoints[i];
		progress?.status?.(`Calibrating ${i + 1}/${waypoints.length}…`);
		await jog(io, wp.x - current.x, wp.y - current.y, params);
		current = wp;
		const px = await detectStable(detectOnce, { tolPx: params.tolerancePx, shouldAbort: abort }, progress);
		if (px) {
			samples.push({ mm: { x: wp.x, y: wp.y }, px: { x: px.x - origin.x, y: px.y - origin.y } });
		}
	}

	// Always return to the start point, even if some detections failed or we aborted.
	await jog(io, -current.x, -current.y, params);
	if (abort?.()) return { ok: false, error: "aborted" };
	progress?.status?.("Solving calibration…");
	return calibrate(samples);
}

export interface CentreResult {
	ok: boolean;
	/** Machine XY at convergence. */
	position?: { x: number; y: number };
	iterations: number;
	error?: string;
}

/**
 * Iteratively jog the (already-selected) tool so its nozzle sits on the frame centre, using the
 * calibrated transform. Stops when the pixel error is within tolerance, returning the machine XY,
 * or fails after `maxIterations`.
 */
export async function centreTool(
	io: MachineIO,
	detectOnce: DetectOnce,
	k: Mat2,
	frameCentre: Vec2,
	params: MotionParams,
	progress?: ProgressSink,
): Promise<CentreResult> {
	for (let i = 0; i < params.maxIterations; i++) {
		if (params.shouldAbort?.()) return { ok: false, iterations: i, error: "aborted" };
		const px = await detectStable(detectOnce, { tolPx: params.tolerancePx, shouldAbort: params.shouldAbort }, progress);
		if (!px) return { ok: false, iterations: i, error: params.shouldAbort?.() ? "aborted" : "lost the nozzle during centring" };

		const corr = computeCorrection(px, frameCentre, k, {
			gain: params.gain,
			maxStepMm: params.maxStepMm,
			tolPx: params.tolerancePx,
		});
		progress?.status?.(`Centring: ${corr.errorPx.toFixed(1)} px error (iter ${i + 1})`);
		if (corr.withinTol) {
			const x = io.machinePos("X");
			const y = io.machinePos("Y");
			if (x == null || y == null) return { ok: false, iterations: i, error: "machine position unavailable" };
			return { ok: true, position: { x, y }, iterations: i };
		}
		await jog(io, corr.mm.x, corr.mm.y, params);
	}
	return { ok: false, iterations: params.maxIterations, error: "did not converge within the iteration limit" };
}
