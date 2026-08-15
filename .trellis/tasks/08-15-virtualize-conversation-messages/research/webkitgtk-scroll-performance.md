# WebKitGTK Scroll Performance Research

## Local Environment

- Kernel / distribution: Arch Linux, kernel `7.1.8-arch1-3`
- Session: Wayland (`WAYLAND_DISPLAY=wayland-0`, `XDG_SESSION_TYPE=wayland`)
- WebKitGTK 4.1 runtime: `2.52.5`
- Tauri runtime: `tauri-runtime-wry 2.11.4`
- Wry: `0.55.1`
- Detected GPU: NVIDIA GeForce RTX 4060 Max-Q / Mobile
- `nvidia-smi` and `glxinfo -B` could not access the active display/driver from the diagnostic process, so actual WebKit GPU/compositing status remains unproven.

## Runtime Evidence from the User

1. Default-size window scrolls normally.
2. Maximized window scrolls poorly.
3. A non-maximized window manually resized close to screen size also scrolls poorly, so the maximize state itself is not required.
4. Left-side history/tree scrolling remains acceptable; the right conversation pane is affected.
5. Plain short-text messages reproduce the issue just like Markdown/code content, so Streamdown complexity is not required.
6. Shrinking a large window back to the default size immediately restores smooth scrolling. The slowdown follows current paint area rather than persisting after a resize transition.
7. Dragging the native scrollbar thumb and using wheel/trackpad input are equally affected. Input dispatch and smooth-wheel behavior are therefore not required to reproduce the issue; paint/compositing is the active branch.
8. A release binary built with `tauri build --no-bundle` reproduces the same slowdown. Development tooling and debug compilation are excluded.

## Upstream Evidence

### WebKitGTK Bug 305290

https://bugs.webkit.org/show_bug.cgi?id=305290

Reported 2026-01-11: dragging an overlay scrollbar can become extremely slow after the browser/webview window is resized, with the view dropping from smooth behavior to roughly 2–3 FPS. The report was reproduced on WebKitGTK under a Wayland session. Canopy differs because shrinking the window immediately clears the slowdown, so this issue is useful background but not the current primary explanation.

### Tauri/Wry NVIDIA and DMABUF records

- https://github.com/tauri-apps/wry/issues/1366
- https://github.com/tauri-apps/tauri/issues/9394

These upstream records document WebKitGTK failures on Arch/Wayland/NVIDIA involving GBM/DMABUF and accelerated compositing. `WEBKIT_DISABLE_DMABUF_RENDERER=1` is cited as a diagnostic workaround for specific failures, not as a universally safe production default. Disabling compositing/hardware acceleration can increase CPU cost and must only be tested through controlled A/B runs.

### WebKitGTK acceleration policy

https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.hardware-acceleration-policy.html

WebKitGTK exposes a hardware acceleration policy whose default is `always`, but the effective result still depends on hardware/system support. Configuration intent is therefore insufficient evidence that acceleration is active.

## Planning Consequences

- Do not implement TanStack Virtual as the primary fix until the scroll/compositing path is isolated. Virtualization reduces mounted DOM for long histories but cannot fix a WebKit resize/compositor regression that reproduces with simple text.
- Use reversible production A/B changes to isolate the right header backdrop filter, per-message shadows/borders, scroll-layer containment, and WebKitGTK DMABUF/compositing behavior.
- The CSS A/B sequence met the target, so no WebKit DMABUF/compositing environment flag or further runtime diagnosis is needed for this task.
- The task title, PRD, design, implementation plan, and context manifests have been rewritten around the selected scroll-compositing branch; TanStack Virtual remains a separate deferred optimization.

## Implementation A/B Log

### Stage A — Header backdrop filter

- Change: replace the right-pane header's `bg-background/90 backdrop-blur-sm` with opaque `bg-background`.
- Automated result: ESLint, TypeScript, all 120 Vitest tests, and Vite production build passed.
- Release binary: `src-tauri/target/release/canopy` built successfully.
- Desktop result: user reports no noticeable improvement at default or large window sizes with the fixed scroll scenario.

### Stage B — Message shadow

- Change: remove only `shadow-sm` from `MessageBubble` while retaining border, radius, spacing, and role backgrounds.
- Automated result: ESLint, TypeScript, all 120 Vitest tests, and Vite production build passed.
- Release binary: `src-tauri/target/release/canopy` rebuilt successfully.
- Desktop result: user reports a slight improvement, but the large-window right-pane slowdown remains. Retain Stage B as independently beneficial and continue to Stage C.

### Stage C — Scroll paint containment

- Change: add `[contain:paint]` to the existing `ConversationPane` scroll element only; no transform promotion or `will-change`.
- Automated result: focused ESLint, TypeScript, focused conversation/Markdown tests (28 tests), and Vite production build passed.
- Release binary: `src-tauri/target/release/canopy` rebuilt successfully.
- Desktop result: user reports large-window right-pane scrolling is now approximately as smooth as the 800×600 baseline. Accept Stage C and stop; do not add Stage D runtime flags or virtualization.

## Final A/B Decision

- Retain Stage A: opaque header background, no backdrop filter. It had no noticeable standalone improvement, but removes unnecessary filter work at no visual cost.
- Retain Stage B: remove repeated message shadows. User observed a slight improvement.
- Retain Stage C: `[contain:paint]` on the right scroll surface. User observed the decisive improvement to near-baseline smoothness.
- Do not run or ship Stage D WebKitGTK environment flags. The accepted frontend changes already meet the observed performance target and avoid machine-specific runtime switches.
