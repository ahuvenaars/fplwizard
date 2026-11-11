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

The normal player popup emphasizes 3GW xPts, expected minutes and start security, 1GW/5GW horizons, price efficiency, upcoming fixtures, recent results, and set-piece roles. Transfer-target profiles add xGI/90, points/90, clean-sheet probability, DefCon, trend, and projected gains over the player being replaced.

Model 3.1 calculations and frozen Calibration snapshots are unchanged. Advanced model diagnostics are hidden in normal use and can be shown by adding `?debug=1` to the frontend URL, including the develop preview.

The player popup shows compact identity and ownership badges, three horizontal upcoming-fixture cards, and up to three recent completed results. The conservative multi-signal trend appears as a compact note, not a standalone metric card. The `Advanced model diagnostics` section remains available only with `?debug=1`.

## Free Hit workspace

The **Free Hit** tab keeps a temporary squad draft per Gameweek, separately from Planner plans and Calibration snapshots. It starts from the official squad, uses one-Gameweek projections, and supports same-position replacements, lineup switching, captaincy, and an optimized XI without consuming Free Transfers or changing Planner data. Reset asks for confirmation and rebuilds only that Gameweek's draft from the official squad.

The initial Free Hit budget is estimated from the official squad value plus bank; if those values are unavailable, the UI falls back to £100.0m. Replacement credits the outgoing player's current listed price because the public squad payload does not provide the manager's individual selling price. The draft's squad cost, bank, and FPL roster/formation rules are validated locally.

The Free Hit tab also lists every fixture returned for the selected Gameweek, including double fixtures as separate matches, kickoff times when supplied, and each side's FDR. Its fixture/blank/double summary and replacement options follow the selected Gameweek; blank replacement targets are labeled `Blank · 0.0 xPts`.

The Free Hit workspace includes a read-only comparison with the Planner team for that Gameweek, or the latest official squad when no valid Planner lineup exists. Both teams use the same selected-Gameweek projection method; expected gain is the captain-adjusted Free Hit XI minus the captain-adjusted current XI. The collapsible comparison shows lineups, player fixtures, squad changes, fixture and club exposure. If the baseline changes after a sync, the existing Free Hit draft is retained and can be explicitly rebased for comparison.

Planner lineup switches atomically exchange player IDs between lineup slots. Before rendering or saving, the Planner checks for duplicate or missing players, valid starter/bench membership, and a valid starting formation. Invalid swaps are rolled back, reported, and leave switch mode cleared.
