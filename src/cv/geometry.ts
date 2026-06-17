/**
 * Shared geometry types + tiny 2×2 linear algebra used by the calibration and alignment maths.
 * Pure and dependency-free so it unit-tests without OpenCV.
 */

export interface Vec2 {
	x: number;
	y: number;
}

/** Row-major 2×2 matrix [[a, b], [c, d]]. */
export interface Mat2 {
	a: number;
	b: number;
	c: number;
	d: number;
}

export function det2(m: Mat2): number {
	return m.a * m.d - m.b * m.c;
}

/** Invert a 2×2 matrix; returns null when singular (|det| ~ 0). */
export function invert2(m: Mat2): Mat2 | null {
	const det = det2(m);
	if (Math.abs(det) < 1e-12) return null;
	const inv = 1 / det;
	return { a: m.d * inv, b: -m.b * inv, c: -m.c * inv, d: m.a * inv };
}

/** Apply a 2×2 matrix to a vector. */
export function apply2(m: Mat2, v: Vec2): Vec2 {
	return { x: m.a * v.x + m.b * v.y, y: m.c * v.x + m.d * v.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function magnitude(v: Vec2): number {
	return Math.hypot(v.x, v.y);
}
