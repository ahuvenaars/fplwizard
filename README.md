# FPL Mobile Planner

The browser-based planner uses the official FPL manager squad as its starting team and projects expected points for the next Gameweek, three Gameweeks, and five Gameweeks.

## Current team sync

Choose **Sync current team** on the Planner tab to refresh the official manager profile and squad, current/next Gameweek data, fixtures, full player universe, and squad player details. The Planner recalculates its 1GW, 3GW, and 5GW xPts and shows the official squad Gameweek and sync time. If the official squad differs from the loaded baseline, the current plan is reset to that squad and dependent future local plans are cleared.

Frozen Calibration predictions are kept separately in IndexedDB and are not rewritten by team sync. The public FPL squad endpoint is authoritative, but transfer or lineup changes made before the deadline may take time to appear there; the sync status reports the Gameweek returned by that endpoint.

## Local development

Serve this directory over HTTP so the browser can load the JavaScript modules. The client in `src/api.js` selects the production Worker on `fplwizard.pages.dev` and the preview Worker on other hostnames. The Worker entry point and Wrangler configuration are in `worker/src/index.js` and `wrangler.toml`.

## Local agent test

Copilot local workspace editing is configured correctly.

## Player decision view

Player and transfer-target popups emphasize 1GW/3GW/5GW xPts, expected minutes and start security, upcoming fixtures, xGI, points and defensive contribution rates, clean-sheet probability, price efficiency, role data, and a conservative multi-signal recent trend. Transfer targets show their projected 3GW and 5GW xPts gain over the player being replaced.

Model 3.1 calculations and frozen Calibration snapshots are unchanged. Advanced model diagnostics are hidden in normal use and can be shown by adding `?debug=1` to the frontend URL, including the develop preview.
