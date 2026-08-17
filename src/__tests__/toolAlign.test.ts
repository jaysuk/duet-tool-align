import { describe, expect, it } from "vitest";

import { computeToolOffset, formatG10 } from "../util/toolAlign";

describe("computeToolOffset", () => {
	// Anchored to RepRapFirmware's own G10 docs: "tool offsets are... subtracted from the required
	// printing locations during printing", i.e. machinePosition = commandedPosition - toolOffset.
	// Scenario: tool 1 is mounted 5mm further toward +X than the reference tool. Centred on the same
	// physical point, the reference reads machine X=100 and tool 1 reads X=95 (needs 5mm less carriage
	// travel, since its nozzle already sticks out that much further). Commanding X=100 with tool 1
	// active must land the carriage at X=95, so 95 = 100 - offset => offset = +5. Getting this sign
	// backwards means every alignment run offsets every non-reference tool the wrong direction.
	it("offsets a tool mounted further toward +X with a positive X offset", () => {
		const ref = { x: 100, y: 50 };
		const tool = { x: 95, y: 50 };
		const off = computeToolOffset(ref, tool, { x: 0, y: 0 }, false);
		expect(off.x).toBeCloseTo(5, 9);
		expect(off.y).toBeCloseTo(0, 9);
	});

	it("a tool mounted further toward -X gets a negative X offset", () => {
		const ref = { x: 100, y: 50 };
		const tool = { x: 106, y: 50 };
		const off = computeToolOffset(ref, tool, { x: 0, y: 0 }, false);
		expect(off.x).toBeCloseTo(-6, 9);
	});

	it("the reference tool relative to itself is zero", () => {
		const p = { x: 42, y: -17 };
		const off = computeToolOffset(p, p, { x: 0, y: 0 }, false);
		expect(off.x).toBeCloseTo(0, 9);
		expect(off.y).toBeCloseTo(0, 9);
	});

	it("carries the reference tool's own existing offset through additively", () => {
		const ref = { x: 100, y: 50 };
		const tool = { x: 95, y: 55 };
		const off = computeToolOffset(ref, tool, { x: 10, y: -2 }, false);
		expect(off.x).toBeCloseTo(15, 9); // 10 + (100 - 95)
		expect(off.y).toBeCloseTo(-7, 9); // -2 + (50 - 55)
	});

	it("invert flips the sign back (escape hatch, not the default)", () => {
		const ref = { x: 100, y: 50 };
		const tool = { x: 95, y: 50 };
		const off = computeToolOffset(ref, tool, { x: 0, y: 0 }, true);
		expect(off.x).toBeCloseTo(-5, 9);
	});

	it("only populates an axis captured on both sides", () => {
		const off = computeToolOffset({ x: 100 }, { x: 95, z: 12 }, {}, false);
		expect(off.x).toBeCloseTo(5, 9);
		expect(off.y).toBeUndefined();
		expect(off.z).toBeUndefined();
	});
});

describe("formatG10", () => {
	it("builds a G10 command with only the captured axes", () => {
		expect(formatG10(2, { x: 17.8, y: -19.3 })).toBe("G10 P2 X17.800 Y-19.300");
	});

	it("returns null when no axis is set", () => {
		expect(formatG10(2, {})).toBeNull();
	});
});
