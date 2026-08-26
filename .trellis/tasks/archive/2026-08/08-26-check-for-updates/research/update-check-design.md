# Update-check design research

## Repository evidence

- The app version is `0.3.1` in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`.
- The repository is `NCDWLQ/canopy`; release tags use `v*`, and the release
  workflow currently publishes draft GitHub releases with unsigned bundles.
- The frontend already depends on `@tauri-apps/plugin-opener` and grants
  `opener:default` in `src-tauri/capabilities/default.json`.
- The current CSP only allows IPC connections, so a browser-side request to
  GitHub needs a narrowly scoped `connect-src https://api.github.com` entry.

## Options considered

### Tauri updater plugin

Tauri's updater requires signed update artifacts, a configured public key, an
update endpoint/static manifest, updater permissions, and an install/restart
flow. It is the right future path for in-app installation, but it conflicts
with the approved MVP boundary and would expand the release pipeline.

Reference: <https://v2.tauri.app/plugin/updater/>

### GitHub Releases API from the webview

The public endpoint
`GET https://api.github.com/repos/NCDWLQ/canopy/releases/latest` provides the
latest stable published release metadata. The response must still be treated
as unknown: the client should require a successful response and a strict
stable `tag_name` before comparing versions. A fixed GitHub release page URL is
used for the external action instead of trusting an arbitrary API URL.

Reference: <https://docs.github.com/en/rest/releases/releases#get-the-latest-release>

This option avoids credentials and native code, fits the manual-check scope,
and can be tested with injected `fetch`/version dependencies. Its risks are
GitHub availability and unauthenticated API rate limits; both map to the
existing retryable failure UI.

## Decision

Use the GitHub API option for this task. Keep the update client in
`src/lib/updates/`, keep stateful request lifecycle in a settings hook or
component-owned boundary, and keep external navigation behind the existing
opener capability. Do not add updater keys, updater permissions, or release
artifact generation in this task.
