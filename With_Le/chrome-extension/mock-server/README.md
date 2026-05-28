# Mock Backend Server

> Legacy-only helper. The production MVP now connects the extension to the
> FastAPI backend at `http://127.0.0.1:8000/api/v1` through
> `/fill-plans/plugin-scan` and `/fill-plans/plugin-match`. Use this mock
> server only when developing the extension in isolation.

Simulates the backend API for the Resume Auto-fill Chrome extension.

## Usage

```
npm start
# or
node server.js
```

Server runs on port 3000. Endpoints:

- `GET /api/resume/:id` — return the test resume JSON
- `POST /api/match-fields` — rule-based field matching (simulates the LLM)
- `POST /api/page-fields` — save a page-fields scan uploaded from the popup
- `GET  /api/page-fields/list` — list saved scans
- `GET  /api/page-fields/<file>` — fetch a specific scan file

Saved scans live under `mock-server/scans/<timestamp>__<host>.json`.

Start this server before testing the extension.
