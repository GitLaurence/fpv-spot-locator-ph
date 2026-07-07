# FPV Spot Locator PH

A community-driven web app for FPV drone pilots in the Philippines to discover and share flying spots — no signup required.

---

## Overview

FPV Spot Locator PH is a static, client-side web application built with vanilla HTML, CSS, and JavaScript. Pilots can drop pins on an interactive map of the Philippines, attach photos and details to each spot, and browse spots shared live by the whole community. Spots are stored in a shared [Supabase](https://supabase.com) backend (Postgres + Storage) and sync across everyone's browser in real time via anonymous auth — there's nothing to sign up for, but every visitor sees the same live map. Spots can also be exported/imported as JSON files for offline backups.

Anyone can add, edit, or request deletion of a spot (community-maintained map). Deletion requests go through a moderation queue reviewed from a separate admin dashboard (`admin.html`), which requires an admin login.

---

## Features

### Core
- **Interactive map** centered on the Philippines using [Leaflet.js](https://leafletjs.com/) with OpenStreetMap tiles (free, no API key needed)
- **Add a spot** by clicking anywhere on the map — opens a form to fill in details
- **Spot details panel** showing name, description, safety notes, and photos when a marker is clicked
- **Photo upload** — attach up to 5 images per spot, uploaded to Supabase Storage
- **Spot cards list** — sidebar or bottom drawer listing all spots with quick-jump to map location
- **Live sync** — spots added/edited/deleted by anyone appear for all other visitors in real time (Supabase Realtime)
- **Community moderation** — anyone can request a spot be deleted (with an optional reason); admins review requests from the admin dashboard
- **Offline-capable app shell** — a service worker (`sw.js`) caches the map UI, styles, and vendored libraries so the app still loads when connectivity drops mid-flight; a web app manifest (`manifest.json`) makes it installable to a home screen
- **Offline spot browsing** — the last-fetched spot list is cached to `localStorage`, so if the initial load happens with no connection, the map still shows every spot from your last visit (read-only until you're back online)
- **Shareable spot links** — the share icon in a spot's detail panel copies a direct link (`#spot=<id>`) that opens straight to that spot on the map
- **Locate me / sort by distance** — the crosshair button next to search uses your browser's geolocation to drop a "you are here" marker, sort the sidebar list nearest-first, and label each card with its distance
- **Drag-to-reposition pin** — the Add/Edit modal shows a draggable marker at the spot's location so you can fine-tune the exact pin position instead of only pasting coordinates

### Spot Fields
| Field | Type | Notes |
|---|---|---|
| Name | Text | Required |
| Description | Textarea | Terrain, obstacles, open space notes |
| Safety / Legality | Textarea | CAAP rules, no-fly zone warnings, etc. |
| Best time to fly | Select | Morning / Afternoon / Golden hour / Any |
| Tags | Multi-select | Freestyle / Racing / Long-range / Photography |
| Photos | File input | JPEG/PNG/WebP, max 5 files, uploaded to Supabase Storage |
| Coordinates | Auto-filled | Lat/Lng from map click |
| Date added | Auto-filled | ISO date string |

### Data Persistence
- Spots live in a shared Supabase Postgres table and sync to every visitor in real time (Supabase Realtime), so refreshing the page — or opening it on another device — shows the same live data
- Every visitor is signed in anonymously (Supabase Auth) on first load, purely to satisfy row-level-security checks — no email, password, or profile is ever created
- **Export spots** — download all spots as a `.json` file (local backup)
- **Import spots** — the original localStorage → Supabase migration path (`migrateLocalStorage()` in `app.js`) automatically moves any spots saved by earlier (pre-Supabase) versions of the app into the shared database on next load

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Map | Leaflet.js (vendored) | Lightweight, free, no API key |
| Tiles | OpenStreetMap / Esri satellite | Free, no key, good PH coverage |
| UI | Vanilla HTML + CSS | Zero build step, fast |
| Icons | Font Awesome (CDN) | Pin, camera, tag icons |
| Backend | Supabase (Postgres + Storage + Realtime + Auth) | Shared live data, no custom server to run |
| Fonts | Google Fonts — Inter | Clean, readable |

No build tools, bundlers, or frameworks are required. `vendor/` contains the pinned Leaflet and Supabase JS client so the app works without any CDN for those two libraries.

---

## File Structure

```
fpv-spot-locator-ph/
├── index.html          # Main app shell, map container, modals
├── app.js              # Leaflet init, spot CRUD, Supabase sync, import/export
├── manifest.json       # Web app manifest (installable, theme color, icon)
├── sw.js               # Service worker — caches app shell for offline use
├── admin.html           # Admin dashboard shell (login + moderation UI)
├── admin.js             # Admin auth, deletion-request queue, spot management
├── admin.css             # Admin dashboard styles
├── style.css            # Layout, map styles, modal, cards, responsive
├── supabase-setup.sql   # One-time SQL to provision tables, RLS policies, storage bucket
├── vendor/               # Pinned Leaflet + Supabase JS client
├── assets/
│   └── marker-fpv.svg  # Custom FPV drone map marker icon
└── README.md
```

---

## Implementation Plan

_The phases below describe the original MVP build-out. The app has since moved from `localStorage`-only storage to a shared Supabase backend (see "Tech Stack" and "Data Persistence" above); the phases are kept here as a historical record of the initial approach._

### Phase 1 — Map & Markers
1. Set up `index.html` with Leaflet CDN and a full-screen map div
2. Initialize Leaflet centered on the Philippines (`[12.8797, 121.7740]`, zoom 6)
3. On map click → store clicked `latlng`, open the **Add Spot modal**
4. On modal submit → create a marker, save spot to `localStorage`, show marker on map
5. On marker click → open the **Spot Detail panel**

### Phase 2 — Add Spot Form (Modal)
1. Form fields: name, description, safety notes, best time, tags checkboxes
2. Photo file input with preview thumbnails (FileReader API → Base64)
3. Validation: name required, max 5 photos, max ~4 MB total
4. On submit: build spot object, push to `spots[]` array, `localStorage.setItem`
5. Cancel button clears form and closes modal

### Phase 3 — Spot Detail Panel
1. Slide-in right panel (desktop) / bottom sheet (mobile)
2. Displays all spot fields, photo carousel/grid
3. **Delete spot** button with confirmation
4. **Edit spot** button (opens pre-filled Add Spot modal)
5. Close button

### Phase 4 — Spots Sidebar / List View
1. Collapsible left sidebar listing all spots as cards
2. Each card shows: name, tags, date added, thumbnail
3. Click card → fly map to marker and open detail panel
4. Search/filter bar — filter by tag or text search on name + description

### Phase 5 — Import / Export
1. **Export** button → `JSON.stringify(spots)` → `Blob` → `<a download>` trigger
2. **Import** button → `<input type="file" accept=".json">` → `FileReader` → merge into `localStorage`
3. Merge strategy: deduplicate by `id` (UUID generated at creation time)

### Phase 6 — Polish & Responsive
1. Mobile layout: hide sidebar, show bottom navigation bar
2. Bottom sheet for spot detail on small screens
3. Loading spinner while photos render
4. Empty state illustration when no spots have been added yet
5. Tooltip on map markers showing spot name on hover
6. Custom FPV drone SVG marker icon

---

## Spot Data Schema

```json
{
  "id": "uuid-v4",
  "name": "Bataan Nuclear Power Plant Field",
  "description": "Wide open field, minimal obstacles, great for freestyle.",
  "safety": "Check CAAP NOTAM before flying. Stay below 400ft AGL.",
  "best_time": "morning",
  "tags": ["freestyle", "photography"],
  "photos": ["https://<project>.supabase.co/storage/v1/object/public/spot-photos/..."],
  "lat": 14.6507,
  "lng": 120.5400,
  "date_added": "2026-06-09T00:00:00.000Z",
  "user_id": "uuid-v4"
}
```

This mirrors the `public.spots` table defined in `supabase-setup.sql` (see that file for the full schema, constraints, and RLS policies).

---

## Local Development

No build step needed. Just open `index.html` in a browser (an internet connection is required — spot data loads live from Supabase):

```bash
# Option A — plain file open
open index.html

# Option B — local server (avoids some file:// quirks)
npx serve .
# or
python3 -m http.server 8080
```

To set up your own Supabase project instead of using the shared one, run `supabase-setup.sql` once in the Supabase SQL editor, then swap `SUPABASE_URL`/`SUPABASE_KEY` at the top of `app.js` and `admin.js`. To create an admin account for `admin.html`, add a user via the Supabase dashboard and insert their UUID into the `public.admins` table (see the comment above that table in `supabase-setup.sql`).

---

## Future Ideas (Post-MVP)

- User profiles and spot ratings/reviews
- CAAP no-fly zone overlay (GeoJSON)
- Generate proper PNG/maskable app icons for `manifest.json`
- Heatmap layer showing spot density across regions
- Resolve shortened Google Maps links (`maps.app.goo.gl`) without a manual copy/paste round-trip — currently blocked by CORS on client-side redirect following
