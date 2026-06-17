/**
 * Pixel→mm calibration (pure maths, no OpenCV).
 *
 * During calibration we command a set of known machine XY moves around a start point and detect the
 * nozzle's pixel position at each. Every sample is therefore a pair (commanded mm displacement,
 * observed pixel displacement) relative to the start. We solve the 2×2 matrix K mapping a pixel
 * displacement to the machine mm displacement that produced it:
 *
 *     mm ≈ K · px
 *
 * K is exactly the transform the alignment loop needs at runtime (observed pixel error → mm jog),
 * and being a full 2×2 it absorbs the camera's scale, rotation and any axis skew. Solved by linear
 * least squares (normal equations): K = (Σ mm·pxᵀ)(Σ px·pxᵀ)⁻¹.
 *
 * Outliers (e.g. a misdetection) are rejected first by comparing each sample's pixels-per-mm scale
 * against the median and dropping those beyond a tolerance, mirroring kTAMV's filtering.
 */
import { apply2, type Mat2, magnitude, sub, type Vec2 } from "./geometry";

/**
 * Waypoints (offsets from the start point, in mm) for the calibration jog: an 8-point star around
 * the origin. Detecting the nozzle at the origin plus these eight gives a well-conditioned,
 * redundant set for the 2×2 least-squares solve while keeping every move small (so the nozzle stays
 * in frame). The caller detects at (0,0) first, then visits each of these and returns.
 */
export function calibrationPattern(stepMm: number): Array<Vec2> {
	const s = stepMm;
	return [
		{ x: s, y: 0 },
		{ x: s, y: s },
		{ x: 0, y: s },
		{ x: -s, y: s },
		{ x: -s, y: 0 },
		{ x: -s, y: -s },
		{ x: 0, y: -s },
		{ x: s, y: -s },
	];
}

export interface CalibrationSample {
	/** Commanded machine displacement from the start point, in mm. */
	mm: Vec2;
	/** Observed nozzle pixel displacement from the start detection. */
	px: Vec2;
}

export interface CalibrationResult {
	ok: boolean;
	/** mm-per-pixel transform (K above), usable directly by the alignment loop. */
	mmPerPx?: Mat2;
	/** RMS reprojection residual in mm across the kept samples. */
	residualMm?: number;
	/** Samples kept after outlier rejection. */
	used?: number;
	/** Samples discarded as outliers. */
	rejected?: number;
	error?: string;
}

function median(values: Array<number>): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Drop samples whose pixels-per-mm scale deviates from the median by more than `tol` (fractional,
 * default 0.2 = 20%). Samples with a near-zero mm or px move can't yield a meaningful scale and are
 * skipped from the median but kept (they still constrain the solve cheaply); in practice callers
 * pass non-trivial moves. Returns a new array.
 */
export function filterOutliers(samples: Array<CalibrationSample>, tol = 0.2): Array<CalibrationSample> {
	const scales: Array<number> = [];
	for (const s of samples) {
		const mmMag = magnitude(s.mm);
		const pxMag = magnitude(s.px);
		if (mmMag > 1e-6 && pxMag > 1e-6) scales.push(pxMag / mmMag);
	}
	if (scales.length < 2) return [...samples];
	const med = median(scales);
	if (med <= 0) return [...samples];
	return samples.filter((s) => {
		const mmMag = magnitude(s.mm);
		const pxMag = magnitude(s.px);
		if (mmMag <= 1e-6 || pxMag <= 1e-6) return false;
		const scale = pxMag / mmMag;
		return Math.abs(scale - med) / med <= tol;
	});
}

/** Solve K (mm-per-pixel) by least squares: K = (Σ mm·pxᵀ)(Σ px·pxᵀ)⁻¹. */
function solveMmPerPx(samples: Array<CalibrationSample>): Mat2 | null {
	// Σ px·pxᵀ (symmetric 2×2) and Σ mm·pxᵀ (2×2).
	let sxx = 0, sxy = 0, syy = 0;
	let mxx = 0, mxy = 0, myx = 0, myy = 0;
	for (const { mm, px } of samples) {
		sxx += px.x * px.x;
		sxy += px.x * px.y;
		syy += px.y * px.y;
		mxx += mm.x * px.x;
		mxy += mm.x * px.y;
		myx += mm.y * px.x;
		myy += mm.y * px.y;
	}
	const det = sxx * syy - sxy * sxy;
	if (Math.abs(det) < 1e-9) return null;
	const inv = 1 / det;
	// inv(Σ px·pxᵀ) = 1/det * [[syy, -sxy], [-sxy, sxx]]
	const i00 = syy * inv, i01 = -sxy * inv, i10 = -sxy * inv, i11 = sxx * inv;
	// K = (Σ mm·pxᵀ) · inv
	return {
		a: mxx * i00 + mxy * i10,
		b: mxx * i01 + mxy * i11,
		c: myx * i00 + myy * i10,
		d: myx * i01 + myy * i11,
	};
}

/** RMS of |K·px − mm| across samples, in mm. */
function residual(samples: Array<CalibrationSample>, k: Mat2): number {
	if (!samples.length) return 0;
	let sum = 0;
	for (const { mm, px } of samples) {
		const pred = apply2(k, px);
		sum += magnitude(sub(pred, mm)) ** 2;
	}
	return Math.sqrt(sum / samples.length);
}

export interface CalibrateOptions {
	/** Outlier tolerance (fractional scale deviation). Default 0.2. */
	outlierTol?: number;
	/** Minimum samples required after filtering. Default 3. */
	minSamples?: number;
}

/** Full calibration: reject outliers, solve K, report residual. */
export function calibrate(samples: Array<CalibrationSample>, opts: CalibrateOptions = {}): CalibrationResult {
	const minSamples = opts.minSamples ?? 3;
	if (samples.length < minSamples) {
		return { ok: false, error: `need at least ${minSamples} samples, got ${samples.length}` };
	}
	const used = filterOutliers(samples, opts.outlierTol ?? 0.2);
	if (used.length < minSamples) {
		return { ok: false, error: `only ${used.length} samples survived outlier rejection (need ${minSamples})` };
	}
	const k = solveMmPerPx(used);
	if (!k) {
		return { ok: false, error: "calibration is degenerate (moves were collinear or too small)" };
	}
	return {
		ok: true,
		mmPerPx: k,
		residualMm: residual(used, k),
		used: used.length,
		rejected: samples.length - used.length,
	};
}
