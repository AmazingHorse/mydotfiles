# Archetype: legacy port (PHP/procedural -> strict TypeScript)

## Goal
Port legacy behavior into strict TypeScript without changing observable behavior.

## Rules
- **Parity first.** Reproduce existing behavior, quirks included. Log suspected
  bugs as follow-ups; do not fix them during the port.
- `tsconfig`: `strict: true`. No `any`, no `@ts-ignore`, and no non-null `!`
  without a comment explaining why.
- **Zod at boundaries.** Parse every external input (HTTP, DB rows, files, env)
  with a Zod schema and derive types with `z.infer`. Inner code trusts parsed types.
- **Strangler pattern.** Port one route or module at a time behind the existing
  entry point. Old and new paths must coexist until parity is proven.
- Write characterization tests against the legacy output before porting a unit.

## Verification
```bash
npx tsc --noEmit && npm test
```
