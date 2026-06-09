# FPV Spot Locator PH

A community-driven web app for FPV drone pilots in the Philippines to discover and share flying spots — no backend or account required.

---

## Overview

FPV Spot Locator PH is a static, client-side web application built with vanilla HTML, CSS, and JavaScript. Pilots can drop pins on an interactive map of the Philippines, attach photos and details to each spot, and browse spots shared by others. All data is stored locally in the browser (via `localStorage`) and optionally exported/imported as JSON files for sharing.

---

## Features

### Core
- **Interactive map** centered on the Philippines using [Leaflet.js](https://leafletjs.com/) with OpenStreetMap tiles (free, no API key needed)
- **Add a spot** by clicking anywhere on the map — opens a form to fill in details
- **Spot details panel** showing name, description, safety notes, and photos when a marker is clicked
- **Photo upload** — attach up to 5 images per spot (stored as Base64 in `localStorage`)
- **Spot cards list** — sidebar or bottom drawer listing all spots with quick-jump to map location

### Spot Fields
| Field | Type | Notes |
|---|---|---|
| Name | Text | Required |
| Description | Textarea | Terrain, obstacles, open space notes |
| Safety / Legality | Textarea | CAAP rules, no-fly zone warnings, etc. |
| Best time to fly | Select | Morning / Afternoon / Golden hour / Any |
| Tags | Multi-select | Freestyle / Racing / Long-range / Photography |
| Photos | File input | JPEG/PNG, max 5 files, stored as Base64 |
| Coordinates | Auto-filled | Lat/Lng from map click |
| Date added | Auto-filled | ISO date string |

### Data Persistence
- Spots are saved to `localStorage` — they persist across page refreshes in the same browser
- **Export spots** — download all spots as a `.json` file
- **Import spots** — load a `.json` file to merge or replace spots (useful for sharing with the community)

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Map | Leaflet.js (CDN) | Lightweight, free, no API key |
| Tiles | OpenStreetMap | Free, no key, good PH coverage |
| UI | Vanilla HTML + CSS | Zero build step, fast |
| Icons | Font Awesome (CDN) | Pin, camera, tag icons |
| Storage | `localStorage` | No server needed |
| Fonts | Google Fonts — Inter | Clean, readable |

No build tools, bundlers, or frameworks are required. The entire app is a single `index.html` plus a `style.css` and `app.js`.

---

## File Structure

```
fpv-spot-locator-ph/
├── index.html          # App shell, map container, modals
├── style.css           # Layout, map styles, modal, cards, responsive
├── app.js              # Leaflet init, spot CRUD, localStorage, import/export
├── assets/
│   └── marker-fpv.svg  # Custom FPV drone map marker icon
└── README.md
```

---

## Implementation Plan

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
  "bestTime": "morning",
  "tags": ["freestyle", "photography"],
  "photos": ["data:image/jpeg;base64,..."],
  "lat": 14.6507,
  "lng": 120.5400,
  "dateAdded": "2026-06-09T00:00:00.000Z"
}
```

---

## Local Development

No build step needed. Just open `index.html` in a browser:

```bash
# Option A — plain file open
open index.html

# Option B — local server (avoids some file:// quirks)
npx serve .
# or
python3 -m http.server 8080
```

---

## Future Ideas (Post-MVP)

- Supabase or Firebase backend to share spots across users in real time
- User profiles and spot ratings/reviews
- CAAP no-fly zone overlay (GeoJSON)
- Offline PWA support with Service Worker caching
- Heatmap layer showing spot density across regions
- Link sharing — encode spot ID in URL hash for direct linking
