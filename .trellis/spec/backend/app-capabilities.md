# App Capabilities & Plugin Wiring

> Convention for granting the webview access to native OS capabilities (dialogs,
> files, clipboard) via Tauri plugins. Established with the conversation-export
> feature (task 08-23-conversation-export).

---

## Scenario: exposing a native OS capability to the webview

### 1. Scope / Trigger

- Trigger: adding any `tauri-plugin-*` crate / `@tauri-apps/plugin-*` package, or
  any feature that touches OS-level IO (file save/open, clipboard, shell).

### 2. Core Convention: OS IO stays Rust-side, capabilities stay minimal

**What**:
- The webview never receives broad plugin permissions (`dialog:default`,
  `fs:*`). Grant only the exact permission the feature needs, e.g.
  `"dialog:allow-save"` in `src-tauri/capabilities/default.json`.
- Actual file IO is performed by a Rust `#[tauri::command]` (example:
  `write_export_file` in `src-tauri/src/conversations/commands.rs`), invoked
  from the frontend through the normal `call()` IPC pipeline.
- Presentation (i18n labels, filename sanitization, content assembly from
  already-loaded store data) stays in the frontend; Rust owns bytes and IO.

**Why**: extends the existing "SQL remains Rust-only" principle — the capability
file is the app's security boundary, and every wide permission widens the
webview's attack surface. Data needed for presentation is already projected in
the store, so Rust-side re-assembly would duplicate the source of truth.

### 3. Wiring Checklist (per plugin)

1. `src-tauri/Cargo.toml`: add the crate (e.g. `tauri-plugin-dialog = "2"`).
2. `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_dialog::init())`.
3. `src-tauri/capabilities/default.json`: add the narrowest permission
   (`"dialog:allow-save"`, not `"dialog:default"`).
4. `package.json`: add the matching `@tauri-apps/plugin-dialog` package.
5. JS API only for user interaction (e.g. `save()`); IO goes through a command.

### 4. Gotchas

> **Warning**: `save()` `defaultPath` must include the extension
> (e.g. `conversation-title.md`). Linux save dialogs do NOT auto-append the
> selected filter's extension — omitting it yields extension-less files.

> **Warning**: dialog permission names are per-API (`dialog:allow-save`,
> `dialog:allow-open`, ...). Adding `dialog:default` silently grants all of
> them; the minimal-permission review in `check` should flag it.

### 5. Wrong vs Correct

#### Wrong

```json
// capabilities/default.json — grants every dialog API
"permissions": ["core:default", "dialog:default"]
```

```ts
// webview writing files directly — grants webview an fs capability
import { writeTextFile } from "@tauri-apps/plugin-fs"
```

#### Correct

```json
// capabilities/default.json — only what the export flow uses
"permissions": ["core:default", "dialog:allow-save"]
```

```ts
// JS dialog for the path, Rust command for the bytes
const path = await save({ defaultPath: `${name}.md`, filters: [...] })
if (path === null) return
await client.writeExportFile({ path, content })
```

### 6. Tests Required

- Rust: command unit tests (validation caps, IO error → `CommandError` code,
  redaction — no path leaked into the error envelope).
- Frontend: dialog-args assertions (defaultPath includes extension + filter),
  cancel (`null`) = no invoke and no toast.
