# Facebook Ready Publisher Fast Batch Model

## Why the old path is slow

The successful 10-car gallery posting run showed that the browser portion can be fast when the work is staged as a batch. The slower `facebook-ready-publisher` runs spend time on repeated safety work that should be batched or moved later:

- Candidate and backend state checks are mixed into the live posting loop.
- Marketplace duplicate checks are repeated per vehicle and repeated again before composer, before Next, and before Publish.
- Older run artifacts show many `facebook-selling-search-*.dom.txt` files for one run, including broad per-title searches and follow-up searches.
- Package prep is repeated per car because current CPC packages use `media/`, while the legacy upload planner expects `photos/photo-records.json`.
- Cover proof/contact-sheet work can pollute a picker folder unless upload-ready folders are built cleanly.
- Backend Facebook status/legacy marker writes happen during sweeps, before the final live publish verification.
- Screenshots, DOM dumps, waits, and page reloads are used as proof collection throughout the action path instead of being concentrated at strict checkpoints.

## Target structure

Use the fast batch path in this order:

1. Candidate detection once.
2. Live Facebook skip verification once, preferably from a full selling-page sweep.
3. Upload-ready package generation once.
4. Fast Chrome/DevTools-style posting loop.
5. Strict per-listing pre-Next verification.
6. Final selling-page verification sweep.
7. Marker/backend status repair after live verification.
8. Timing ledger written for every phase and vehicle.

The only per-vehicle browser work inside the action loop should be:

- open/create listing form;
- verify `Konner John`;
- direct file chooser upload from exact `photoPaths`;
- wait for exact `Photos N / 20`;
- fill fields;
- read back critical form values from the current DOM snapshot;
- click Next/Publish only after verification;
- record the result.

## Reusable helper

Use:

```bash
npm run publisher:fast-batch -- plan \
  --run-dir /absolute/run-dir \
  --inventory-file /absolute/production-active-gallery-cars.json \
  --facebook-file /absolute/facebook-selling-full.json \
  --published-results-file /absolute/publish-results.json
```

This writes:

- `fast-batch-plan.json`
- `fast-batch-timing-ledger.json`

For package prep:

```bash
npm run publisher:fast-batch -- prep-packages \
  --run-dir /absolute/run-dir \
  --post-queue-file /absolute/post-queue.json \
  --packages-dir /absolute/run-dir/packages \
  --cover-order-file /absolute/run-dir/cover-upload-order.json
```

This writes:

- `upload-ready-summary.json`
- `fast-batch-timing-ledger.json`
- clean `upload-ready/*/photos`
- clean `upload-ready/*/facebook-upload-photos`
- per-package `photo-upload-plan.json`

The helper never opens Facebook, clicks Next, clicks Publish, mutates production, or repairs markers.

## Integrated publisher entrypoint

Use the real publisher entrypoint for automation runs:

```bash
npm run publisher:ready -- --dry-run
```

The publisher calls `scripts/facebook_ready_publisher_fast_batch.mjs` with Node child processes:

- `plan` runs in `01-fast-batch-plan/` and consumes one inventory/app-gallery snapshot plus one Facebook selling-page sweep artifact.
- `prep-packages` runs in `02-upload-ready-prep/` only for vehicles classified as true missing `readyToPost` items.

Safe modes:

- `--plan-only`
- `--prep-only`
- `--dry-run`
- `--stop-before-next`
- `--stop-before-publish`
- `--publish`
- `--stocks STOCK1,STOCK2`
- `--max N`

Default behavior is publish-safe. If `--publish` is missing, the integrated report writes `publishGate.willClickPublish=false` and `publishGate.reason="missing --publish"`. Dry/default-safe runs do not open Facebook, claim Chrome tabs, click Next, click Publish, mutate production, or repair markers.

The integrated publisher writes a timestamped run folder with:

- `integrated-dry-run-report.json`
- `timing-ledger.json`
- `classification-ledger.json`
- `skipped-vehicles.json`
- `price-update-candidates.json`
- `blocked-vehicles.json`
- `posting-loop-plan.json`
- `files-changed.json`
- `test-results.json`

Classifications are:

- `alreadyLive`
- `readyToPost`
- `priceUpdateCandidate`
- `blocked`
- `needsReview`

`priceUpdateCandidate` vehicles are review/update work, not new post work. The 10 successful gallery-run vehicles can be supplied through `--published-results-file` as already-live evidence, but future action runs must still use fresh Facebook live-state evidence before opening a composer, uploading photos, clicking Next, or clicking Publish.

The reusable browser executor lives in `scripts/facebook_ready_publisher_browser_executor.mjs`. It encodes the fast method from the 10-car run: seller wait for Konner John, direct `filechooser.setFiles(photoPaths)`, cover-first upload folders, exact `N / 20` photo counter wait, role locators, scoped combobox/listbox selection, strict body-style readback, duplicate make/model preview checks, pre-Next DOM snapshot verification, post-publish edit-form readback that blocks numeric Facebook Make/Model IDs, post-publish live verification, and final selling-page sweep before marker/status repair.

## Timing ledger fields

The persistent timing schema is `facebook-ready-publisher-fast-batch-timing-v1`.

Phase timings:

- `candidateScan`
- `facebookLiveCheck`
- `queueBuild`
- `coverPlanLoad`
- `photoPackagePrep`
- `finalVerification`
- `markerRepair`

Per-vehicle timings to append from the browser posting loop:

- `photoUpload`
- `formFill`
- `publish`
- `postPublishEditVerification`
- `finalVerification`
- `markerRepair`

## Safety rules to preserve

- Do not publish from stale local package folders.
- Do not post if production source-active/package status is ambiguous.
- Do not rely only on backend cached Facebook state before a publish action.
- Do not treat title-only matches as safe for duplicate title/price groups.
- Do not force marker writes in current photo-albums mode when no active legacy row exists.
- Do not proceed if body style, photo count, title, price, mileage, clean title, fuel, transmission, location, or seller account cannot be read back.
- Do not mark a freshly published listing complete until the real edit listing id has been opened and Year, Make, Model, Mileage, Price, and Body style have been read back.
- Do not accept all-digit Facebook Make or Model edit-form values such as `585892855224515`; those are Facebook taxonomy IDs leaking through and must be repaired before marker/status completion.
- Treat Facebook's default `Sedan` as unsafe for non-sedans.
- Keep cover selection visually reviewed; first-image fallback is for dry prep only.
