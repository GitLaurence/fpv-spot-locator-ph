# FPV Spot Locator PH — Build Audit

_Date: 2026-06-10_
_Scope: `index.html`, `app.js`, `style.css`, `supabase-setup.sql`, `vendor/`, `assets/`_

---

## 🔴 Bugs

| # | Issue | Location | Details |
|---|-------|----------|---------|
| 1 | **Editing a spot ignores updated coordinates** | `app.js` `saveSpot()` (~line 281-282) | When `editingId` is set, `lat`/`lng` are always taken from `existing.lat/lng`, even if the user pasted new Google Maps coordinates via the new "Use" button. Pasted coordinates are silently discarded on edit. |
| 2 | **Orphaned photos in Supabase Storage** | `app.js` `detail-delete` handler (~line 523-535) | Deleting a spot removes the DB row but never deletes its uploaded photos from the `spot-photos` bucket. Storage usage grows indefinitely. Same applies when a photo is removed during edit (old photo stays in storage). |
| 3 | **Shortened Google Maps links (`maps.app.goo.gl`, `goo.gl`) cannot be parsed** | `app.js` `parseGoogleMapsCoords()` | These are the links most mobile users actually share/copy. The app shows a warning but provides no fallback (e.g. no way to resolve them client-side due to CORS). Most users pasting a Google Maps share link from their phone will hit this. |
| 4 | **`renderPhotoPreview` always shows "uploaded" photos as already-saved** | `app.js` `openModal()` (~line 120-122) | When editing, existing photo URLs are marked `uploaded: true` and reused as-is in `uploadPendingPhotos()`. If a user removes and re-adds the *same* photo file during an edit, it gets re-uploaded as a duplicate object (minor storage bloat, not a correctness bug, but worth noting alongside #2). |

---

## 🟠 Security & Data Integrity

| # | Issue | Location | Details |
|---|-------|----------|---------|
| 5 | **No server-side validation of spot data** | `supabase-setup.sql` (RLS policies) | `owner_insert`/`owner_update` only check `auth.uid() = user_id`. There's no constraint on `lat`/`lng` ranges, `name` length, `tags` values, or `photos` array size. A malicious anon user could insert spam rows, huge text blobs, or bogus coordinates anywhere on Earth. |
| 6 | **Storage upload policy is unrestricted** | `supabase-setup.sql` line 40-41 | `photos_auth_upload` allows **any** anon/authenticated user to upload to **any path** in the `spot-photos` bucket — not just their own `user_id/` folder. No file-size or MIME-type enforcement at the DB/storage level (only client-side 4MB check, which is trivially bypassed). |
| 7 | **No rate limiting / spam protection** | App-wide | Since anonymous auth is open and inserts are unrestricted (#5), the app is vulnerable to spam-bots flooding the map with fake spots. No CAPTCHA, no per-IP/user throttling. |
| 8 | **Anon key + project URL hardcoded in client source** | `app.js` lines 4-5 | This is expected/normal for Supabase anon keys (they're meant to be public and protected by RLS), but combined with #5/#6 (weak RLS), it means the public key effectively grants broad write access. Worth tightening RLS before wide release. |
| 9 | **No content moderation** | App-wide | Spot names, descriptions, safety notes, and photos are all user-submitted and immediately visible to everyone in real time, with no reporting/flagging mechanism and no admin moderation tooling. |

---

## 🟡 Performance

| # | Issue | Location | Details |
|---|-------|----------|---------|
| 10 | **All spots loaded at once, no pagination** | `app.js` `init()` (~line 665) | `db.from('spots').select('*')` fetches the entire table on every page load. Fine at small scale, but will degrade as the spot count grows (especially with embedded photo URL arrays). |
| 11 | **No debounce on search input** | `app.js` (~line 554) | `renderSpotsList()` runs on every keystroke, fully re-rendering the sidebar list and rebuilding DOM nodes. Not currently a problem at small scale, but will cause jank with hundreds of spots. |
| 12 | **Full marker re-render on update** | `app.js` `saveSpot()` / `subscribeToSpots()` | On every UPDATE event, the marker is removed and recreated (`removeMarker` + `addMarkerForSpot`) instead of just updating its position/tooltip in place. |
| 13 | **External CDN dependencies** | `index.html` lines 8-10 | Font Awesome and Google Fonts are loaded from CDNs. If those CDNs are slow/unreachable, the search icon, all UI icons, and custom fonts silently fail (no fallback fonts/icons defined), degrading the UI noticeably. |

---

## 🟢 Accessibility & UX

| # | Issue | Location | Details |
|---|-------|----------|---------|
| 14 | **Icon-only buttons lack `aria-label`** | `index.html` — close buttons, FAB, photo nav, lightbox controls | Buttons like `#close-sidebar`, `#detail-close`, `#photo-prev/next`, `#lightbox-*` rely on `title` attributes only. Screen readers handle `title` inconsistently; `aria-label` should be added for reliable accessibility. |
| 15 | **No keyboard navigation for the map/spot list** | App-wide | Spot cards and map markers are only clickable, no keyboard focus/Enter handling for users navigating via keyboard. |
| 16 | **No "drag to reposition" when editing a spot** | Add/Edit modal | Combined with bug #1, there's currently no reliable way to fix a spot's location after creation other than delete-and-recreate. |
| 17 | **No loading/empty states for slow connections** | `app.js` `init()` | If `db.from('spots').select()` is slow, the UI just shows the empty state with no spinner, which could read as "no spots" rather than "loading". |
| 18 | **No offline support / PWA manifest** | App-wide | No service worker, no manifest.json — app is unusable with no connectivity (which may be common in remote PH flying spots). Given the "FPV spot finder" use case, offline caching of previously-viewed spots could be valuable. |

---

## ⚪ Code Quality / Maintainability

| # | Issue | Location | Details |
|---|-------|----------|---------|
| 19 | **Mixed `var`/`let`/`const` and function styles** | `app.js` | Inconsistent use of `var` (older code) vs `let`/`const` (newer additions) and arrow functions vs `function() {}`. Not a bug, but inconsistent style across the file. |
| 20 | **No build step / bundling** | Project root | All vendor libraries (Leaflet, Supabase JS) are committed directly to `vendor/`. Fine for a no-build static app, but means manual updates are needed to bump library versions and there's no minification for `app.js`/`style.css`. |
| 21 | **Single 674-line `app.js`** | `app.js` | All logic (map, modal, photos, lightbox, realtime, auth) lives in one file. Still manageable, but will become harder to maintain as features grow — consider splitting into modules if a build step is ever introduced. |
| 22 | **`migrateLocalStorage()` is a one-time-use function that will never be removed** | `app.js` lines 609-648 | Useful for the original localStorage→Supabase migration, but now runs (as a no-op check) on every `init()` for every user permanently. Low cost, but dead weight long-term. |

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
