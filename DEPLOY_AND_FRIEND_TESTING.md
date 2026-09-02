# MeasureCraft Deployment and Friend Testing Guide

## 1. Important data warning

The application stores research records and uploaded drawings on the server filesystem. A standard free Render web service may use an ephemeral filesystem, so files can be lost after a restart, redeploy, or service replacement. For a real research study, use a persistent disk or change the storage layer to an external database/object store before relying on the uploaded drawings as permanent evidence.

Do not put the Gemini API key in frontend files, GitHub, screenshots, or messages. It belongs only in Render Environment Variables.

## 2. Deploy from GitHub

Create a private GitHub repository and upload the contents of the extracted `measurecraft5-main` folder. Do not upload `.env`, private drawings, or research JSONL files.

In Render, choose **New → Blueprint** if you want to use the supplied `render.yaml`, or choose **New → Web Service** and connect the private repository.

Use the following settings if creating the service manually:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Node version | `20` or newer |
| Plan | Free for initial testing; use persistent storage for a real study |

The supplied Blueprint already configures these values and asks for the secret Gemini and research-admin variables.

## 3. Add Render environment variables

In the Render service, open **Environment → Environment Variables** and add:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google AI Studio/Gemini server key |
| `GEMINI_MODEL` | `gemini-3.5-flash` for faster testing, or your tested higher-accuracy model |
| `RESEARCH_ADMIN_TOKEN` | A long private password for the research dashboard |
| `MODE_SWITCH_PASSWORD` | A private password for Simple ↔ Professional mode switching |

You may also set `MC_API_TOKEN` to protect AI endpoints, but only do this after confirming that the frontend is configured to send the same token. Never expose that token to friends through public messages.

After saving the variables, select **Manual Deploy → Deploy latest commit**. Open the service URL and confirm that the login page loads. You can also check `/api/health`; it should report `ok: true` and `hasKey: true`.

## 4. Test the application yourself first

Use one test email to enter the application. Upload a drawing, calibrate the scale using a known dimension, enter the drawing legend, and run AI detection. Check that the AI boxes appear and that the review workflow works.

Correct several elements manually in Professional Mode. Run AI detection again and confirm that manual and QS-edited elements remain while only unreviewed AI proposals are replaced. Export a sample BOQ and confirm that the quantities are sensible.

## 5. Give friends access

Send friends only the public Render URL, for example:

```text
https://your-service-name.onrender.com
```

They can select **Continue with email**, enter their email address, optionally provide a participant ID such as `P01`, and use Simple Mode. They should upload their own drawing, calibrate it, enter the legend, run AI detection, review the results, and continue to Professional Mode when they need detailed correction.

The current email join is a research-study access flow, not full production authentication. Anyone who knows the URL may be able to create a participant session. Do not use it for confidential commercial drawings until proper authentication and storage controls are added.

## 6. Instructions to send to friends

Give each participant the following instructions:

1. Use a participant code rather than your full name where possible.
2. Upload a clear original plan, preferably PDF or high-resolution PNG/JPG.
3. Calibrate using a dimension that is clearly known and visible on the drawing.
4. Enter the plan legend, including colours, line styles, symbols, and items to ignore.
5. Run AI detection once and review every result.
6. Accept correct elements, reject false elements, and manually add missing elements.
7. In Professional Mode, correct walls and beams using their true line endpoints and thickness where needed.
8. Export the result if requested by the study coordinator.
9. Do not upload drawings containing confidential client information unless the study has permission to store them.

## 7. Collect corrected drawings for future AI improvement

The current package now saves the final reviewed geometry automatically when a participant exports the BOQ or marked drawing. It stores a structured annotation record linked to the Drawing ID and Project ID, including rectangles, line endpoints, polygons, thickness, scale, source, review status, and legend notes.

A researcher can download the reviewed annotation dataset from:

```text
https://your-service-name.onrender.com/api/research/annotation-export
```

The endpoint is protected by `RESEARCH_ADMIN_TOKEN`. The combined legacy research/training export is available at `/api/research/training-export` and includes both measurement samples and `reviewedAnnotations`.

The AI still will not permanently learn from corrections automatically. First review the exported dataset, keep the original drawings and annotations together, remove incomplete records, and reserve complete drawings as an untouched test set. Then compare AI detections with the QS-reviewed version and track precision, recall, overlap, and quantity error by element type. Use the reviewed data for prompt calibration or convert it to YOLO/COCO format for a dedicated detector-training pipeline.

## 8. Protect the research dashboard

Open:

```text
https://your-service-name.onrender.com/research/dashboard.html
```

Use the `RESEARCH_ADMIN_TOKEN` value when prompted or when the dashboard asks for the research token. Keep this URL and token private. Do not send the admin token to participants.

## 9. Before a real study

Before inviting many users, add persistent storage or an external database/object store, add proper user authentication, define a privacy/consent process, and create a backup procedure. The free Render filesystem should be treated as temporary testing storage unless Render confirms that your chosen storage configuration persists across restarts and deploys.
