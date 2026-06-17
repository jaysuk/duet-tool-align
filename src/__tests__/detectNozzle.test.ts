import { describe, expect, it } from "vitest";

import { ConvergenceTracker, pickLargest, pickNearestToCentre } from "../cv/detectNozzle";

describe("pickNearestToCentre", () => {
	it("returns the circle closest to the centre point", () => {
		const circles = [
			{ x: 10, y: 10, r: 5 },
			{ x: 320, y: 245, r: 8 },
			{ x: 600, y: 400, r: 6 },
		];
		const best = pickNearestToCentre(circles, { x: 320, y: 240 });
		expect(best).toEqual({ x: 320, y: 245, r: 8 });
	});

	it("returns null for no candidates", () => {
		expect(pickNearestToCentre([], { x: 0, y: 0 })).toBeNull();
	});
});

describe("pickLargest", () => {
	it("returns the circle with the greatest radius", () => {
		const circles = [
			{ x: 10, y: 10, r: 5 },
			{ x: 320, y: 240, r: 18 },
			{ x: 600, y: 400, r: 12 },
		];
		expect(pickLargest(circles)).toEqual({ x: 320, y: 240, r: 18 });
	});

	it("returns null for no candidates", () => {
		expect(pickLargest([])).toBeNull();
	});
});

describe("ConvergenceTracker", () => {
	it("locks only after N stable samples within tolerance", () => {
		const t = new ConvergenceTracker(1, 3);
		expect(t.push({ x: 100, y: 100 })).toBeNull();
		expect(t.push({ x: 100.2, y: 99.8 })).toBeNull();
		const locked = t.push({ x: 100.1, y: 100.1 });
		expect(locked).not.toBeNull();
		expect(locked!.x).toBeCloseTo(100.1, 1);
	});

	it("does not lock when a sample jumps outside tolerance", () => {
		const t = new ConvergenceTracker(1, 3);
		t.push({ x: 100, y: 100 });
		t.push({ x: 100, y: 100 });
		expect(t.push({ x: 130, y: 100 })).toBeNull();
	});

	it("reset clears history", () => {
		const t = new ConvergenceTracker(1, 2);
		t.push({ x: 5, y: 5 });
		t.reset();
		expect(t.push({ x: 5, y: 5 })).toBeNull();
	});
});
