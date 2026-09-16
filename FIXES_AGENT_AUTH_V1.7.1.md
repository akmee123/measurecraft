# MeasureCraft v1.7.1 — Agent Authentication Fix

Fixes Render/production Agent failures caused by `X-MC-Token` being configured while browser users only had a MeasureCraft login session.

- Email/Google sessions now receive a signed browser API credential.
- Existing sessions can refresh a signed credential through `/api/auth/session-token`.
- Agent requests send the session credential as `Authorization: Bearer ...`.
- Shared `MC_API_TOKEN` remains supported for service-to-service calls.
- Gemini API keys remain server-side.
- No AI proposal is auto-accepted.
