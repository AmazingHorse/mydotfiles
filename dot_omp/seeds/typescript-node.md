# Seed: typescript-node

## Goal
Reliable, strictly typed TypeScript applications and libraries on Node.js.

## Rules
- **Strict TypeScript.** No `any` or loose type assertions. Use precise unions, generics, or `unknown` with narrowing.
- **LSP-first.** Use LSP tools for definitions, references, and renames before text-searching code.
- **Modern ESM/CJS boundaries.** Respect project module resolution and tsconfig compiler options.
- **Lint discipline.** Run `npm run lint` when a lint script is present in `package.json`.

## Verification
```bash
npx tsc --noEmit && npm test
```
