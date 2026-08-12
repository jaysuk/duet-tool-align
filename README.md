# Duet Tool Align

A [DuetWebControl](https://github.com/Duet3D/DuetWebControl) (DWC) plugin that performs **automated,
camera-based XY tool-offset alignment** for RepRapFirmware toolchangers — a fully in-browser take on
[TAMV](https://github.com/HaythamB/TAMV) / [kTAMV](https://github.com/TypQxQ/kTAMV).

A camera points up at the nozzle; the plugin uses computer vision (OpenCV.js, WASM) to find the
nozzle tip, jogs each tool over the lens, and computes the per-tool `G10 X/Y` offsets automatically.

> **Compatibility:** requires the **Vue 3 / Vuetify 4 DWC** (3.7-alpha or later). It will **not**
> load on the older Vue 2 DWC (3.5 / 3.6).

## How it works

- **Frames** come from an upward-facing camera server on your network — pick whichever suits your
  build:
  - **USB webcam or USB microscope**, via [duet-webcam-bridge](https://github.com/jaysuk/duet-webcam-bridge)
    (v0.5+, adds the CORS headers the browser needs to read camera pixels). Runs on a PC/Raspberry Pi
    plugged into the camera.
  - **A dedicated ESP32-S3 camera board with an OV3660 sensor**, running the author's own firmware:
    [M5Stack-Unit-CamS3-5MP](https://github.com/jaysuk/M5Stack-Unit-CamS3-5MP) (OV3660/generic
    ESP32-S3-CAM board profile). No PC required — point the plugin straight at the board's IP.

  Either way, all the plugin needs from it is a CORS-enabled `/snapshot` and `/stream` on the same
  origin/port. Point the plugin at that base URL in its settings.
- **Detection** runs OpenCV.js entirely in the browser (bundled with the plugin) — no second service
  to install, and the camera source doesn't need to host it.
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
3. **Reload DWC**, open **Plugins → Tool Align**, and work through the 5-step guided flow: set the
   **camera bridge URL**, choose your **Reference**, **Calibrate** (with Detect/Auto-tune to get a
   clean lock first), **Align** each tool, then **Review & save**.

Requires a camera source reachable from the browser — **[duet-webcam-bridge](https://github.com/jaysuk/duet-webcam-bridge) ≥ 0.5.1**
for a USB webcam/microscope, or an **[ESP32-S3 + OV3660 board running the author's firmware](https://github.com/jaysuk/M5Stack-Unit-CamS3-5MP)**
for a standalone camera with no PC needed — see [docs/usage.md §1](docs/usage.md#1-requirements). It's
also exposed as an **embeddable component**, so if [Flexible Layouts](https://github.com/jaysuk/Flexible-Layouts)
is installed you can drop the *Auto Tool Align* panel straight into a grid.

## Releasing

`npm run release -- <version> --push` bumps `plugin.json`+`package.json`, commits, tags `vX.Y.Z`, and
pushes; the [release workflow](.github/workflows/release.yml) then builds the ZIP against DWC and
publishes a GitHub Release with generated notes. Updates are surfaced in-app (and in Flexible Layouts'
unified update popup via the shared `dwc-plugin-runtime` hub).

## Status

**v1.0.0** — the pure CV/calibration/control maths and the motion/G-code orchestration are unit-tested
(`npm test`), and the full guided flow (detect, calibrate, both reference workflows, multi-tool
alignment, review/apply/save) has been exercised end-to-end on real toolchanger hardware. This started
as a standalone plugin and is intended to fold into Flexible Layouts once proven — the offset maths
(`src/util/toolAlign.ts`) is copied verbatim from FL to keep that merge trivial.

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
