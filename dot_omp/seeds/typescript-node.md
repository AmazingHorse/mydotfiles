# Seed: typescript-node

## Goal
Reliable, strictly typed TypeScript applications and libraries on Node.js.

## Rules
- **Strict TypeScript.** No `any` or loose type assertions. Use precise unions, generics, or `unknown` with narrowing.
- **LSP-first.** Use LSP tools for definitions, references, and renames before text-searching code.
- **Modern ESM/CJS boundaries.** Respect project module resolution and tsconfig compiler options.
- **Toolchain priority.** Prefer `bun` (`bun test`, `bun x tsc --noEmit`) when `bun.lock` or `bun.lockb` is present. Fall back to `pnpm`/`npm` only when the project lockfile dictates.
- **Lint discipline.** Run `just check` (or `bun x eslint` / `npm run lint`) when configured in the repository.

## Verification
```bash
# If a project justfile defines check:
just check
# Otherwise (bun-native fallback):
bun x tsc --noEmit && bun test
```
