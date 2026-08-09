# Frontend Type Safety

> Strict TypeScript and runtime validation at the Tauri trust boundary.

## Compiler Baseline

`tsconfig.app.json` enables `strict`, `noUncheckedIndexedAccess`, isolated
modules, and no emit. Keep these settings enabled. The build and `pnpm
typecheck` are both required gates; do not weaken the compiler to accommodate
a feature.

The application alias is `@/* -> ./src/*` in both TypeScript and Vite.
`components.json` points shadcn utilities and primitives at that same alias.

## Type Ownership

- Feature projections and component contracts live under
  `src/features/<feature>/types`.
- The TypeScript Tauri bridge owns request/response DTOs, runtime schemas, and
  normalization from unknown IPC values under `src/lib/tauri`.
- Components import shared view models and emit typed callbacks; they do not
  redeclare IPC or database shapes.
- Component-local types stay next to the component when no other module uses
  them.
- Generated shadcn primitive props should extend the underlying React element
  props, as `src/components/ui/button.tsx` does with
  `React.ComponentProps<"button">` and `VariantProps`.

## Runtime Validation

Generic parameters on Tauri `invoke` do not validate runtime data. Treat every
resolved value and rejection as `unknown`, validate it once in `src/lib/tauri`,
and return a frontend type only after the complete shape is accepted.

Zod is already pinned in `package.json` and is the default schema tool for IPC
payloads. Schemas must validate:

- the closed role and error-code unions;
- string IDs and integer epoch-millisecond timestamps;
- explicit nullable fields and JSON metadata;
- the complete `CommandError` shape, including retryability and safe details.

Malformed or unknown error payloads normalize to a safe, non-retryable
`internal` error. Components never parse error messages for control flow.

## Type Patterns

- Prefer discriminated unions for loading/streaming/error states instead of
  related booleans that allow impossible combinations.
- Prefer `readonly` arrays and read-only records at component boundaries.
- Use `satisfies` for fixtures/configuration when inference should be retained
  while a contract is checked.
- Model IPC nullability explicitly. Convert `null` to an optional frontend
  property only in the bridge/projection layer, not ad hoc in components.
- Check indexed values before use; do not bypass `noUncheckedIndexedAccess`.
- Keep IDs as the shared string aliases currently defined by the component
  contract; introduce branded IDs only through a coordinated contract change.

Example fixture shape:

```ts
const activePath = [
  { id: "root", role: "system", content: "safe fixture" },
  { id: "right", role: "user", content: "active branch" },
] satisfies readonly PathMessageView[]
```

## Forbidden Patterns

- `any`, `@ts-ignore`, unchecked double assertions, or broad casts from
  `unknown`.
- Trusting `invoke<ResultDto>()` without runtime decoding.
- Sharing raw SQLite rows or Rust-internal error/source shapes with React.
- Duplicating unions such as roles or error codes in component folders.
- Non-null assertions for ordinary control flow; fail early at true bootstrap
  boundaries, as `src/main.tsx` does for the required root element.
- Using message text or truthy/falsy coercion to distinguish domain states.

## Tests and Review

- Add success and malformed-payload tests for every bridge schema.
- Keep typed fixtures aligned with Rust serialization: field casing,
  nullability, timestamps, metadata, error codes, details, and retryability.
- Run ESLint's type-aware rules and `pnpm typecheck`; no warning suppression is
  an accepted substitute.
- Search for new `any`, `@ts-`, `as unknown as`, and raw `invoke` calls during
  cross-layer review.
