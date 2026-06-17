# Duet Tool Align

A [DuetWebControl](https://github.com/Duet3D/DuetWebControl) (DWC) plugin that performs **automated,
camera-based XY tool-offset alignment** for RepRapFirmware toolchangers — a fully in-browser take on
[TAMV](https://github.com/HaythamB/TAMV) / [kTAMV](https://github.com/TypQxQ/kTAMV).

A camera points up at the nozzle; the plugin uses computer vision (OpenCV.js, WASM) to find the
nozzle tip, jogs each tool over the lens, and computes the per-tool `G10 X/Y` offsets automatically.

> **Compatibility:** requires the **Vue 3 / Vuetify 4 DWC** (3.7-alpha or later). It will **not**
> load on the older Vue 2 DWC (3.5 / 3.6).

## How it works

- **Frames** come from [duet-webcam-bridge](https://github.com/jaysuk/duet-webcam-bridge) (v0.5+,
  which adds CORS headers so the browser can read camera pixels, and serves the OpenCV.js runtime at
  `/opencv/`). Point the plugin at the bridge URL in its settings.
- **Detection** runs OpenCV.js entirely in the browser — no second service to install.
- **Calibration** jogs a small star of known moves and solves a pixel→mm transform.
- **Alignment** iteratively centres each nozzle on the crosshair, records the machine XY, and derives
  per-tool offsets from the chosen origin.

Scope is **XY only** (matching TAMV's core); Z offsets stay with your existing method.

**📖 Full instructions: [docs/usage.md](docs/usage.md)** — setup, both offset workflows, detection
tuning, the settings reference, and troubleshooting.

## Two offset workflows

Set the origin in **Settings → Reference**:

- **Reference tool** (e.g. T0) — that tool is the origin; other tools are measured relative to it.
  The common RRF-toolchanger convention.
- **Carriage datum** (e.g. the E3D toolchanger switch) — a fixed carriage point is the origin; capture
  it once and **every** tool (T0 included) is offset from it.

See [docs/usage.md §4–5](docs/usage.md#4-choosing-the-reference-origin) for step-by-step.

## Install

1. Download `DuetToolAlign-<version>.zip` from [Releases](../../releases) (or build it — see below).
2. In DWC: **Settings → General → Plugins → Install Plugin**, pick the ZIP, accept the prompt, **Start**.
3. **Reload DWC**, open **Plugins → Tool Align**, set the **camera bridge URL**, set the **camera
   position**, tune with **Detect**, then **Calibrate** → **Run full alignment**.

Requires **[duet-webcam-bridge](https://github.com/jaysuk/duet-webcam-bridge) ≥ 0.5.1** (camera CORS +
the OpenCV.js runtime at `/opencv/`). It's also exposed as an **embeddable component**, so if
[Flexible Layouts](https://github.com/jaysuk/Flexible-Layouts) is installed you can drop the
*Auto Tool Align* panel straight into a grid.

## Releasing

`npm run release -- <version> --push` bumps `plugin.json`+`package.json`, commits, tags `vX.Y.Z`, and
pushes; the [release workflow](.github/workflows/release.yml) then builds the ZIP against DWC and
publishes a GitHub Release with generated notes. Updates are surfaced in-app (and in Flexible Layouts'
unified update popup via the shared `dwc-plugin-runtime` hub).

## Status

The pure CV/calibration/control maths and the motion/G-code orchestration are unit-tested
(`npm test`). Single-tool detection/calibration/centring is exercisable on hardware; multi-tool
sequences await a multi-tool machine. This started as a standalone plugin and is intended to fold into
Flexible Layouts once proven — the offset maths (`src/util/toolAlign.ts`) is copied verbatim from FL
to keep that merge trivial.

## Building

The plugin is built against a local checkout of the Vue 3 DWC source (like Flexible Layouts).

```bash
npm install                                          # once, in this repo
npm run build-plugin-pkg -- /path/to/duet-tool-align   # from your DWC checkout
```

On Windows, edit `DWC_DIR` at the top of `build.bat` and run it — the installable ZIP lands in this
folder.

- `npm test` — vitest unit tests (geometry, calibration, alignment loop, detection helpers,
  orchestration G-code contract, widget mount).
- `DWC_DIR=… npm run typecheck` — type-check against the DWC checkout.
- `DWC_DIR=… npm run verify-build` — confirm it bundles into an installable ZIP.

CI (`.github/workflows/ci.yml`) runs the unit tests plus a build + type-check against DWC on every
push, via the shared [dwc-plugin-test-kit](https://github.com/jaysuk/dwc-plugin-test-kit) reusable
workflow.

## License

GPL-3.0-or-later
