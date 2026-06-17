import { describe, expect, it, vi } from "vitest";

import { apply2, type Mat2, type Vec2 } from "../cv/geometry";
import { centreTool, detectStable, jogCode, type MachineIO, runCalibration } from "../model/orchestrator";

const params = {
	jogFeed: 1200,
	settleMs: 0, // no real waiting in tests
	tolerancePx: 1,
	gain: 0.8,
	maxStepMm: 5,
	maxIterations: 30,
	calibStepMm: 0.5,
};

/** A fake machine that records every code and tracks an XY position updated by relative jogs. */
function fakeMachine(): MachineIO & { codes: Array<string>; pos: { x: number; y: number } } {
	const state = { x: 100, y: 50 };
	const codes: Array<string> = [];
	return {
		codes,
		pos: state,
		sendCode: vi.fn(async (code: string) => {
			codes.push(code);
			// Parse a relative jog (G91 ... G1 X.. Y..) to update the tracked position.
			const m = code.match(/G1 X(-?\d+\.?\d*) Y(-?\d+\.?\d*)/);
			if (m && code.includes("G91")) {
				state.x += parseFloat(m[1]);
				state.y += parseFloat(m[2]);
			}
		}),
		machinePos: (l) => (l === "X" ? state.x : l === "Y" ? state.y : 0),
	};
}

describe("jogCode", () => {
	it("wraps a relative move and finishes with M400", () => {
		const code = jogCode(0.5, -0.25, 1200);
		expect(code).toContain("G91");
		expect(code).toContain("G1 X0.5000 Y-0.2500 F1200");
		expect(code).toContain("G90");
		expect(code.trim().endsWith("M400")).toBe(true);
	});
});

describe("detectStable", () => {
	it("locks once three detections agree", async () => {
		const seq = [{ x: 50, y: 50 }, { x: 50.1, y: 49.9 }, { x: 50, y: 50.1 }];
		let i = 0;
		const detect = vi.fn(async () => seq[Math.min(i++, seq.length - 1)]);
		const locked = await detectStable(detect, { tolPx: 1 });
		expect(locked).not.toBeNull();
		expect(locked!.x).toBeCloseTo(50, 0);
	});

	it("returns null when detections never stabilise", async () => {
		let i = 0;
		const detect = vi.fn(async () => ({ x: (i++ % 2) * 100, y: 0 }));
		expect(await detectStable(detect, { tolPx: 1, attempts: 6 })).toBeNull();
	});
});

describe("runCalibration", () => {
	it("visits the star, returns to origin, and solves a sane transform", async () => {
		const io = fakeMachine();
		const K: Mat2 = { a: 0.02, b: 0, c: 0, d: 0.02 };
		const det = K.a * K.d - K.b * K.c;
		const invK: Mat2 = { a: K.d / det, b: -K.b / det, c: -K.c / det, d: K.a / det };
		const startMachine = { x: io.pos.x, y: io.pos.y };
		// Detector reports pixel = centre + invK·(machineOffsetFromStart).
		const detect = vi.fn(async (): Promise<Vec2> => {
			const offMm = { x: io.pos.x - startMachine.x, y: io.pos.y - startMachine.y };
			const px = apply2(invK, offMm);
			return { x: 320 + px.x, y: 240 + px.y };
		});

		const res = await runCalibration(io, detect, params);
		expect(res.ok).toBe(true);
		expect(res.mmPerPx!.a).toBeCloseTo(0.02, 3);

		// Ended back at the start position.
		expect(io.pos.x).toBeCloseTo(startMachine.x, 6);
		expect(io.pos.y).toBeCloseTo(startMachine.y, 6);
		// Every motion was a finished relative jog.
		const jogs = io.codes.filter((c) => c.includes("G1 X"));
		expect(jogs.length).toBeGreaterThan(0);
		expect(jogs.every((c) => c.includes("M400"))).toBe(true);
	});
});

describe("centreTool", () => {
	it("drives the nozzle onto the frame centre and reports the machine position", async () => {
		const io = fakeMachine();
		const K: Mat2 = { a: 0.02, b: 0, c: 0, d: 0.02 };
		const det = K.a * K.d - K.b * K.c;
		const invK: Mat2 = { a: K.d / det, b: -K.b / det, c: -K.c / det, d: K.a / det };
		const centre = { x: 320, y: 240 };
		// Nozzle starts 80px off; pixel position follows the machine via invK relative to an anchor.
		const anchorMachine = { x: io.pos.x, y: io.pos.y };
		const startPx = { x: 400, y: 200 };
		const detect = vi.fn(async (): Promise<Vec2> => {
			const offMm = { x: io.pos.x - anchorMachine.x, y: io.pos.y - anchorMachine.y };
			const d = apply2(invK, offMm);
			return { x: startPx.x + d.x, y: startPx.y + d.y };
		});

		const res = await centreTool(io, detect, K, centre, params);
		expect(res.ok).toBe(true);
		expect(res.position).toBeDefined();
		expect(res.iterations).toBeGreaterThan(0);
	});

	it("fails cleanly when the nozzle is lost", async () => {
		const io = fakeMachine();
		const res = await centreTool(io, async () => null, { a: 0.02, b: 0, c: 0, d: 0.02 }, { x: 320, y: 240 }, params);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/lost/);
	});
});
