# Cloud Code Opus 429 Quota & omp Integration Findings

## 1. Executive Summary

When invoking `google-antigravity/claude-opus-5-5:high` through `omp`, requests failed with HTTP 429 `RESOURCE_EXHAUSTED` / `QUOTA_EXHAUSTED` despite `useG1Credits: true` in `~/.gemini/antigravity-cli/settings.json`.

**Root cause:**
1. **Provider decoupling:** `omp` does not call or wrap the Antigravity CLI (`agy`). It implements a standalone provider (`@oh-my-pi/pi-ai` -> `src/providers/google-gemini-cli.ts`) that calls Google's internal Cloud Code Assist API directly (`https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`).
2. **Ignored CLI settings:** `omp` never reads `~/.gemini/antigravity-cli/settings.json` and does not transmit `useG1Credits` or G1 credit metadata in its request envelopes.
3. **Model-specific backend quotas:** Even inside the Google Cloud Code Assist API, Claude Opus (`claude-opus-5-5-high`) is bound to a dedicated per-user quota window. Google One (G1) credits do not lift or bypass the hard cooldown on Opus when the individual tier limit is reached (reset window ~4h 27m).

---

## 2. Technical Findings

### 2.1 The Observed 429 Error
From `~/.omp/logs/omp.2026-10-26.96333.log`:
```json
{
  "error": {
    "code": 429,
    "message": "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h27m35s.",
    "status": "RESOURCE_EXHAUSTED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "QUOTA_EXHAUSTED",
        "domain": "cloudcode-pa.googleapis.com",
        "metadata": {
          "model": "claude-opus-5-5-high",
          "quotaResetDelay": "4h27m35.315954367s",
          "quotaResetTimeStamp": "2026-10-27T07:45:00Z",
          "uiMessage": "true"
        }
      }
    ]
  }
}
```

### 2.2 How `omp` Integrates with Antigravity / Cloud Code
- **Direct REST/SSE Client:** Rather than shelling out to `agy` or communicating via an IPC daemon, `omp` makes direct HTTPS POST requests with OAuth bearer tokens:
  - Endpoint: `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
  - Wire format: Custom Google Cloud Code Assist JSON envelope with `cascade_id`, `trajectory_id`, `model_enum`, and `used_claude` labels.
- **Settings bypass:** Settings stored in `~/.gemini/antigravity-cli/settings.json` are exclusive to `jetski/cli` (`agy` binary). `omp` has its own configuration in `~/.omp/agent/config.yml` and `~/.omp/agent/models.db`.

### 2.3 What `useG1Credits` Actually Does in Antigravity
Inspection of the `agy` ELF binary (`google3/third_party/jetski/cli`):
- `UseG1Credits` is a boolean on the Jetski Go CLI `ServerBackend` and `types.UserSettings`.
- It governs whether the CLI automatically consumes Google One AI Premium credits when standard Gemini quota is exhausted.
- **Scope limitation:** It targets Gemini quota exhaustion on Google One tiers. Cloud Code Assist's third-party hosted models (Claude 3.5/3.7/Opus) are subject to distinct Anthropic-capacity rate limits and quotas managed by Google Cloud. G1 credits do not provide unlimited Opus throughput.

### 2.4 Account Pool Status
- Running `agy-companion accounts list` confirms only a single live personal account (`billheughan@gmail.com`) is present.
- Without secondary pool accounts, any quota exhaustion on an individual model bucket halts requests until the server-side reset timestamp (`2026-10-27T07:45:00Z`).

---

## 3. Immediate Workarounds

1. **Failover to Gemini 3.8 Flash / Pro in `omp`:**
   In `~/.omp/agent/config.yml`:
   ```yaml
   modelPresets:
     gemini:
       defaultThinkingLevel: high
       modelRoles:
         default: google-antigravity/gemini-3.8-flash:high
         slow: google-antigravity/gemini-3.8-flash:high
         vision: google-antigravity/gemini-3.8-flash
   ```
   Gemini quotas are on a completely independent quota track with much higher throughput under Google One AI Premium.

2. **Wait for Quota Reset:**
   The active quota lock on `claude-opus-5-5-high` resets at **2026-10-27 07:45:00 UTC** (03:45:00 EDT).

---

## 4. Next Steps & Action Plan

### Phase 1: Graceful Cooldown & Fallback in `omp`
- [x] Configure `modelPresets` in `~/.omp/agent/config.yml` so that fallback routes exist when Opus encounters 429 quota exhaustion. (Audit 2026-10-30: present locally. Gemini 3.8 Flash is the default/slow role.)
- [ ] Manage `modelPresets` through chezmoi (`.chezmoitemplates/omp-managed-config.yml` / `modify_config.yml`). Today it lives only in the unmanaged local config, so a new workstation won't get it.
- [ ] Verify `omp` model presets cleanly select `gemini-3.8-flash:high` for heavy tasks while Opus is cooling down.

### Phase 2: Multi-Account Pooling (`agy-crew`)
- [ ] Add backup accounts to the `agy-crew` pool using `agy-crew accounts login <account_name>` to enable round-robin / cooldown failover.
- [ ] Ensure account cooldown tracking properly detects `QUOTA_EXHAUSTED` and the `quotaResetDelay` from Google Cloud Code Assist headers to suppress retries until the window elapses.

### Phase 3: Upstream Alignment (`@oh-my-pi/pi-ai`)
- [ ] Check if newer versions of `@oh-my-pi/pi-ai` support G1 credit envelope parameters or whether Antigravity's API exposes a G1 billing override header for external clients.
- [ ] Improve error reporting in `omp` so that `429 QUOTA_EXHAUSTED` displays the friendly reset countdown (`Resets in Xh Ym`) rather than an opaque API error.
