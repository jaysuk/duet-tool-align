# Duet Tool Align — Usage Guide

Automated, camera-based **XY tool-offset alignment** for RepRapFirmware, run entirely in the browser
as a Duet Web Control (DWC) plugin. A camera points up at the nozzle; OpenCV (WASM) finds the nozzle
bore; the plugin jogs each tool over the lens, centres it on the crosshair, and computes the per-tool
`G10` X/Y offsets.

> Scope is **XY only** (matching TAMV/kTAMV). Z offsets stay with your existing method (touch plate,
> probe, paper, etc.).

---

## 1. Requirements

- **DuetWebControl 3.7** (Vue 3 / Vuetify 4). It will not load on the Vue 2 DWC (3.5/3.6).
- An upward-facing **camera**, mounted so a nozzle can be parked above it, roughly in focus. A fixed
  mount is essential — if the camera moves, the calibration is invalid (or tick **Camera is rigidly
  mounted** in step 3 so the plugin remembers that on your behalf — see [§5](#5-running-an-alignment)).
- A **camera server** reachable from the browser, serving a CORS-enabled `/snapshot` (single JPEG) and
  `/stream` (MJPEG) from the *same* base URL. Two supported options — pick whichever suits your build:

  ### Option A — USB webcam or USB microscope
  Run [**duet-webcam-bridge**](https://github.com/jaysuk/duet-webcam-bridge) (≥ 0.5.1) on a PC,
  Raspberry Pi, or anything with the camera plugged in. Download, run, done — ffmpeg is bundled, and
  it ships for Windows/macOS/Linux/Raspberry Pi. The base URL is normally `http://<bridge-ip>:8081`.

  ### Option B — a dedicated ESP32-S3 camera (no PC needed)
  Flash an ESP32-S3 board with an **OV3660** sensor (e.g. a generic "ESP32-S3-CAM"/Goouuu-Cam-pinout
  board) with the author's own firmware,
  [**M5Stack-Unit-CamS3-5MP**](https://github.com/jaysuk/M5Stack-Unit-CamS3-5MP) — build it with the
  `CONFIG_UNITCAMS3_BOARD_OV3660` board profile. It talks straight to Wi-Fi, so there's no separate PC
  or bridge service to keep running. Point the plugin at `http://<device-ip>` (or
  `http://<device-id>.local`) **with no port suffix** — `/snapshot` and `/stream` both need to be on
  port 80; the board's port-81 stream server doesn't serve `/snapshot`, so a `:81` URL will connect the
  live view but fail on every Detect/Calibrate/Align call. See that repo's `/setup` page for Wi-Fi
  provisioning, image tuning, and firmware updates.

  Either option works identically from the plugin's point of view — it only cares about `/snapshot` +
  `/stream` + CORS. **OpenCV.js itself is bundled with the plugin**, so neither camera source needs to
  serve it (the **OpenCV.js URL** setting only matters if you want to override that, e.g. to point at a
  custom build).

### Verify the camera source
In the same browser as DWC, open:
- `<bridge-url>/snapshot` → should download a single JPEG image.
- `<bridge-url>/stream` → should show a live MJPEG feed.

If either 404s or hangs, fix that before pointing the plugin at it — step 1's status line and the
in-widget camera pane will otherwise just look stuck with no obvious reason why.

---

## 2. Install

1. Download `DuetToolAlign-<version>.zip` from the [Releases](../../releases) page.
2. In DWC: **Settings → General → Plugins → Install Plugin**, choose the ZIP, accept the
   third-party-plugin prompt, then **Start** it.
3. **Reload DWC** (Ctrl+Shift+R). Open **Plugins → Tool Align**.

The panel is also exposed as an **embeddable component**, so if
[Flexible Layouts](https://github.com/jaysuk/Flexible-Layouts) is installed you can drop the
*Auto Tool Align* widget straight into a grid.

---

## 3. The guided flow

The widget is a 5-step wizard (**editable** — click any step's tab to jump straight to it). A **Next**
banner above the camera view always says what to do right now, for whichever step you're on.

1. **Camera** — set the camera server's base URL (Option A or B above).
2. **Reference** — decide what every tool's offset is measured *from* (see [§4](#4-choosing-the-reference-origin)).
   Just the decision here; you capture it in step 3.
3. **Calibrate** — a checklist, not a wall of controls: only the current stage is expanded, finished
   ones collapse to a one-line summary (still reopenable). Auto-advances as each stage completes:
   1. **Detect & tune** — jog the target into frame and focus (jog controls live in the strip above
      the checklist, alongside **Go to camera**), then **Detect** to check the lock. Includes an
      optional **radius & sensitivity** helper (measure the target, then **Auto-tune**) and the
      **Advanced** accordions for manual tuning — see [§6](#6-detection-tuning).
   2. **Calibrate** — jogs a small star of known moves and solves the pixel→mm transform. Tick
      **Camera is rigidly mounted** first if it's fixed in place, so the calibration is remembered
      across a page reload instead of needing to be re-run every session.
   3. **Centre & capture the carriage datum** — only shown when Reference is "Carriage datum".
   4. **Set camera position** — do this last, once you're centred on something precise (a tool or the
      datum), not wherever you started jogging from.
4. **Align tools** — a progress bar (aligned / total) plus a per-tool chip row and checklist
   (Load → bring into frame & confirm the lock → Align). Same jog strip + **Go to camera** as step 3.
   Each tool can have its own Detection settings, independent of Global (**Detection settings for
   T*n*** below the checklist).
5. **Review & save** — a table per tool: captured XY, the tool's **current** (already-applied) offset,
   the newly **calculated** offset, and **Δ** — the distance between them, flagged past 0.3 mm as worth
   a second look before applying (most often just the expected result of running this; occasionally a
   sign something's off — wrong tool loaded during capture, reference mixed up, a detection that
   slipped past tolerance). **Apply all** sends every tool's `G10` plus the save command in one go;
   **Save** persists on its own. The save command needs the **P10** parameter to actually persist tool
   offsets in RRF — the default is `M500 P10`, not plain `M500` (see [§7](#7-settings-reference)).

**Go to camera**, wherever it appears, has two settings tucked behind the ⚙ next to it:
- **G53** (default on) — always returns to the *exact* saved machine position, regardless of the
  currently-loaded tool's offset. Turn off to instead land wherever the loaded tool's own offset would
  put it (its nozzle over the camera, rather than the bare carriage).
- **Include Z** (default on) — also drives to the saved camera focus height. Turn off to only move
  X/Y, e.g. while focusing manually and you don't want every click re-driving Z to a stale value.

Captured tool positions, the carriage datum, and (for a non-rigidly-mounted camera) the current
session's calibration all survive navigating to another DWC page and back, or a page reload in the
same browser tab — they only clear when you close the tab.

---

## 4. Choosing the reference origin

This is the key decision, made in step 2 (**Reference**). RRF toolchangers fall into two camps:

### A. Reference tool (e.g. T0)
The reference tool *is* the origin. Every other tool's offset is measured relative to it, and the
reference tool keeps its own existing `G10`. Pick the **Reference tool** number (usually `0`).

Use this when your machine treats one tool as the datum (the common RRF toolchanger convention).

### B. Carriage datum (e.g. E3D toolchanger switch)
A fixed point on the carriage is the origin (for example the E3D toolchanger's nozzle-alignment
switch, or any repeatable carriage feature). You capture that point **once**, and **every** tool —
including T0 — gets a `G10` offset measured from it.

Use this when offsets are defined from a carriage reference rather than from a particular tool.

---

## 5. Running an alignment

You drive the tool changes and jogging yourself — the plugin never changes tools or travels on its
own (except **Go to camera**, which you trigger explicitly). **Calibrate** must succeed before you can
align (**Align loaded tool** stays disabled until a calibration exists, with a tooltip explaining
exactly why if you hover a disabled button). Calibration only needs to happen **once** per session
(the camera doesn't move between tools); each tool is then aligned individually.

### Workflow A — tool-to-tool (Reference = Reference tool)

1. **Reference = Reference tool**, set the **Reference tool** number (e.g. 0).
2. Load the **reference tool**, jog it over the lens, confirm **Detect** locks the bore, then stop
   Detect.
3. **Calibrate** (step 3) — the nozzle jogs a small star and returns; the summary shows the residual
   (lower is better). This learns the pixel→mm mapping; it does **not** centre the nozzle.
4. **Set camera position**, then move to step 4.
5. **Align loaded tool** — centres the *currently-loaded* tool on the crosshair and records it. For the
   reference tool this captures the origin.
6. **Change to the next tool yourself** (the tool buttons in the persistent zone, or **Unload**), jog
   its nozzle into frame, then **Align loaded tool** again. Repeat for every tool — the chip row and
   progress bar track what's left.
7. **Review & save**: check the offsets table (and the Current/Δ columns for anything unexpected), then
   **Apply all**. The reference tool shows no offset (it's the origin).

### Workflow B — carriage-to-tool (Reference = Carriage datum)

1. **Reference = Carriage datum** (step 2).
2. In step 3: load a tool, jog its nozzle over the lens, and **Calibrate** — needed once per session,
   and needed first if you're using the camera-assisted datum capture next.
3. **Centre & capture the carriage datum** (its own checklist stage, once Calibrate succeeds) — two
   ways, pick whichever suits your target:
   - **Centre & capture datum** (camera-assisted): **Unload (T-1)**, bring the carriage's datum
     feature roughly into frame, then click it. It converges on the crosshair the same way **Align
     loaded tool** does for a nozzle, using the datum's own Detection profile (the profile picker in
     "Detect & tune" follows the datum automatically here — no need to switch it by hand), and records
     the converged position. Best for a round target the camera can actually detect.
   - **Capture datum (manual)**: jog the switch/feature onto the crosshair by eye, then click it — a
     direct position read, no camera involved. Use this if the datum isn't something the circle
     detector can pick out (e.g. a microswitch trigger point).
4. **Set camera position**, then move to step 4.
5. **Align loaded tool** — centres and records the loaded tool; its offset is `tool position − datum`.
6. **Change tools yourself**, jog into frame, **Align loaded tool** again — repeat for every tool
   (including T0; each gets a `G10` from the datum).
7. **Review & save** → **Apply all**.

> **Tips.** Use **Centre (test)** on step 4 for the same centre+record without applying an offset, to
> sanity-check a lock. If offsets come out negated, flip **Invert offsets** on step 5 before applying,
> and verify with a two-colour test print.

---

## 6. Detection tuning

Two detectors, in each **Advanced: detection tuning** accordion:

### Hough circles
Classic circle transform. Good for a clean, well-lit bore.
- **Sensitivity** (Hough `param2`) — the main knob; **lower finds more** circles (and more false
  ones), higher is stricter.
- **Edge threshold** (`param1`) — higher keeps only strong edges, ignoring faint texture.
- **Accumulator dp**, **Min centre dist** — usually leave at defaults.

### Contour (threshold) — best for a shiny nozzle
Thresholds the dark bore, cleans it up, and takes the most circular blob's enclosing circle. Far more
robust when glare/texture fools Hough.
- **Threshold** — `0` = automatic (Otsu); usually leave at 0. Set a manual 1–255 cut if lighting is
  uneven.
- **Min circularity** — how round a blob must be (0–1). Raise to reject irregular shapes.
- **Dark bore** — on, because the bore is darker than the nozzle.

### Shared knobs
- **Min/Max nozzle radius (px)** — bracket the bore's pixel radius. If the red circle is too small,
  raise **Min** to skip small specks and make sure **Max** is above the bore radius. Watch `r=`.
- **Blur kernel** — odd number; raise (5–9) to suppress speckle/glitter.
- **Detect width** — frame is downscaled to this width for speed (coords scaled back). 800 is a good
  balance.
- **Pick largest circle** — while the nozzle is deliberately off-centre during tuning, this locks the
  dominant circle (the bore) instead of the nearest one. Turn **off** for real centring.

### Auto-tune
Sweeps sensitivity from strict to loose (keeping Min/Max radius fixed) and stops at the strictest
setting that finds one centred candidate consistently — both in **radius** and in **position** across
several frames, so it won't settle on a value that merely finds *something the right size* in
slightly different spots each time. Set Min/Max radius correctly first (the ⌀ button next to it, from
a Measure-tool reading, or the Advanced fields above).

### Per-tool / per-datum profiles
Each tool, and the carriage datum, can have its own Detection settings (**Use custom settings**),
independent of the Global defaults. The profile picker in step 3's "Detect & tune" and step 4's
per-tool "Detection settings" section always follows whatever's actually being detected against right
now — the loaded tool, the datum (when unloaded in point/carriage-datum mode), or Global — so what you
see tuning against is always what Calibrate/Align will actually use.

### Steadiness
- **Smoothing (frames)** — median-averages the on-screen marker so a jittery lock reads steadily
  (display only; doesn't bias captured positions).
- **Tolerance (px)** — how close repeated detections must agree to count as locked, and how near the
  crosshair counts as centred. Raise if the lock is jumpy; lower for more precision.
- **Gain / Max jog step / Max iterations** — the centring control loop: lower gain is slower but
  steadier; the step is clamped so a bad detection can't fling the toolhead.

---

## 7. Settings reference

Every field has an ℹ️ tooltip describing it, its range, and its **default**. Settings persist under
DWC's settings (`plugins.duetToolAlign`), so they follow the machine.

- **Camera bridge URL**, **OpenCV.js URL** (blank = the plugin's own bundled copy).
- **Reference** (mode), **Reference tool**, plus the offsets-table **Invert offsets** switch.
- **Camera is rigidly mounted** — gates whether the calibration transform persists across a page
  reload (on) or stays session-only (off, the default).
- **Go to camera → G53** (default on) — travel in machine coordinates, ignoring the loaded tool's
  offset. **Go to camera → Include Z** (default on) — also drive to the saved camera focus height.
- **Alignment & motion:** Calibration step, Tolerance, Smoothing, Gain, Max jog step, Max iterations,
  Settle, Travel/Jog feed.
- **Detection:** Detector, radii, blur, detect width, the Hough or contour params, Pick largest —
  per profile (Global, each tool, the carriage datum).
- **Z focus step / XY jog step** (next to the jog buttons, shared by steps 3 and 4).
- **Start/finish/save commands** — optional macros around a full alignment run, and the command Save
  (and Apply all) sends to persist offsets. **Needs to be `M500 P10`, not plain `M500`** — RRF only
  stores tool offsets from `M500` when the `P10` parameter is given; that's the default.
- **Check for updates** — see below.

---

## 8. Updates

With **Check for updates** on (default), the plugin checks GitHub for a newer release on load. If one
is available it's announced into the shared cross-plugin update hub: when **Flexible Layouts** is the
active layout, it appears in FL's **unified update popup** alongside any other plugins. Otherwise the
plugin shows an in-context banner (and a one-off notification) with **Update now** (one-click download
+ install via DWC) and **Dismiss**. After a one-click update, reload DWC to finish.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "CV engine not loaded" / it never readies | Check the camera bridge URL itself first (`/snapshot` should download a JPEG) — the OpenCV runtime is bundled with the plugin, so this is almost always a camera-source connectivity issue, not an OpenCV one. |
| Camera shows but detection errors with a security/canvas error | The camera source isn't sending CORS headers on `/snapshot`. duet-webcam-bridge needs ≥ 0.5.1; the M5Stack/OV3660 firmware sends CORS on every relevant route already. |
| M5Stack/ESP32 camera: live view works but Detect/Calibrate/Align all fail to grab a frame | The bridge URL has a `:81` port suffix — that port only serves `/stream`, not `/snapshot`. Drop the port suffix (plain `http://<device-ip>`) so both land on port 80. |
| M5Stack/ESP32 camera: stream is laggy/stuttery despite decent Wi-Fi signal | On the OV3660 board profile, this was traced to XCLK being set too high (20MHz vs. the validated 10MHz) starving the streaming tasks of CPU time — fixed in firmware; make sure you're on a current build. |
| Buttons greyed out | The printer isn't connected (motion needs a connection), or another operation is running — hover the button, the tooltip explains exactly why. |
| Calibrate keeps failing even though Detect looks locked | Check the profile picker in step 3 matches what's actually loaded/being detected — it auto-follows the loaded tool or the datum, but if you've manually browsed a different profile to check it, tuning applied there won't be what Calibrate reads. |
| Red circle locks the wrong thing | Use **Contour** detector, turn on **Pick largest**, set **Min/Max radius** around the bore, raise **Blur**. |
| Jittery lock | Raise **Smoothing** and **Tolerance**; improve focus with **-Z/+Z**. |
| Offsets look negated | Toggle **Invert offsets** before applying. |
| Save doesn't seem to persist offsets after a reboot | Check the **Save command** setting is `M500 P10`, not plain `M500` — RRF silently ignores tool offsets on a bare `M500`. |
| Captured tools/datum disappeared | If you closed the browser tab (or restarted the browser), session-only data is gone by design — navigating to another DWC page and back, or reloading the page, is fine and preserves it. |
| Two "Tool Align" menu entries | Stale load — fully reload DWC (Ctrl+Shift+R). |

---

## 10. How it works (brief)

- Frames come from the camera source's `/snapshot`; pixels are read via a CORS-clean canvas.
- All OpenCV (load + detect) runs in a **Web Worker** so the DWC tab never freezes.
- **Calibration** jogs a known star and least-squares-fits a 2×2 pixel→mm transform (absorbs camera
  scale/rotation/skew), rejecting outliers.
- **Centring** converts the detected pixel error to a clamped, proportional mm jog and iterates until
  within tolerance, then records the machine XY.
- **Offsets** = each tool's recorded position minus the origin (reference tool or carriage datum),
  emitted as `G10 P<tool> X.. Y..`.
