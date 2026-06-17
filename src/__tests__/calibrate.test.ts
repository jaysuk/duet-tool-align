import { describe, expect, it } from "vitest";

import { apply2, type Mat2 } from "../cv/geometry";
import { calibrate, calibrationPattern, type CalibrationSample, filterOutliers } from "../cv/calibrate";

// A known camera transform: mm = K · px. We synthesise pixel samples by inverting it (px = K⁻¹·mm)
// for a set of commanded mm moves, then check calibrate() recovers K.
const K: Mat2 = { a: 0.02, b: 0.001, c: -0.0015, d: 0.021 }; // ~50 px/mm, slight rotation

function pxForMm(mm: { x: number; y: number }): { x: number; y: number } {
	// Invert K analytically.
	const det = K.a * K.d - K.b * K.c;
	const inv: Mat2 = { a: K.d / det, b: -K.b / det, c: -K.c / det, d: K.a / det };
	return apply2(inv, mm);
}

function sampleFor(mx: number, my: number): CalibrationSample {
	return { mm: { x: mx, y: my }, px: pxForMm({ x: mx, y: my }) };
}

describe("calibrationPattern", () => {
	it("returns 8 non-origin waypoints scaled by the step", () => {
		const pts = calibrationPattern(0.5);
		expect(pts).toHaveLength(8);
		expect(pts).toContainEqual({ x: 0.5, y: 0 });
		expect(pts).toContainEqual({ x: -0.5, y: -0.5 });
		expect(pts.every((p) => !(p.x === 0 && p.y === 0))).toBe(true);
	});
});

describe("calibrate", () => {
	it("recovers the transform from clean samples", () => {
		const samples = calibrationPattern(0.5).map((p) => sampleFor(p.x, p.y));
		const res = calibrate(samples);
		expect(res.ok).toBe(true);
		expect(res.mmPerPx!.a).toBeCloseTo(K.a, 4);
		expect(res.mmPerPx!.b).toBeCloseTo(K.b, 4);
		expect(res.mmPerPx!.c).toBeCloseTo(K.c, 4);
		expect(res.mmPerPx!.d).toBeCloseTo(K.d, 4);
		expect(res.residualMm!).toBeLessThan(1e-6);
	});

	it("rejects an outlier sample and still solves", () => {
		const samples = calibrationPattern(0.5).map((p) => sampleFor(p.x, p.y));
		samples.push({ mm: { x: 0.5, y: 0.5 }, px: { x: 400, y: -380 } }); // wild misdetection
		const res = calibrate(samples);
		expect(res.ok).toBe(true);
		expect(res.rejected!).toBeGreaterThanOrEqual(1);
		expect(res.mmPerPx!.a).toBeCloseTo(K.a, 3);
	});

	it("fails with too few samples", () => {
		expect(calibrate([sampleFor(0.5, 0)]).ok).toBe(false);
	});

	it("fails when moves are collinear (degenerate)", () => {
		const samples = [sampleFor(0.1, 0), sampleFor(0.2, 0), sampleFor(0.3, 0), sampleFor(0.4, 0)];
		expect(calibrate(samples).ok).toBe(false);
	});
});

describe("filterOutliers", () => {
	it("keeps consistent samples and drops the deviant one", () => {
		const good = calibrationPattern(0.5).map((p) => sampleFor(p.x, p.y));
		const bad = { mm: { x: 0.5, y: 0 }, px: { x: 5, y: 0 } }; // scale ~10 px/mm vs ~50
		const kept = filterOutliers([...good, bad]);
		expect(kept).not.toContainEqual(bad);
		expect(kept.length).toBe(good.length);
	});
});
