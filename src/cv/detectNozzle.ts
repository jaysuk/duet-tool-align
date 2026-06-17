/**
 * Nozzle detection.
 *
 * The OpenCV-dependent pipeline (`detectCircles`) takes the loaded `cv` module as an argument so the
 * pure post-processing — picking the circle nearest frame centre and the multi-frame convergence
 * tracker — is unit-testable without WASM. The pipeline mirrors kTAMV: try several
 * detector/preprocessor combinations (Hough on a blurred grayscale at a few sensitivities, plus an
 * adaptive-threshold variant) and gather every candidate circle; the caller picks the best.
 */
import { magnitude, sub, type Vec2 } from "./geometry";

export interface Circle {
	x: number;
	y: number;
	r: number;
}

/** Pick the candidate circle whose centre is nearest `centre` (default: image centre passed in). */
export function pickNearestToCentre(circles: Array<Circle>, centre: Vec2): Circle | null {
	let best: Circle | null = null;
	let bestDist = Infinity;
	for (const c of circles) {
		const d = magnitude(sub({ x: c.x, y: c.y }, centre));
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	}
	return best;
}

/** Pick the largest candidate circle (the nozzle bore is usually the dominant circular feature). */
export function pickLargest(circles: Array<Circle>): Circle | null {
	let best: Circle | null = null;
	for (const c of circles) {
		if (!best || c.r > best.r) best = c;
	}
	return best;
}

/** Tunable HoughCircles parameters passed from the UI to the detector. */
export interface DetectParams {
	minRadius: number;
	maxRadius: number;
	dp: number;
	param1: number;
	param2: number;
	/** 0 = auto (min(w,h)/8). */
	minDist: number;
	/** Median blur kernel; 0/1 = none. */
	blur: number;
	/** Downscale width; 0 = none. */
	detectWidth: number;
}

/**
 * Tracks detections across frames and reports a lock once the centre has been stable: the last
 * `samples` detections all lie within `tolPx` of their running mean. Mirrors kTAMV's "same point N
 * times within a pixel" convergence test, which rejects jitter and transient misdetections.
 */
export class ConvergenceTracker {
	private readonly history: Array<Vec2> = [];

	constructor(private readonly tolPx = 1, private readonly samples = 3) {}

	reset(): void {
		this.history.length = 0;
	}

	/** Feed a detection; returns the locked centre (mean) once stable, else null. */
	push(point: Vec2): Vec2 | null {
		this.history.push(point);
		if (this.history.length > this.samples) this.history.shift();
		if (this.history.length < this.samples) return null;
		const mean = this.history.reduce(
			(acc, p) => ({ x: acc.x + p.x / this.samples, y: acc.y + p.y / this.samples }),
			{ x: 0, y: 0 },
		);
		const stable = this.history.every((p) => magnitude(sub(p, mean)) <= this.tolPx);
		return stable ? mean : null;
	}
}

export interface DetectOptions {
	/** Min/max nozzle radius in pixels to accept. Defaults span a wide range. */
	minRadius?: number;
	maxRadius?: number;
}

/**
 * Minimal structural type for the bits of the OpenCV.js module we use. Keeps this file free of an
 * `any`-typed global and documents the contract; the real module satisfies it at runtime.
 */
export interface CvLike {
	matFromImageData(img: ImageData): CvMat;
	cvtColor(src: CvMat, dst: CvMat, code: number): void;
	medianBlur(src: CvMat, dst: CvMat, ksize: number): void;
	HoughCircles(
		image: CvMat,
		circles: CvMat,
		method: number,
		dp: number,
		minDist: number,
		param1: number,
		param2: number,
		minRadius: number,
		maxRadius: number,
	): void;
	Mat: { new (): CvMat };
	COLOR_RGBA2GRAY: number;
	HOUGH_GRADIENT: number;
}

export interface CvMat {
	cols: number;
	rows: number;
	data32F: Float32Array;
	delete(): void;
}

interface HoughParams {
	dp: number;
	param1: number;
	param2: number;
}

// A few sensitivities: lower param2 finds weaker/blurrier circles (more false positives), higher is
// stricter. Running several and pooling the candidates is what lets the nearest-to-centre pick lock
// onto the nozzle across varied lighting/focus, as kTAMV does.
const HOUGH_PASSES: ReadonlyArray<HoughParams> = [
	{ dp: 1, param1: 100, param2: 60 },
	{ dp: 1, param1: 100, param2: 40 },
	{ dp: 1.5, param1: 80, param2: 30 },
];

/**
 * Run the detector pipeline over one frame and return every candidate circle (pooled across passes).
 * Frees all intermediate Mats. The caller typically feeds the result to {@link pickNearestToCentre}.
 */
export function detectCircles(cv: CvLike, img: ImageData, opts: DetectOptions = {}): Array<Circle> {
	const minR = opts.minRadius ?? 5;
	const maxR = opts.maxRadius ?? Math.floor(Math.min(img.width, img.height) / 2);
	const minDist = Math.max(20, Math.floor(Math.min(img.width, img.height) / 8));

	const src = cv.matFromImageData(img);
	const gray = new cv.Mat();
	const blurred = new cv.Mat();
	const found: Array<Circle> = [];
	try {
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		cv.medianBlur(gray, blurred, 5);
		for (const p of HOUGH_PASSES) {
			const circles = new cv.Mat();
			try {
				cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, p.dp, minDist, p.param1, p.param2, minR, maxR);
				for (let i = 0; i < circles.cols; i++) {
					const base = i * 3;
					found.push({
						x: circles.data32F[base],
						y: circles.data32F[base + 1],
						r: circles.data32F[base + 2],
					});
				}
			} finally {
				circles.delete();
			}
		}
	} finally {
		src.delete();
		gray.delete();
		blurred.delete();
	}
	return found;
}

/** Convenience: detect and immediately reduce to the single best (nearest-centre) circle, or null. */
export function detectNozzle(cv: CvLike, img: ImageData, opts: DetectOptions = {}): Circle | null {
	const centre: Vec2 = { x: img.width / 2, y: img.height / 2 };
	return pickNearestToCentre(detectCircles(cv, img, opts), centre);
}
