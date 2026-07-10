# FPV Spot Locator PH — Build Audit

_Date: 2026-06-10 (statuses last updated 2026-07-05)_
_Scope: `index.html`, `app.js`, `style.css`, `supabase-setup.sql`, `vendor/`, `assets/`_

---

## 🔴 Bugs

| # | Status | Issue | Location | Details |
|---|--------|-------|----------|---------|
| 1 | ✅ Fixed | **Editing a spot ignores updated coordinates** | `app.js` `saveSpot()` (~line 281-282) | When `editingId` is set, `lat`/`lng` are always taken from `existing.lat/lng`, even if the user pasted new Google Maps coordinates via the new "Use" button. Pasted coordinates are silently discarded on edit. |
| 2 | ✅ Fixed | **Orphaned photos in Supabase Storage** | `app.js` `detail-delete` handler (~line 523-535) | Deleting a spot removes the DB row but never deletes its uploaded photos from the `spot-photos` bucket. Storage usage grows indefinitely. Same applies when a photo is removed during edit (old photo stays in storage). |
| 3 | 🟡 Partial | **Shortened Google Maps links (`maps.app.goo.gl`, `goo.gl`) cannot be parsed** | `app.js` `parseGoogleMapsCoords()` | Still blocked by CORS on client-side redirect following. The app now opens the short link in a new tab and prompts the user to paste the resolved URL back — a manual workaround, not a true fix. |
| 4 | ⬜ Open | **`renderPhotoPreview` always shows "uploaded" photos as already-saved** | `app.js` `openModal()` (~line 120-122) | When editing, existing photo URLs are marked `uploaded: true` and reused as-is in `uploadPendingPhotos()`. If a user removes and re-adds the *same* photo file during an edit, it gets re-uploaded as a duplicate object (minor storage bloat, not a correctness bug, but worth noting alongside #2). |

---

## 🟠 Security & Data Integrity

| # | Status | Issue | Location | Details |
|---|--------|-------|----------|---------|
| 5 | ✅ Fixed | **No server-side validation of spot data** | `supabase-setup.sql` (`spots` table constraints) | Added `check` constraints on `name`/`description`/`safety` length, `best_time` enum, `tags` allow-list, `photos` array size, and `lat`/`lng` ranges. |
| 6 | ✅ Fixed | **Storage upload policy is unrestricted** | `supabase-setup.sql` `photos_own_upload` policy | Upload policy now requires the object path's first folder segment to equal `auth.uid()`, matching how the app actually builds paths. File-size/MIME type are enforced via the bucket's `file_size_limit`/`allowed_mime_types`. |
| 7 | ✅ Fixed | **No rate limiting / spam protection** | `supabase-setup.sql` `spots_rate_limit` trigger; `index.html`/`app.js` honeypot field | Added a `before insert` trigger capping each user to 20 new spots/hour, plus a hidden honeypot form field that silently no-ops the submit for simple bots. Neither replaces a CAPTCHA for a determined attacker. |
| 8 | ⬜ Won't fix | **Anon key + project URL hardcoded in client source** | `app.js` lines 4-5 | Expected/normal for Supabase anon keys (public by design, protected by RLS). Now backed by meaningfully stronger RLS/constraints (#5-#7). |
| 9 | 🟡 Partial | **No content moderation** | App-wide | The admin dashboard (`admin.html`) and community deletion-request queue now give reactive moderation (report → admin review/delete). There's still no proactive filtering (profanity/spam detection) before content goes live. |

---

## 🟡 Performance

| # | Status | Issue | Location | Details |
|---|--------|-------|----------|---------|
| 10 | ⬜ Open | **All spots loaded at once, no pagination** | `app.js` `init()` | `db.from('spots').select('*')` fetches the entire table on every page load. Fine at current scale, but will degrade as the spot count grows (especially with embedded photo URL arrays). |
| 11 | ✅ Fixed | **No debounce on search input** | `app.js` search-input handler | Input is now debounced (200ms) before re-filtering/re-rendering the sidebar list. |
| 12 | ✅ Fixed | **Full marker re-render on update** | `app.js` `updateMarkerForSpot()` | UPDATE events now move/refresh an existing marker in place instead of remove+recreate. |
| 13 | 🟡 Partial | **External CDN dependencies** | `index.html`, `admin.html` | Inter is now self-hosted (`vendor/fonts/`) and cached by the service worker, so the Google Fonts round-trip is gone. Font Awesome is still loaded from cdnjs with no self-hosted fallback — icons disappear if that CDN is unreachable. `admin.html` also still loads Leaflet from unpkg instead of the vendored copy `index.html` uses. |

---

## 🟢 Accessibility & UX

| # | Status | Issue | Location | Details |
|---|--------|-------|----------|---------|
| 14 | ✅ Fixed | **Icon-only buttons lack `aria-label`** | `index.html` | Close buttons, FAB, photo nav, and lightbox controls now carry `aria-label` in addition to `title`. |
| 15 | 🟡 Partial | **No keyboard navigation for the map/spot list** | App-wide | Spot list cards now handle `keydown` (Enter/Space) for keyboard activation. Map markers themselves are still mouse/touch-only — Leaflet doesn't expose keyboard focus on markers out of the box. |
| 16 | ✅ Fixed | **No "drag to reposition" when editing a spot** | `app.js` `enableEditDrag()`/`disableEditDrag()`, `openModal()` | Opening the edit modal now makes that spot's existing marker draggable; `dragend` updates the pending coordinates and the modal's coords display live. Cancelling the edit snaps the marker back to its last-saved position. |
| 17 | ✅ Fixed | **No loading/empty states for slow connections; UI could get stuck on "Connecting…" forever** | `app.js` `init()`, `setStatus()` | The "Connecting to live database…" overlay now doubles as the initial loading state (it was already up during the fetch, but previously never closed — and hid the error toast — if the fetch failed and no offline cache existed). It's now explicitly dismissed on every init outcome, replaced by a persistent **Retry** toast on failure, and (via a new `initialLoadDone` flag) no longer re-blocks the whole screen on later realtime reconnect blips once spots have already loaded. |
| 18 | ✅ Fixed | **No offline support / PWA manifest** | `sw.js`, `manifest.json`, `app.js` | Service worker caches the app shell, `manifest.json` makes the app installable, and the last-fetched spot list is cached to `localStorage` for offline browsing. |

---

## ⚪ Code Quality / Maintainability

| # | Status | Issue | Location | Details |
|---|--------|-------|----------|---------|
| 19 | ⬜ Open | **Mixed `var`/`let`/`const` and function styles** | `app.js` | Inconsistent use of `var` (older code) vs `let`/`const` (newer additions) and arrow functions vs `function() {}`. Not a bug, but inconsistent style across the file. |
| 20 | ⬜ Open | **No build step / bundling** | Project root | All vendor libraries (Leaflet, Supabase JS) are committed directly to `vendor/`. Fine for a no-build static app, but means manual updates are needed to bump library versions and there's no minification for `app.js`/`style.css`. |
| 21 | ⬜ Open | **Single ~900-line `app.js`** | `app.js` | All logic (map, modal, photos, lightbox, realtime, auth) lives in one file. Still manageable, but will become harder to maintain as features grow — consider splitting into modules if a build step is ever introduced. |
| 22 | ⬜ Open (by design) | **`migrateLocalStorage()` is a one-time-use function that will never be removed** | `app.js` `migrateLocalStorage()` | Still runs a cheap early-return check on every `init()`. Kept intentionally so any visitor still holding pre-Supabase `localStorage` data gets migrated; cost is negligible (single `localStorage.getItem` + null check). |

---

## ✅ What's Working Well

- Realtime sync via Supabase `postgres_changes` is wired correctly for INSERT/UPDATE/DELETE.
- RLS ownership model (`auth.uid() = user_id`) correctly gates edit/delete UI and DB writes.
- Mobile-responsive layout (bottom sheets, drawer sidebar, safe-area insets) is solid.
- Photo lightbox, map layer switcher (satellite/street), and Google Maps coordinate paste are nice usability additions.
- Toast/confirm-dialog patterns are consistent and reusable.
- Anonymous auth means zero signup friction for the target audience.

---

## Suggested Priority for Fixes

1. **#1** (edit-coordinates bug) — quick fix, directly affects core "fix my pin" workflow.
2. **#5 / #6** (RLS & storage policy hardening) — important before wider Facebook group rollout to prevent abuse.
3. **#3** (shortened Google Maps links) — high real-world impact since most users share `maps.app.goo.gl` links from mobile.
4. **#2** (orphaned photo cleanup) — can be deferred, but will cost storage quota over time.
5. Accessibility (#14) and performance items (#10-13) — lower urgency at current scale, revisit as user base grows.
