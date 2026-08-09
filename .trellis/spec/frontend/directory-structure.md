# Frontend Directory Structure

> Feature-oriented React organization with one typed Tauri boundary.

## Current Foundation

The Vite application currently has this intentionally small structure:

```text
src/
├── components/ui/button.tsx          # generated generic shadcn primitive
├── features/conversations/store/
│   └── README.md                     # reserved Zustand ownership boundary
├── lib/utils.ts                      # shared cn() style composition helper
├── test/setup.ts                     # Vitest/Testing Library cleanup
├── App.tsx                           # temporary accessible shell
├── App.test.tsx                      # colocated shell smoke test
├── index.css                         # Tailwind 4 and theme tokens
└── main.tsx                          # React root only
```

`main.tsx` owns root lookup and `StrictMode`; it does not contain product
composition. `App.tsx` is currently a scaffold marker and should become a thin
application composition boundary as feature modules land.

## Product Layout

Use the approved feature-oriented structure:

```text
src/
├── app/                              # providers and shell composition
├── components/ui/                    # generic shadcn/Radix source components
├── features/
│   ├── conversations/
│   │   ├── actions/                  # branch/edit/select orchestration
│   │   ├── components/               # outline, messages, composer
│   │   ├── store/                    # Zustand state, actions, selectors
│   │   └── types/                    # frontend domain projections
│   └── providers/
│       └── components/               # settings and model selection UI
├── hooks/                            # only hooks shared across features
├── lib/
│   ├── tauri/                        # raw invoke, decoding, error normalization
│   └── utils.ts                      # genuinely cross-feature utilities
└── test/                             # global setup and shared test-only helpers
```

Keep tests beside the code they verify (`Thing.test.tsx`,
`selector.test.ts`). Shared fixtures belong in the narrowest common feature;
only cross-feature IPC contract fixtures may live under a shared test path.

## Ownership Rules

- `components/ui` contains generated or lightly wrapped primitives. It has no
  conversation state, Tauri calls, or product copy.
- `features/<feature>` owns product behavior, view models, components, actions,
  state, and feature-local tests.
- `lib/tauri` is the only raw Tauri invoke boundary. It validates unknown IPC
  payloads before returning frontend types.
- `app` composes features and providers; it must not become a second location
  for feature business logic.
- `hooks` is reserved for truly cross-feature hooks. Feature-specific hooks
  remain inside their feature.
- `index.css` remains the single global Tailwind/theme entry from
  `components.json`; feature-specific styling stays with the feature and uses
  semantic tokens.

## Naming and Imports

- React components and their files use `PascalCase` once product components
  are authored; shadcn-generated filenames retain the registry's lowercase
  convention.
- Hooks start with `use`; other functions and files use descriptive
  `camelCase` names.
- Tests use `.test.ts` or `.test.tsx` and stay next to their subject.
- Import application code through the configured `@/*` alias when crossing a
  feature/directory boundary. Use short relative imports within one folder.
- Avoid barrel files until a directory has a deliberate public API; do not use
  barrels merely to shorten imports.

## Examples

- `src/components/ui/button.tsx` demonstrates the generic shadcn primitive
  boundary and imports `cn` from `@/lib/utils`.
- `src/App.test.tsx` demonstrates accessible Testing Library queries instead
  of class-name or snapshot assertions.
- `src/main.tsx` demonstrates a fail-fast application root check and a minimal
  entry point.
- `.trellis/spec/frontend/component-guidelines.md` defines the intended
  conversation component ownership and handoff contract.

## Forbidden Patterns

- Raw `invoke`, SQL, or provider HTTP calls in components, stores, or hooks.
- Generic primitives placed under a feature or product components placed in
  `components/ui`.
- A broad `utils`, `types`, or `hooks` directory used as a dumping ground.
- Duplicated domain/IPC types in frontend-agent-owned component folders.
- Adding a second global stylesheet instead of extending `src/index.css` and
  the shared semantic token system.
