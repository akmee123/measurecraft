# MeasureCraft

AI-powered construction quantity takeoff & cost estimation platform for Quantity Surveyors.

Professional QS workspace with continuous polyline measurement, calibration, AI element detection (Gemini), material estimation, and Excel/PDF BOQ export.

## Pages

| File | Role |
|------|------|
| `public/login.html` | Login (demo: `demo@measurecraft.com` / `demo1234`) |
| `public/mode-select.html` | Choose Simple or Professional mode |
| `public/measurecraft_quantity_only.html` | Simple Mode — upload, calibrate, AI detect, market rates |
| `public/takeoff_pro.html` | Professional Mode — full takeoff tools + materials + AI |

## Local run

```bash
cd measurecraft
cp .env.example .env
# edit .env and set GEMINI_API_KEY from https://aistudio.google.com/apikey
npm install
npm start
```

Open http://localhost:3000

## Deploy on Render (from GitHub)

1. Push this folder to a GitHub repository.
2. In [Render](https://dashboard.render.com) → **New** → **Web Service**.
3. Connect the repo.
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Environment variables:
   - `GEMINI_API_KEY` = your Google AI Studio key (required)
   - `GEMINI_MODEL` = `gemini-3.5-flash` (optional; use `gemini-3.1-pro` for better box accuracy)
6. Deploy. Open the Render URL → login page.

Or use the included `render.yaml` (Blueprint): **New** → **Blueprint** → select the repo.

## API

- `GET /api/health` — status + whether the server key is set  
- `POST /api/detect-elements` — body `{ image_base64, mime_type, pixel_w, pixel_h }`  
- `POST /api/market-rates` — body `{ region, materials: [{ name, unit }] }`  
- `POST /api/assistant-chat` — body `{ message, history?: [{ role: 'user'|'assistant', text }] }`

AI features (element detection, market rates, AI assistant) require `GEMINI_API_KEY` to be set on the **server** (Render environment or `.env`). There is no browser-side key fallback — if the server key is missing or a request fails, the UI shows a clear error instead of prompting for a personal key.

### AI Assistant (chat bubble)

The bottom-right "AI Assistant" bubble on every page now calls `POST /api/assistant-chat`, which sends the question to Gemini with a system prompt scoped to MeasureCraft usage (calibration, drawing tools, AI detect, export, Simple vs Pro mode, etc.). It keeps a short rolling conversation history (last ~6 turns) client-side for follow-up questions. If the request fails — no `GEMINI_API_KEY`, network error, or rate limit — each page falls back to the previous keyword-matched canned replies, so the widget still says something useful offline. Like the other two AI endpoints, it's covered by the optional `MC_API_TOKEN` auth and the per-IP rate limiter (`MC_AI_RATE_LIMIT`, default 20/min).

## Demo login

- Email: `demo@measurecraft.com`  
- Password: `demo1234`

## Project audit (existing capabilities)

The uploaded codebase already implements a substantial professional takeoff workspace:

### Frontend
- Login + mode selection (Simple / Pro)
- PDF.js drawing underlay + canvas 2D viewer
- Continuous polyline wall/beam/deduction drawing (multi-point, Enter/Esc)
- Select, pan, zoom, calibrate, measure tools
- Editable elements (move, vertices, lock, hide, duplicate)
- Layers, properties panel, quantity table
- Undo/redo, copy/paste, keyboard shortcuts
- Dark / light theme (localStorage)
- 3D preview (Three.js)
- Export: Excel BOQ (SheetJS), PNG/PDF marked plan, project JSON, text report

### Backend
- Express static + Gemini element detection
- Market rates estimation endpoint
- CORS, JSON body (25mb) for plan images

### Quantity logic
- Wall face area with opening deductions along line
- Slab / column / beam volumes
- Brick, concrete, plaster, tiling, paint material breakdowns
- Contingency + grand total

## Recent improvements in this revision

1. **Project Information** expanded for QS workflows:
   - Project number, status (Draft → Completed), building type, floors, currency, units
   - Status reflected in the status bar
2. **Status bar** enhanced:
   - Scale, zoom %, element count
   - Markup colour legend (Wall / Deduct / Column / Beam / Slab / Opening)
3. **Toast notifications** for non-blocking feedback (calibration success/errors, export issues)
4. **Calibration UX**: clearer success message; scale does not resize the PDF underlay
5. **Excel BOQ export** header includes project number, location, status, building type, floors, currency, prepared-by
6. Design system preserved (brass/gold + teal, off-white / dark professional construction aesthetic)

## Recommended next phases (not all implemented in this pass)

Given the monolithic HTML architecture, further work should stay incremental:

1. Accept / Reject UI for AI detections with confidence scores
2. Dedicated dashboard page with project list (localStorage / backend persistence)
3. Grouping / ungroup measurements
4. Full cost stack (labour, plant, overheads, profit, tax) beyond materials + contingency
5. Split large HTML into modular JS modules without changing behaviour
6. Stronger PDF report generation (multi-page BOQ with page numbers)

## Security notes

- Never put `GEMINI_API_KEY` in frontend code; keep it in server `.env` / Render env
- Validate uploaded PDF/image types and size on the server for production
- Demo login is not production auth — replace before public deployment

## Bug fixes & connectivity (this pass)

1. **Removed the client-side Gemini key fallback** in both Simple and Pro Mode. AI features now rely solely on the server `GEMINI_API_KEY` — no key prompt/localStorage key in the browser. If the server key is missing, the UI shows a clear message instead of asking for a personal key.
2. **Simple ↔ Pro Mode is now actually connected.** Pro Mode already had code to receive a handoff (image, calibration, accepted elements) via `sessionStorage` + IndexedDB, but Simple Mode never wrote that data — "Continue in Pro Mode" silently discarded all work. Simple Mode now packages the current drawing, scale, and accepted elements and hands them to Pro Mode on both the header "Open Pro" button and the final-step "Continue in Pro Mode" button.
3. **Fixed a login bypass**: Simple Mode had no session check at all, unlike Mode Select and Pro Mode, so it was reachable without logging in. It now redirects to the login page if there's no session.
4. **Fixed `render.yaml`** pinning `GEMINI_MODEL` to `gemini-2.0-flash`, a model already shut down by Google per the code's own comments — this would have silently broken AI detection on a fresh Render Blueprint deploy. Now defaults to `gemini-3.5-flash`.
5. **Fixed a display bug** in Simple Mode where the "scale not calibrated" warning was set and then immediately overwritten before it ever appeared on screen.
6. **Added the file-size validation** the upload UI always claimed to enforce (25 MB) but never actually checked.
7. **Simple Mode usability**: project detail fields (name, client, location, currency, region) now autosave to this browser and restore on reload; added a one-time "how this works" banner, a "Start over" reset action, an unsaved-work warning before closing the tab mid-project, and disabled the "Fetch market rates" button while a request is in flight to avoid duplicate calls.


## Fixes applied in this revision

- Professional Mode AI detection is now additive: manual measurements, QS-reviewed elements, and prior AI proposals are preserved instead of being deleted.
- Professional Mode quantity calculations now require explicit acceptance or QS review for AI-origin elements before they contribute to costing or exports.
- Tiled detection now uses real overlapping image crops when `sharp` is available, maps crop coordinates back to the source image, and reports `realCrop` in the validation metadata. A logical full-image fallback remains for environments without `sharp`.
- Production responses now include baseline security headers, CORS can be restricted with `ALLOWED_ORIGINS`, and AI routes fail closed when `MC_API_TOKEN` is missing in production.
- Production authentication now requires a `JWT_SECRET` of at least 32 characters.
- Updated `sharp` to the latest available version and verified that the production dependency audit has no reported vulnerabilities at the time of this revision.

For production, set `NODE_ENV=production`, `ALLOWED_ORIGINS` to the deployed app origin, `MC_API_TOKEN`, `JWT_SECRET`, `GEMINI_API_KEY`, and `RESEARCH_ADMIN_TOKEN`. Do not ship the demo login path or demo credentials in a public deployment; remove them from the production build before inviting real users.
