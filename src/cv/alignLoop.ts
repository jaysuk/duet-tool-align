/**
 * Auto-centring control maths (pure, no OpenCV).
 *
 * Given the nozzle's detected pixel position, the target pixel (frame centre) and the calibrated
 * mm-per-pixel transform K, compute the machine XY jog that nulls the error. The nozzle's image must
 * move from `current` to `target`, i.e. a pixel displacement of (target − current); the machine move
 * that produces a pixel displacement d is mm = K·d. A proportional gain (<1) damps overshoot from
 * backlash / detection noise, and the step is clamped so a bad detection can't fling the toolhead.
 */
import { apply2, magnitude, type Mat2, sub, type Vec2 } from "./geometry";

export interface CorrectionOptions {
	/** Proportional gain applied to the computed jog. Default 0.8. */
	gain?: number;
	/** Max single-axis jog in mm (clamp). Default 2. */
	maxStepMm?: number;
	/** Pixel error magnitude under which we consider the nozzle centred. Default 1. */
	tolPx?: number;
}

export interface Correction {
	/** Machine XY jog to apply this iteration, in mm. */
	mm: Vec2;
	/** Pixel error magnitude before this correction. */
	errorPx: number;
	/** True when the nozzle is within tolerance (no meaningful jog needed). */
	withinTol: boolean;
}

function clamp(v: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, v));
}

/**
 * Compute the jog to move the nozzle from `current` pixel toward `target` pixel using transform `k`.
 * When already within `tolPx` the returned jog is zero and `withinTol` is true.
 */
export function computeCorrection(
	current: Vec2,
	target: Vec2,
	k: Mat2,
	opts: CorrectionOptions = {},
): Correction {
	const gain = opts.gain ?? 0.8;
	const maxStep = opts.maxStepMm ?? 2;
	const tolPx = opts.tolPx ?? 1;

	const errPx = sub(target, current);
	const errorPx = magnitude(errPx);
	if (errorPx <= tolPx) {
		return { mm: { x: 0, y: 0 }, errorPx, withinTol: true };
	}
	const raw = apply2(k, errPx);
	return {
		mm: { x: clamp(raw.x * gain, maxStep), y: clamp(raw.y * gain, maxStep) },
		errorPx,
		withinTol: false,
	};
}
