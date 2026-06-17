import { describe, expect, it } from "vitest";

import { computeCorrection } from "../cv/alignLoop";
import { apply2, type Mat2, magnitude, sub, type Vec2 } from "../cv/geometry";

const K: Mat2 = { a: 0.02, b: 0, c: 0, d: 0.02 }; // 50 px/mm, axis-aligned

describe("computeCorrection", () => {
	const centre: Vec2 = { x: 320, y: 240 };

	it("reports within-tolerance and zero jog when already centred", () => {
		const c = computeCorrection({ x: 320.5, y: 240 }, centre, K, { tolPx: 1 });
		expect(c.withinTol).toBe(true);
		expect(c.mm).toEqual({ x: 0, y: 0 });
	});

	it("jogs toward the centre (correct sign) scaled by gain", () => {
		// Nozzle 100 px right of centre → must move so the image goes left; with K positive and
		// errPx = centre - current = -100 px x, mm = K·errPx = -2 mm, ×gain 0.8 = -1.6.
		const c = computeCorrection({ x: 420, y: 240 }, centre, K, { gain: 0.8, maxStepMm: 5, tolPx: 1 });
		expect(c.withinTol).toBe(false);
		expect(c.mm.x).toBeCloseTo(-1.6, 5);
		expect(c.mm.y).toBeCloseTo(0, 5);
		expect(c.errorPx).toBeCloseTo(100, 5);
	});

	it("clamps the per-axis step", () => {
		const c = computeCorrection({ x: 1320, y: 240 }, centre, K, { gain: 1, maxStepMm: 2, tolPx: 1 });
		expect(Math.abs(c.mm.x)).toBeLessThanOrEqual(2);
	});

	it("converges when iterated against a simulated camera", () => {
		// Simulate: applying a machine jog of `mm` moves the nozzle pixel by K⁻¹·mm.
		const det = K.a * K.d - K.b * K.c;
		const invK: Mat2 = { a: K.d / det, b: -K.b / det, c: -K.c / det, d: K.a / det };
		let px: Vec2 = { x: 120, y: 400 };
		for (let i = 0; i < 50; i++) {
			const c = computeCorrection(px, centre, K, { gain: 0.8, maxStepMm: 5, tolPx: 1 });
			if (c.withinTol) break;
			const pxDelta = apply2(invK, c.mm); // pixel shift produced by the machine move
			px = { x: px.x + pxDelta.x, y: px.y + pxDelta.y };
		}
		expect(magnitude(sub(px, centre))).toBeLessThanOrEqual(1);
	});
});
