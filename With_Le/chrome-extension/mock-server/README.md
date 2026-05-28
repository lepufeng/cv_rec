# Mock Backend Server

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
