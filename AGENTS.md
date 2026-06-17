# CarPostClub Inventory Lifecycle

## Standing Autonomy

Any time a package, dependency, language, library, repository, web search, tool, runtime, documentation, or other resource would make the work more capable or help complete the task, use it without asking first, as long as it fits the task and active system/developer constraints.

## Automation Terminology

- `CCA` means customer contact automations: automations that check mailbox/Facebook digest messages, Telegram, message memory expiry cleanup, shallow scanner flows, and related customer-contact monitoring jobs.

## Inventory Model

- O'Regan's inventory is the upstream availability signal. If a vehicle disappears from the O'Regan's-backed CarPostClub inventory feed, treat that vehicle as no longer available, even if CarPostClub still has uploaded photos.
- O'Regan's showroom/source images are reference data only. They do not make a Facebook-ready package.
- Connor/Konner dealership photos uploaded to CarPostClub are the package photos. Once matched to an active O'Regan's inventory row and uploaded, the package can become Facebook-ready.
- A CarPostClub album with uploaded photos for a source-active vehicle is the website's active package for that inventory item.
- A CarPostClub album whose source vehicle is removed must stay visible but greyed/inactive in the UI.
- Source-removed/sold package changes should not send push notifications; keep them visible through greyed/inactive UI state and Facebook sync actions.

## Facebook Sync

- Live Facebook Marketplace listings belong to the Konner John seller account unless the user says otherwise.
- If a source-active, Facebook-ready package is not live on Facebook, the expected action is to post it using the CarPostClub package photos and generated listing fields.
- If a source-removed vehicle is live on Facebook, the expected action is to mark the Marketplace listing as sold. Do not delete it by default, even when CarPostClub/O'Regan's did not directly sell it.
- Delete Facebook listings only when explicitly requested, or for verified duplicates/incorrect listings/privacy issues.
- Match vehicles across O'Regan's, CarPostClub, and Facebook by VIN first, then stock number, then strong year/make/model/trim/price evidence. Do not mutate Facebook when the match is weak.

## Code Expectations

- Preserve lifecycle labels such as `source_active`, `source_removed`, `facebook_ready`, `ready_to_post`, `stale_on_facebook`, and `mark_sold`; downstream Facebook automation depends on these semantics.
- Keep package exports and UI labels aligned with the same lifecycle state. Push notifications should remain focused on new inventory, uploads, and chat, not source-removed/sold transitions.
- Do not treat manual inventory or source-removed packages as safe to post without explicit review.
