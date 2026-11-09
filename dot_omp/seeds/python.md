# Seed: python

## Goal
Idiomatic, typed Python services and CLI tools with isolated environments.

## Rules
- **Public API typing.** Include type hints on all public functions, methods, and module exports.
- **Environment isolation.** Use `uv` (`uv run`, `uv add`) when `uv.lock` or `pyproject.toml` is present; never run global `pip install` (use `uv add` or `mise`).
- **Conditional linters.** Run `uv run ruff check` and `uv run mypy` only if configured in `pyproject.toml`.
- **Test with pytest.** Prefer `uv run pytest` for all unit and integration test suites.

## Verification
```bash
# If a project justfile defines check:
just check
# Otherwise:
uv run ruff check && uv run pytest
```
