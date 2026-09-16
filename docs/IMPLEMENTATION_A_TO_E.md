# Implementation summary — Priorities A–E

This revision delivers the foundations requested for:

| ID | Feature | Status |
|----|---------|--------|
| A | Accuracy Dashboard + learning-loop metrics | **Done** — uses existing `/api/research/accuracy-baseline` + research store precision/recall; YOLO export feeds the learning loop |
| B | Real image tiling | **Partial** — logical tiled multi-pass is live; install `sharp` for true high-res crops (code structured to accept it next) |
| C | Backend authentication (JWT + hashed passwords) | **Done** — `auth.js` + `/api/login`, `/api/register`, `/api/me` |
| D | Smart snapping | **Done** — `public/js/smart-snap.js` (endpoint, edge, column, opening→wall) |
| E | YOLO export from research store | **Done** — `scripts/export-yolo.js` + `/api/research/yolo-export` |

## How to use each piece

### A — Accuracy metrics
```bash
# Via research dashboard (token required) or API:
curl -H "X-Research-Token: $RESEARCH_ADMIN_TOKEN" \
  "http://localhost:3000/api/research/accuracy-baseline"
```
Returns per-class precision, recall, quantity error when reference quantities / reviewed annotations exist.

### B — Tiled detection
Already default in Simple + Pro Mode (`mode: "tiled"`).  
When you install `sharp`, the next step is to replace logical tile prompts with real cropped tiles for higher effective resolution on small openings.

```bash
npm install sharp
```

### C — Auth
```bash
npm install bcryptjs jsonwebtoken   # recommended
```

```http
POST /api/login
{ "email": "demo@measurecraft.com", "password": "demo1234" }
→ { token, user }

GET /api/me
Authorization: Bearer <token>
```

Set `JWT_SECRET` in `.env` for production. Demo login still works; passwords are hashed when bcryptjs is present.

### D — Smart snapping
Include in takeoff pages:

```html
<script src="/js/smart-snap.js"></script>
```

```js
const result = MCSnap.snapPoint(x, y, {
  elements: state.elements,
  tolerancePx: 12,
  snapWallToWall: true,
  snapWallToColumn: true,
  snapOpeningToWall: true,
});
// Wire into mousedown / mousemove of the drawing tools
```

### E — YOLO export
```bash
# After QS has reviewed drawings in the research flow:
node scripts/export-yolo.js --out ./yolo-dataset

# Or via API (admin token):
curl -X POST -H "X-Research-Token: $RESEARCH_ADMIN_TOKEN" \
  http://localhost:3000/api/research/yolo-export
```

Produces `images/`, `labels/`, `data.yaml`, `manifest.json` ready for Ultralytics YOLO training.

## Recommended next commits
1. Wire `MCSnap` into Pro Mode continuous polyline and opening tools.
2. Add Accept-all-above-threshold filter in the AI review modal.
3. When `sharp` is available, implement real tile cropping in `runGeminiDetect` path.
4. Replace frontend demo credential check with `/api/login` + stored JWT.
5. Train first YOLO model from 50+ reviewed Sri Lankan house drawings.

## Security note
Until JWT is enforced on all routes and demo credentials are removed from HTML, treat the app as **demo / research only**. Do not upload confidential client drawings to a public instance.
