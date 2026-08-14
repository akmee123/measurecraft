# MeasureCraft — Research & user-testing guide

This build adds structured data collection for final-year Quantity Surveying research **without changing** existing takeoff tools, AI detection, or BOQ calculations.

## Recommended architecture

| Concern | Recommendation | Why |
|--------|------------------|-----|
| Application code | GitHub | Version control; no private drawings |
| Uploaded drawings | Local cache under `data/drawings/`, mirrored to private S3 when enabled | Original files kept unchanged; not public |
| Measurement records | Local JSONL under `data/research/`, mirrored to private S3 when enabled | Append-only locally; durable object copies in production |
| Live analysis sheet | Google Sheets via Apps Script webhook | Familiar for researchers; access-controlled share |
| Researcher UI | `/research/dashboard.html` + admin token | Filter, compare, export CSV/JSON |
| AI training | **Manual only** | `forAiTraining` / `selectedForAiTraining` default false |

**GitHub is not appropriate for private drawings.** Keep drawings and JSONL under `data/` (or a persistent disk / private bucket in production). Optionally sync **tabular** rows only to Google Sheets.

On free Render hosting the filesystem is ephemeral. For lasting storage, enable the built-in S3-compatible mirror by setting `RESEARCH_STORAGE=s3` and the variables below. The application hydrates its local cache from the bucket at startup and mirrors every JSONL, annotation, counter, and drawing write. S3 append-only logs are implemented as read-modify-write objects, so this is intended for the study’s moderate 30–50 drawing collection rather than high-concurrency ingestion. Google Sheets remains available as an additional tabular sync path.

| Variable | Required | Meaning |
|---|---:|---|
| `RESEARCH_STORAGE` | Yes for S3 | Set to `s3` |
| `RESEARCH_S3_BUCKET` | Yes for S3 | Private bucket name |
| `RESEARCH_S3_REGION` | Recommended | AWS region; use `auto` for providers that require it |
| `RESEARCH_S3_ENDPOINT` | Provider-dependent | Custom endpoint for Cloudflare R2, Backblaze B2, or another S3-compatible provider |
| `RESEARCH_S3_PREFIX` | Optional | Object prefix; defaults to `measurecraft-research` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Yes unless using an ambient role | Bucket credentials with least-privilege read/write access |

If `RESEARCH_STORAGE` and the bucket variable are absent, behavior remains the existing local `RESEARCH_DATA_DIR` or `data/` behavior. If S3 is temporarily unavailable, the application logs the mirror failure and continues using its local cache; verify bucket health before treating a collection round as durable.

## Comparison data model

Each measurement record can hold:

- `referenceMeasurement` — professional software / ground truth  
- `aiMeasurement` — AI web-app proposal  
- `simpleModeMeasurement` / `proModeMeasurement` — mode-specific user result  
- `userMeasurement` / `finalAcceptedMeasurement` — corrected final  
- `difference`, `differencePct`, `userCorrection`, `measurementDurationSec`

Same `drawingId` + `measurementType` can be compared across methods later in Excel or the dashboard.

## Setup

1. Copy `.env.example` → `.env`.
2. Set `RESEARCH_ADMIN_TOKEN` (required for dashboard in production).
3. For durable object storage, set the S3 variables above; otherwise set `RESEARCH_DATA_DIR` to a persistent mounted directory.
4. Optionally follow `docs/google-sheets-apps-script.md` and set `GOOGLE_SHEETS_WEBHOOK_URL`.
5. Run `npm start`, open the app, and enter a Participant ID on mode select.

## User workflow

1. Login  
2. Enter **Participant ID** (e.g. `P01`) — not full name  
3. Choose Simple or Pro (starts a research session)  
4. Upload drawing → registered as `PROJ-####` / `DWG-####`  
5. Calibrate, measure, AI detect, review/correct  
6. Export Excel BOQ → material + element rows logged  
7. Researcher opens `/research/dashboard.html`, enters admin token, filters/exports  

## Privacy

- Prefer participant **codes**, not legal names or emails  
- `data/` is gitignored — do not commit drawings or JSONL  
- Dashboard and drawing download require `X-Research-Token` when token is set  
- Nothing is sent to Gemini for training from this research pipeline  
- Google Sheet should be shared only with you / supervisors  

## API (summary)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/research/session/start` | none |
| POST | `/api/research/session/end` | none |
| POST | `/api/research/project` | none |
| POST | `/api/research/measurement` | none |
| GET | `/api/research/summary` | admin token |
| GET | `/api/research/records` | admin token |
| GET | `/api/research/export?format=csv\|json` | admin token |
| GET | `/api/research/drawing/:drawingId` | admin token |

Admin header: `X-Research-Token: <RESEARCH_ADMIN_TOKEN>`

## Drawing database & GitHub review

Uploaded plans are cached under `data/drawings/` (e.g. `DWG-0001.jpg`) with metadata in `data/research/projects.jsonl`; when S3 mode is enabled, the same relative paths are mirrored beneath the configured bucket prefix.

1. Open `/research/dashboard.html` with `RESEARCH_ADMIN_TOKEN`.
2. **List stored drawings** → download each file.
3. Manually check correctness (scale, clarity, no wrong sheet).
4. Copy **only approved** files into a private GitHub folder (do not commit unreviewed data).

Project / client marketing titles are separate from the research file id (`drawingId`).

## Training AI from human measurements

Human Pro measurements and `userCorrection` rows are ground truth for improving detection.

- Dashboard → **Download training export (JSON)** builds a dataset of AI vs human values + drawing ids.
- MeasureCraft does **not** fine-tune Gemini automatically (API models are not trained on your disk).
- Use the export + reviewed drawing images in your own training / evaluation pipeline (custom detector, fine-tune, etc.).

## Participant ID rules

- One **email** → one **Participant ID** for life of the study (cannot change).
- One **Participant ID** cannot be used by two emails.
- Login (email/Gmail) binds permanently; mode-select reuses the locked id.

## Delete records

Researchers can delete individual measurement rows from the dashboard (Delete button). Drawing objects remain in local cache and S3 until removed manually; deleting a JSONL row does not delete the corresponding original drawing.
