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
- **[duet-webcam-bridge](https://github.com/jaysuk/duet-webcam-bridge) ≥ 0.5.1** running on the
  machine the camera is plugged into. From 0.5.1 the bridge:
  - sends CORS headers so the browser can read camera pixels for computer vision, and
  - serves the OpenCV.js runtime at `/opencv/`, so the plugin loads CV from the bridge (no internet,
    nothing on the Duet's SD card).
- An upward-facing **camera/USB microscope** positioned so a nozzle can be parked above it, roughly in
  focus. A fixed mount is essential — if the camera moves, the calibration is invalid.

### Verify the bridge
In the same browser as DWC, open:
- `http://<bridge-ip>:8081/health` → should report `"version": "0.5.1"` (or newer).
- `http://<bridge-ip>:8081/opencv/opencv.js` → should download a ~10 MB file (not “404 page not found”).

If `/opencv/opencv.js` 404s, your bridge build doesn’t have the assets — update to the v0.5.1+ release.

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

## 3. First-time setup

1. **Set the camera bridge URL.** On first open the camera area shows a URL box — enter
   `http://<bridge-ip>:8081` (the bridge base URL). The live stream should appear and the status line
   should change to **“CV engine ready”** within a few seconds (it loads OpenCV from the bridge).
2. **Home the printer.** XY must be homed; motion controls are disabled while disconnected.
3. **Set the camera position.** Jog a nozzle until it’s roughly over the lens and in focus, then click
   **Set camera position** — this stores the machine XY (and Z) so the plugin can return here for each
   tool. Use **-Z/+Z** to sharpen focus and **Go to camera** to jump back later.

### Tune detection before aligning
Click **Detect** to run continuous detection with **no motion**. The red circle shows exactly what the
detector locked onto (at its true radius), and the status line shows `r=NNpx`. Adjust settings (below)
until the circle sits steadily on the nozzle bore, then stop Detect. Every setting has an **ℹ️
tooltip** with what it does, its range, and the **default value**.

See [Detection tuning](#6-detection-tuning) for the knobs.

---

## 4. Choosing the reference origin

This is the key decision, set in **Settings → Reference**. RRF toolchangers fall into two camps:

### A. Reference tool (e.g. T0) — *Reference = “Reference tool”*
The reference tool *is* the origin. Every other tool’s offset is measured relative to it, and the
reference tool keeps its own existing `G10`. Pick the **Reference tool** number (usually `0`).

Use this when your machine treats one tool as the datum (the common RRF toolchanger convention).

### B. Carriage datum (e.g. E3D toolchanger switch) — *Reference = “Carriage datum”*
A fixed point on the carriage is the origin (for example the E3D toolchanger’s nozzle-alignment
switch, or any repeatable carriage feature). You capture that point **once**, and **every** tool —
including T0 — gets a `G10` offset measured from it.

Use this when offsets are defined from a carriage reference rather than from a particular tool.

---

## 5. Running an alignment

### Workflow A — tool-to-tool (Reference = Reference tool)

1. **Reference = Reference tool**, set the **Reference tool** (e.g. 0).
2. Select the reference tool, jog it roughly over the lens (use **Jog X/Y** and **-Z/+Z**), confirm
   **Detect** locks the bore, then stop Detect.
3. **Calibrate** — the nozzle jogs a small star pattern and returns; the status reports the residual
   (lower is better, well under a pixel typically). This learns the pixel→mm mapping; it does **not**
   centre the nozzle.
4. **Run full alignment** — the plugin selects the reference tool, centres it on the crosshair and
   records it as the origin, then for each other tool: selects it, travels to the camera, centres, and
   records. Watch progress in the status line; **Stop** aborts at any point.
5. Review the **offsets table** (each tool’s captured XY and computed offset). **Apply all** sends the
   `G10` commands; **Save (M500)** persists them. The reference tool shows no offset (it’s the origin).

You can also do it tool-by-tool: select a tool, **Centre & capture tool**, repeat, then Apply.

### Workflow B — carriage-to-tool (Reference = Carriage datum)

1. **Reference = Carriage datum.**
2. **Capture the datum:** **Unload (T-1)** to clear the active tool, jog so the carriage’s datum
   feature (switch trigger point / reference mark) sits on the crosshair, then click **Capture datum**.
   The datum machine XY is stored (shown next to the button). *(Detection is for round nozzle bores; a
   switch/feature is positioned by eye on the crosshair.)*
3. Bring the first tool over the lens and **Calibrate** (as in A — needs a nozzle in view).
4. **Run full alignment** — every tool (T0 included) is selected, centred, and recorded; each offset is
   `tool position − datum`.
5. **Apply all** / **Save (M500)**. Here **every** tool gets a `G10`, including T0.

> **Sign convention:** if your machine’s offsets come out negated, flip the **Invert offsets** switch
> before applying. Verify with a two-colour test print or a known-good config.

---

## 6. Detection tuning

Two detectors, selectable in **Settings → Detection → Detector**:

### Hough circles
Classic circle transform. Good for a clean, well-lit bore.
- **Sensitivity** (Hough `param2`) — the main knob; **lower finds more** circles (and more false
  ones), higher is stricter.
- **Edge threshold** (`param1`) — higher keeps only strong edges, ignoring faint texture.
- **Accumulator dp**, **Min centre dist** — usually leave at defaults.

### Contour (threshold) — best for a shiny nozzle
Thresholds the dark bore, cleans it up, and takes the most circular blob’s enclosing circle. Far more
robust when glare/texture fools Hough.
- **Threshold** — `0` = automatic (Otsu); usually leave at 0. Set a manual 1–255 cut if lighting is
  uneven.
- **Min circularity** — how round a blob must be (0–1). Raise to reject irregular shapes.
- **Dark bore** — on, because the bore is darker than the nozzle.

### Shared knobs
- **Min/Max nozzle radius (px)** — bracket the bore’s pixel radius. If the red circle is too small,
  raise **Min** to skip small specks and make sure **Max** is above the bore radius. Watch `r=`.
- **Blur kernel** — odd number; raise (5–9) to suppress speckle/glitter.
- **Detect width** — frame is downscaled to this width for speed (coords scaled back). 800 is a good
  balance.
- **Pick largest circle** — while the nozzle is deliberately off-centre during tuning, this locks the
  dominant circle (the bore) instead of the nearest one. Turn **off** for real centring.

### Steadiness
- **Smoothing (frames)** — median-averages the on-screen marker so a jittery lock reads steadily
  (display only; doesn’t bias captured positions).
- **Tolerance (px)** — how close repeated detections must agree to count as locked, and how near the
  crosshair counts as centred. Raise if the lock is jumpy; lower for more precision.
- **Gain / Max jog step / Max iterations** — the centring control loop: lower gain is slower but
  steadier; the step is clamped so a bad detection can’t fling the toolhead.

---

## 7. Settings reference

Open the **Settings** panel in the widget. Every field has an ℹ️ tooltip describing it, its range, and
its **default**. Settings persist under DWC’s settings (`plugins.duetToolAlign`), so they follow the
machine.

- **Camera bridge URL**, **OpenCV.js URL** (blank = `<bridge>/opencv/opencv.js`).
- **Reference** (mode), **Reference tool**, plus the offsets-table **Invert offsets** switch.
- **Alignment & motion:** Calibration step, Tolerance, Smoothing, Gain, Max jog step, Max iterations,
  Settle, Travel/Jog feed.
- **Detection:** Detector, radii, blur, detect width, the Hough or contour params, Pick largest.
- **Z focus step / XY jog step** (next to the jog buttons).
- **Check for updates** — see below.

---

## 8. Updates

With **Check for updates** on (default), the plugin checks GitHub for a newer release on load. If one
is available it’s announced into the shared cross-plugin update hub: when **Flexible Layouts** is the
active layout, it appears in FL’s **unified update popup** alongside any other plugins. Otherwise the
plugin shows an in-context banner (and a one-off notification) with **Update now** (one-click download
+ install via DWC) and **Dismiss**. After a one-click update, reload DWC to finish.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| “CV engine not loaded” / it never readies | `/opencv/opencv.js` 404s or unreachable — update the bridge to ≥ 0.5.1 and check the URL. |
| Camera shows but detection errors with a security/canvas error | Bridge isn’t sending CORS — update to ≥ 0.5.1 (or set `allowOrigin`). |
| Page froze on older versions | Fixed in 0.1.3+ (OpenCV runs in a Web Worker). Update the plugin. |
| Buttons greyed out | The printer isn’t connected (motion needs a connection). Config/Detect still work offline. |
| Red circle locks the wrong thing | Use **Contour** detector, turn on **Pick largest**, set **Min/Max radius** around the bore, raise **Blur**. |
| Jittery lock | Raise **Smoothing** and **Tolerance**; improve focus with **-Z/+Z**. |
| Offsets look negated | Toggle **Invert offsets** before applying. |
| Two “Tool Align” menu entries | Stale load — fully reload DWC (Ctrl+Shift+R). |

---

## 10. How it works (brief)

- Frames come from the bridge’s `/snapshot`; pixels are read via a CORS-clean canvas.
- All OpenCV (load + detect) runs in a **Web Worker** so the DWC tab never freezes.
- **Calibration** jogs a known star and least-squares-fits a 2×2 pixel→mm transform (absorbs camera
  scale/rotation/skew), rejecting outliers.
- **Centring** converts the detected pixel error to a clamped, proportional mm jog and iterates until
  within tolerance, then records the machine XY.
- **Offsets** = each tool’s recorded position minus the origin (reference tool or carriage datum),
  emitted as `G10 P<tool> X.. Y..`.
