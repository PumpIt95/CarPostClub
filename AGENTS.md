# CarPostClub Inventory Lifecycle

## Standing Autonomy

Any time a package, dependency, language, library, repository, web search, tool, runtime, documentation, or other resource would make the work more capable or help complete the task, use it without asking first, as long as it fits the task and active system/developer constraints.

## Automation Terminology

- `CCA` means customer-contact automations: recurring jobs that inspect Facebook/Telegram buyer conversations, send replies, or produce appointment/follow-up digests. The deterministic message-memory expiry cleanup is not CCA: it only removes expired local records, does not open an inbox or contact anyone, and may remain active while CCA is paused.

## Automation Coordination

- `/Users/konnerhaas/.codex/automation-policy.json` is the coordination contract for automation tiers, intentional pauses, owner workflows, schedules, companion jobs, and shared resource lanes. Update it with any corresponding automation change.
- Customer-contact inbox/reply/digest automations remain paused until Konner explicitly reactivates them. A manual one-time request does not reactivate the recurring schedules.
- Keep each automation prompt limited to its unique purpose and within the shared prompt budget. Companion schedules should reference their base automation instead of copying the full prompt.
- The launchd automation watchdog owns routine Chrome pressure checks and safe relief every five minutes. Keep the redundant `chrome-pressure-recovery-guard` Codex automation paused unless that watchdog is removed.
- Before any recurring workflow controls Facebook in Chrome, acquire the shared `facebook-browser` lane with `automation_lane.sh`. If it is held, reuse sufficiently fresh read-only evidence or defer; do not open competing tabs. Finalize/release Chrome and registry ownership before releasing the lane.
- Long-running owners must refresh their singleton and resource-lane heartbeats at least every 30 minutes. A stale-looking lease is report-only until ownership is safely verified; watchdog/pressure cleanup must not force-release it.
- Use `automation_evidence.py` and the TTLs in the shared policy to reuse recent broad production, seller-listing, health, and Photos captures for read-only/no-op decisions. Fresh targeted verification is still mandatory immediately before any external or backend mutation.
- Use `$konner-production-access` `albums --normalized` as the current inventory/package bridge. Its `facebookReady` result must come from current source-active and draft/lifecycle `canPost` evidence; do not substitute a hard-coded gallery count or an old readiness field.
- Owner boundaries are strict: Facebook Ready Publisher publishes, Live Facebook Listing Sync marks stale listings sold, Listing Price And Disclosure Audit And Fix edits disclosures/prices, and Photo Package Readiness Monitor only reports readiness. Orchestration/monitor skills may classify or queue work but must not steal another owner's mutation.

## Inventory Model

- O'Regan's inventory is the upstream availability signal. If a vehicle disappears from the O'Regan's-backed CarPostClub inventory feed, treat that vehicle as no longer available, even if CarPostClub still has uploaded photos.
- O'Regan's showroom/source images are reference data only. They do not make a Facebook-ready package.
- Connor/Konner dealership photos uploaded to CarPostClub by a person are the package photos. Once matched to an active O'Regan's inventory row and uploaded, the package can become Facebook-ready.
- Effective 2026-07-09, Konner owns CPC/PWA photo upload. Automations must not upload, import, sync, or create CarPostClub album media from macOS Photos, iOS/iPhone Photos, local Photos exports, V3 Shortcut albums, Finder folders, or any other local image source. They may read/report those sources as photo evidence only. If a vehicle lacks production CPC media, report it as `awaiting Konner CPC upload` unless Konner explicitly re-authorizes CPC image upload for that exact run.
- A CarPostClub album with uploaded photos for a source-active vehicle is the website's active package for that inventory item.
- A CarPostClub album whose source vehicle is removed must stay visible but greyed/inactive in the UI.
- Source-removed/sold package changes should not send push notifications; keep them visible through greyed/inactive UI state and Facebook sync actions.

## Facebook Sync

- Live Facebook Marketplace listings belong to the Konner John seller account unless the user says otherwise.
- If a source-active, Facebook-ready package is not live on Facebook, the expected action is to post it using the CarPostClub package photos and generated listing fields.
- Konner's separate new-Kia Facebook listings may exist outside the CPC photo-upload flow. Keep those vehicles available for CPC/users when they appear, but Konner automations must treat a verified live Facebook match as `already posted` and must not repost only because CPC is missing the car, CPC has no package, or a random/new CPC album appears later.
- If a source-removed vehicle is live on Facebook, the expected action is to mark the Marketplace listing as sold. Do not delete it by default, even when CarPostClub/O'Regan's did not directly sell it.
- Delete Facebook listings only when explicitly requested, or for verified duplicates/incorrect listings/privacy issues.
- Match vehicles across O'Regan's, CarPostClub, and Facebook by VIN first, then stock number, then strong year/make/model/trim/price evidence. Do not mutate Facebook when the match is weak.
- Stock numbers like `TRANSFER-*` can mean the dealership bought or traded for another O'Regan's dealership's vehicle through the internal auction before assigning the final local stock number. Treat that as a temporary/internal stock-number state, not a posting blocker, when VIN/source-active inventory, dealership/source, package photos, and generated Facebook fields strongly identify the vehicle. Post with the current production stock/VIN evidence, record that the stock may need a later edit, and update the live listing/backend marker when the final stock number appears.
- For Facebook Marketplace form writing, use the Chrome plugin/Chrome extension plus Computer Use/native UI recovery when needed. DevTools MCP may be used for read-only snapshots, DOM inspection, and post-save verification, but do not use it to fill Facebook fields, click `Next`, click `Publish`, or click `Update` unless Konner explicitly re-authorizes DevTools form writing for that exact run.
- If a Facebook edit form shows an all-numeric raw `Model` value but the public listing/card title and edit preview already show the correct non-doubled `Year Make Model`, treat the numeric value as Facebook's internal model id and do not save an edit solely to replace it. Repair model only when the public title or preview is actually wrong.
- If a Facebook publish run gets `Transport closed` while a Marketplace composer is protected, preserve the draft and lock rather than opening a second composer. A later run should first reconnect to the same protected tab, verify seller, photo count, cover, and form state, then resume. This avoids losing a nearly finished post or creating a duplicate.
- When resuming a preserved Facebook composer, do a short read-only Chrome control burn-in before continuing. If the current Codex session still returns `Transport closed` after the recovery pack, treat that session's browser route as poisoned and resume from a fresh session instead of repeatedly retrying the same tool path.

## Code Expectations

- Preserve lifecycle labels such as `source_active`, `source_removed`, `facebook_ready`, `ready_to_post`, `stale_on_facebook`, and `mark_sold`; downstream Facebook automation depends on these semantics.
- Keep package exports and UI labels aligned with the same lifecycle state. Push notifications should remain focused on new inventory, uploads, and chat, not source-removed/sold transitions.
- Do not treat manual inventory or source-removed packages as safe to post without explicit review.

## Protected Facebook Publisher Handoffs

- Before a Facebook Ready Publisher run opens a new Marketplace composer, inspect an existing `facebook-publish.lock` owner record. A protected state is resumable only when it belongs to `facebook-ready-publisher` or `facebook-ready-publisher-saturday`, explicitly has `handoff: true`, has not clicked Publish or written backend live status, identifies one stock/album, and points to a Facebook Marketplace vehicle-create URL.
- For that exact handoff only, run `npm run preflight:facebook-publish -- --resume-own-publisher-handoff --run-dir <run-dir>/facebook-publish-transport-preflight`. Continue only on `ready_to_resume_protected_composer`; every other protected state remains a hard blocker for opening a new composer.
- A resumed publisher must reconnect to the exact existing composer, complete a read-only Chrome/Computer Use burn-in, verify Konner John, recheck current production/source status against the locked stock/album, reread the photos/cover/form/audience state, and rerun the final duplicate sweep immediately before Publish. Reuse the existing lock and never upload a second photo set or open a duplicate composer.
- When deliberately handing off a protected composer, the final Chrome action must release its browser-session control while keeping the existing tab as a handoff: `browser.tabs.finalize({ keep: [{ tab: composerTab, status: "handoff" }] })`. Do not leave it attached to a completed task; that would stop the next publisher session from claiming the same draft.
- If the handoff cannot be verified, preserve it and record a blocker. Do not discard or release it merely to make a preflight pass; release it only after a safe check proves that no recoverable draft remains or Konner explicitly approves discarding it.
