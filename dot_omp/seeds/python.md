# Seed: python

## Goal
Idiomatic, typed Python services and CLI tools with isolated environments.

## Rules
- **Public API typing.** Include type hints on all public functions, methods, and module exports.
- **Environment isolation.** Use project virtualenvs via mise or uv; never run global `pip install`.
- **Conditional linters.** Run `ruff check` and `mypy` only if configured in `pyproject.toml`.
- **Test with pytest.** Prefer `pytest` for all unit and integration test suites.

## Verification
```bash
pytest
```
