FPL Wizard agent instructions
Workspace
Work only inside the currently opened fplwizard repository.

Never modify files outside this workspace.

Git workflow
Development branch: develop
Production branch: main
Never commit directly to main.
Never push or merge to main.
Never deploy production.
Do not commit or push unless explicitly requested.
Normally leave all changes uncommitted for review in GitHub Desktop.
Project structure
Frontend root:

index.html
styles.css
README.md
version.json
Frontend JavaScript:

src/api.js
src/app.js
src/models.js
src/models.legacy.js
src/store.js
Cloudflare Worker:

worker/src/index.js
Do not move files between these locations.

Environments
Production frontend: https://fplwizard.pages.dev

Production Worker: https://fplcomanager.andreashuvenaars.workers.dev

Development frontend: Cloudflare Pages develop preview

Development Worker: https://fplcomanager-preview.andreashuvenaars.workers.dev

Preview/development code must never use the production Worker.

FPL model
Preserve these features unless explicitly requested otherwise:

1GW xPts
3GW xPts
5GW xPts
expected minutes
team xG/xGA
season-transition layer
player attacking-share allocation
conversion calibration
FDR
Planner
Review
Performance
Calibration
Sync current team
frozen prediction snapshots
Do not tune the model just to make one player's xPts look plausible.

Model changes must have a model-wide statistical rationale.

Calibration
Frozen predictions are immutable.

Never recalculate historical frozen predictions with a newer model.

Every material xPts model revision must get a new modelVersion.

Preserve old model predictions so versions can be compared.

Validation
After changing frontend JavaScript, run:

node --check src/api.js node --check src/app.js node --check src/models.js node --check src/store.js

If worker/src/index.js changes, also run:

node --check worker/src/index.js

Do not consider the task complete when a required syntax check fails.

Versioning
For a user-visible release:

update version.json
update README.md
update cache query versions in index.html when relevant JS/CSS changes
Completion
At the end of every coding task:

Run required validation.
Do not commit or push unless explicitly requested.
List every changed file.
Briefly summarize the changes.
Mention all validation commands and whether they passed.
Preview
After completing a development change, remind the user to:

review the changes in GitHub Desktop;
commit to develop;
push origin;
test the develop Cloudflare Pages preview.
Use this preview URL when available:

https://develop.fplwizard.pages.dev

Never treat the production URL as the development preview.

Local permissions
Within this repository, you may without asking:

inspect repository files;
edit repository files required by the task;
create required project files;
run:
node --check src/api.js
node --check src/app.js
node --check src/models.js
node --check src/store.js
node --check worker/src/index.js
run read-only Git commands:
git status
git diff
git diff --stat
Never do without explicit user permission:

git commit
git push
git merge
git reset
git checkout main
wrangler deploy
modify files outside this repository
install new software or packages
Do not request permission merely to read or edit files inside the trusted fplwizard workspace when the requested task requires those changes.