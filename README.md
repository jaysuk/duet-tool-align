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
- **Alignment** iteratively centres each nozzle on the frame centre, records the machine XY, and
  derives offsets relative to a reference tool.

Scope is **XY only** (matching TAMV's core); Z offsets stay with your existing method.

## Install

1. Build the ZIP (see below) or grab a release.
2. In DWC: **Settings → Plugins → Install plugin**, pick the ZIP, then **Start** it.
3. Open **Plugins → Tool Align**, set the **camera bridge URL** in the settings panel, set the
   **camera position**, then **Calibrate** and **Run full alignment**.

It's also exposed as an **embeddable component**, so if [Flexible
Layouts](https://github.com/jaysuk/Flexible-Layouts) is installed you can drop the *Auto Tool Align*
panel straight into a grid.

## Status

Early. The pure CV/calibration/control maths and the motion/G-code orchestration are unit-tested
(`npm test`); end-to-end on real hardware is the next step. This started life as a standalone plugin
and is intended to fold into Flexible Layouts once proven — the offset maths (`src/util/toolAlign.ts`)
is copied verbatim from FL to keep that merge trivial.

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
