# Archetype: data pipeline (TypeScript / SQL / spatial ETL, spreadsheet ingestion)

## Goal
Reliable, re-runnable ingestion and transformation with diagnosable failures.

## Rules
- **Idempotent.** Re-running a job on the same input yields the same end state.
  Use natural keys / upserts, never blind inserts.
- **Safety rails.** Every write path supports `--dry-run` (report what would
  change) and runs inside a transaction or has a documented rollback.
- **Stream in batches.** Never load a whole file or table into memory. Use
  bounded batches with backpressure, and log progress per batch.
- **Structured schema diagnostics.** On bad input, report file, sheet, row,
  column, expected type, and actual value as structured output (JSON lines), not
  free text. Fail the batch, not the process, unless the input is unusable.
- Spatial data: state the SRID explicitly and validate geometry before writing.

## Verification
```bash
npx tsc --noEmit && npm run test:fixtures
```
