import { describe, expect, it } from "vitest";

import { apply2, invert2, medianPoint } from "../cv/geometry";

describe("invert2", () => {
	it("inverts a non-singular matrix", () => {
		const m = { a: 2, b: 0, c: 0, d: 4 };
		const inv = invert2(m)!;
		expect(inv.a).toBeCloseTo(0.5, 9);
		expect(inv.d).toBeCloseTo(0.25, 9);
		// M·M⁻¹ applied to a vector is identity.
		const r = apply2(m, apply2(inv, { x: 3, y: 7 }));
		expect(r.x).toBeCloseTo(3, 9);
		expect(r.y).toBeCloseTo(7, 9);
	});

	it("returns null for a singular matrix", () => {
		expect(invert2({ a: 1, b: 2, c: 2, d: 4 })).toBeNull();
	});
});

describe("medianPoint", () => {
	it("takes the per-axis median (rejecting a single spike)", () => {
		const pts = [{ x: 100, y: 50 }, { x: 101, y: 49 }, { x: 400, y: 300 }];
		expect(medianPoint(pts)).toEqual({ x: 101, y: 50 });
	});

	it("averages the middle two for an even count", () => {
		expect(medianPoint([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
	});
});
