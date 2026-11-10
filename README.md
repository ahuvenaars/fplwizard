# FPL Mobile Planner

The browser-based planner uses the official FPL manager squad as its starting team and projects expected points for the next Gameweek, three Gameweeks, and five Gameweeks.

## Current team sync

Choose **Sync current team** on the Planner tab to refresh the official manager squad, Gameweek data, fixtures, player universe, and player details. The planner recalculates its 1GW, 3GW, and 5GW xPts from the refreshed data. If the official squad differs from the previously loaded official squad, the current plan is reset to that team and dependent future local plans are cleared.

Frozen Calibration predictions are kept separately in IndexedDB and are not overwritten by team sync.

## Local development

Serve this directory over HTTP so the browser can load the JavaScript modules. The client in `src/api.js` selects the production Worker on `fplwizard.pages.dev` and the preview Worker on other hostnames. The Worker entry point and Wrangler configuration are in `worker/src/index.js` and `wrangler.toml`.
