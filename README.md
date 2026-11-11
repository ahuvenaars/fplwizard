# FPL Mobile Planner

The browser-based planner uses the official FPL manager squad as its starting team and projects expected points for the next Gameweek, three Gameweeks, and five Gameweeks.

## Current team sync

Choose **Sync current team** on the Planner tab to refresh the official manager profile and squad, current/next Gameweek data, fixtures, full player universe, and squad player details. The Planner recalculates its 1GW, 3GW, and 5GW xPts and shows the official squad Gameweek and sync time. If the official squad differs from the loaded baseline, the current plan is reset to that squad and dependent future local plans are cleared.

Frozen Calibration predictions are kept separately in IndexedDB and are not rewritten by team sync. The public FPL squad endpoint is authoritative, but transfer or lineup changes made before the deadline may take time to appear there; the sync status reports the Gameweek returned by that endpoint.

## Local development

Serve this directory over HTTP so the browser can load the JavaScript modules. The client in `src/api.js` selects the production Worker on `fplwizard.pages.dev` and the preview Worker on other hostnames. The Worker entry point and Wrangler configuration are in `worker/src/index.js` and `wrangler.toml`.

## Local agent test

Copilot local workspace editing is configured correctly.
