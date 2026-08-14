# Google Sheets integration (research data)

MeasureCraft can append each measurement row to a Google Sheet via a simple **Google Apps Script** web app.  
This keeps research data off GitHub and gives you a live spreadsheet for analysis.

## 1. Create a sheet

1. Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet (e.g. `MeasureCraft User Testing`).
2. Rename the first tab to `Measurements`.
3. Put this header row in `A1:V1`:

```
recordId	participantId	projectId	drawingId	date	time	measurementMode	measurementType	measurementMethod	referenceMeasurement	aiMeasurement	userMeasurement	simpleModeMeasurement	proModeMeasurement	finalAcceptedMeasurement	unit	difference	differencePct	userCorrection	measurementDurationSec	notes	elementLabel
```

## 2. Apps Script

1. **Extensions → Apps Script**
2. Replace the default code with:

```javascript
const SHEET_NAME = 'Measurements';
// Optional: set the same value as GOOGLE_SHEETS_WEBHOOK_SECRET on the server
const SHARED_SECRET = '';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const row = body.row || body;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const order = [
      'recordId', 'participantId', 'projectId', 'drawingId', 'date', 'time',
      'measurementMode', 'measurementType', 'measurementMethod',
      'referenceMeasurement', 'aiMeasurement', 'userMeasurement',
      'simpleModeMeasurement', 'proModeMeasurement', 'finalAcceptedMeasurement',
      'unit', 'difference', 'differencePct', 'userCorrection',
      'measurementDurationSec', 'notes', 'elementLabel'
    ];
    sh.appendRow(order.map(function (k) {
      var v = row[k];
      return v == null ? '' : v;
    }));
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (the secret protects writes if you set it)
4. Copy the web app URL.

## 3. Server environment

In `.env` or Render environment variables:

```
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
GOOGLE_SHEETS_WEBHOOK_SECRET=optional-shared-secret
RESEARCH_ADMIN_TOKEN=choose-a-strong-token
```

## 4. Privacy notes

- Share the Google Sheet only with you (and supervisors).
- Do not put the webhook URL or secret in public GitHub.
- Participant IDs should be codes (P01, QS-03), not full names or emails.
- Drawing binary files stay on the server under `data/drawings/` (gitignored) — not in the sheet.

## 5. Reference measurements

To compare against professional software:

1. Measure the same items in your reference software (e.g. Bluebeam, CostX, Excel takeoff).
2. Either:
   - Add a `referenceMeasurement` column value when logging (API supports it), or
   - Fill the Reference column in the sheet after testing sessions.

The dashboard computes difference and % error when both final and reference (or AI) values exist.
