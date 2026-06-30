'use strict';

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://fauqswafzifswsfgfffz.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhdXFzd2Fmemlmc3dzZmdmZmZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NTA0NDgsImV4cCI6MjA5NjUyNjQ0OH0.ThwEMHpbbd2uU9Yh96jZm82xpFLVWtmbcsObO2eHAAQ';
const PHOTO_BUCKET  = 'spot-photos';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const spotModal   = document.getElementById('spot-modal');
const detailPanel = document.getElementById('detail-panel');

// ── State ─────────────────────────────────────────────────────────────────────
let spots         = [];
let currentUserId = null;
let pendingLatLng = null;
let editingId     = null;
let pendingPhotos = [];
let activeSpotId  = null;
let photoIndex    = 0;
let filterTags    = new Set();
let searchQuery   = '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false }).setView([12.8797, 121.7740], 6);
L.control.zoom({ position: 'topleft' }).addTo(map);

const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxZoom: 19,
});

L.control.layers({ 'Map': streetLayer, 'Satellite': satelliteLayer }, null, { position: 'topleft' }).addTo(map);

// ── Category colors & marker icons ────────────────────────────────────────────
const TAG_COLORS = {
  freestyle:    '#9f7aea',
  racing:       '#ecc94b',
  'long-range': '#4299e1',
  photography:  '#48bb78',
};
const DEFAULT_PIN_COLOR = '#e53e3e';

const LEGEND_LABELS = {
  freestyle:    'Freestyle',
  racing:       'Racing',
  'long-range': 'Long-range',
  photography:  'Photography',
};

// ── Map legend ────────────────────────────────────────────────────────────────
const legendControl = L.control({ position: 'bottomleft' });
legendControl.onAdd = function() {
  const div  = L.DomUtil.create('div', 'map-legend');
  const rows = Object.keys(LEGEND_LABELS).map(key =>
    `<div class="map-legend-row"><span class="map-legend-dot" style="background:${TAG_COLORS[key]}"></span><span>${LEGEND_LABELS[key]}</span></div>`
  ).join('');
  div.innerHTML = `<div class="map-legend-title">Spot Type</div>${rows}` +
    `<div class="map-legend-row"><span class="map-legend-dot" style="background:${DEFAULT_PIN_COLOR}"></span><span>Other / Untagged</span></div>`;
  L.DomEvent.disableClickPropagation(div);
  return div;
};
legendControl.addTo(map);

// ── Marker icons ──────────────────────────────────────────────────────────────
const PIN_SVG_TEMPLATE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" width="36" height="46">' +
  '<path d="M20 2C12.268 2 6 8.268 6 16c0 10 14 32 14 32s14-22 14-32C34 8.268 27.732 2 20 2z" fill="{{COLOR}}" stroke="#fff" stroke-width="2"/>' +
  '<circle cx="20" cy="16" r="5" fill="#fff" opacity="0.9"/>' +
  '<line x1="14" y1="11" x2="9" y2="8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>' +
  '<line x1="26" y1="11" x2="31" y2="8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>' +
  '<line x1="14" y1="21" x2="9" y2="24" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>' +
  '<line x1="26" y1="21" x2="31" y2="24" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>' +
  '<ellipse cx="9" cy="7.5" rx="4" ry="1.5" fill="#fff" opacity="0.7"/>' +
  '<ellipse cx="31" cy="7.5" rx="4" ry="1.5" fill="#fff" opacity="0.7"/>' +
  '<ellipse cx="9" cy="24.5" rx="4" ry="1.5" fill="#fff" opacity="0.7"/>' +
  '<ellipse cx="31" cy="24.5" rx="4" ry="1.5" fill="#fff" opacity="0.7"/>' +
  '</svg>';

const iconCache = {};
function getIconForColor(color) {
  if (!iconCache[color]) {
    const svg = PIN_SVG_TEMPLATE.replace('{{COLOR}}', color);
    iconCache[color] = L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
      iconSize: [36, 46], iconAnchor: [18, 46],
      popupAnchor: [0, -46], tooltipAnchor: [18, -30],
    });
  }
  return iconCache[color];
}

function getIconForSpot(spot) {
  const tags = spot.tags || [];
  for (const key in TAG_COLORS) {
    if (tags.includes(key)) return getIconForColor(TAG_COLORS[key]);
  }
  return getIconForColor(DEFAULT_PIN_COLOR);
}

const markerMap = {};

function addMarkerForSpot(spot) {
  const marker = L.marker([spot.lat, spot.lng], { icon: getIconForSpot(spot) })
    .addTo(map)
    .bindTooltip(spot.name, { className: 'spot-tooltip', direction: 'top', offset: [0, -10] });
  marker.on('click', () => openDetailPanel(spot.id));
  markerMap[spot.id] = marker;
}

function removeMarker(id) {
  if (markerMap[id]) { markerMap[id].remove(); delete markerMap[id]; }
}

map.on('click', e => {
  pendingLatLng = e.latlng;
  editingId = null;
  openModal();
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function statusToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('status-toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function showConfirm(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.add('open');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const cleanup = val => {
      overlay.classList.remove('open');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(val);
    };
    const onYes = () => cleanup(true);
    const onNo  = () => cleanup(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
  });
}

// ── Connection status ─────────────────────────────────────────────────────────
let wasConnected = false;
function setStatus(connected) {
  const dot     = document.getElementById('status-dot');
  const text    = document.getElementById('status-text');
  const overlay = document.getElementById('connecting-overlay');
  if (!dot) return;
  dot.className    = 'status-dot ' + (connected ? 'online' : 'offline');
  text.textContent = connected ? 'Live' : 'Connecting…';
  overlay.classList.toggle('open', !connected);
  if (connected && !wasConnected) {
    statusToast('Connected — live updates enabled.', 'success');
  }
  wasConnected = connected;
}

// ── Spot count badge ──────────────────────────────────────────────────────────
function updateSpotsCount() {
  const el = document.getElementById('spots-count');
  if (!el) return;
  const total    = spots.length;
  const filtered = filteredSpots().length;
  if (searchQuery || filterTags.size > 0) {
    el.textContent = filtered + ' / ' + total + ' spot' + (total !== 1 ? 's' : '');
  } else {
    el.textContent = total === 1 ? '1 spot' : total + ' spots';
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(spot) {
  pendingPhotos = spot
    ? spot.photos.map((url, i) => ({ dataUrl: url, name: 'photo-' + i, uploaded: true }))
    : [];
  document.getElementById('modal-title').textContent = spot ? 'Edit Spot' : 'Add New Spot';
  const latlng = spot ? { lat: spot.lat, lng: spot.lng } : pendingLatLng;
  document.getElementById('modal-coords').textContent =
    latlng ? (latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6)) : 'Click a location on the map first';
  document.getElementById('gmaps-coords').value  = '';
  document.getElementById('spot-name').value     = spot ? spot.name : '';
  document.getElementById('spot-desc').value     = spot ? (spot.description || '') : '';
  document.getElementById('spot-safety').value   = spot ? (spot.safety || '') : '';
  document.getElementById('spot-time').value     = spot ? (spot.best_time || 'any') : 'any';
  document.querySelectorAll('.tag-checkbox').forEach(cb => {
    cb.checked = spot ? spot.tags.includes(cb.value) : false;
  });
  renderPhotoPreview();
  spotModal.classList.add('open');
  document.getElementById('spot-name').focus();
}

function closeModal() {
  spotModal.classList.remove('open');
  pendingPhotos = [];
  pendingLatLng = null;
  editingId     = null;
  document.getElementById('spot-photos').value = '';
}

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

// ── Google Maps coordinate paste ──────────────────────────────────────────────
function parseGoogleMapsCoords(input) {
  input = input.trim();
  const plain = input.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (plain) return { lat: parseFloat(plain[1]), lng: parseFloat(plain[2]) };
  const at = input.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const q = input.match(/[?&]q=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  const bang = input.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
  return null;
}

document.getElementById('gmaps-apply-btn').addEventListener('click', function() {
  const input = document.getElementById('gmaps-coords').value;
  if (!input.trim()) return;
  const coords = parseGoogleMapsCoords(input);
  if (!coords || isNaN(coords.lat) || isNaN(coords.lng) ||
      coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) {
    if (/goo\.gl|maps\.app/.test(input)) {
      toast('Shortened links aren\'t supported — open the link, then copy the full URL or coordinates from the address bar.', 'error');
    } else {
      toast('Could not read coordinates from that text.', 'error');
    }
    return;
  }
  pendingLatLng = coords;
  document.getElementById('modal-coords').textContent = coords.lat.toFixed(6) + ', ' + coords.lng.toFixed(6);
  map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 14));
  toast('Coordinates applied.', 'success');
});

spotModal.addEventListener('click', e => { if (e.target === spotModal) closeModal(); });
document.getElementById('modal-save-btn').addEventListener('click', saveSpot);

// ── Photo file input ──────────────────────────────────────────────────────────
document.getElementById('spot-photos').addEventListener('change', async function(e) {
  const files     = Array.from(e.target.files);
  const remaining = 5 - pendingPhotos.length;
  if (files.length > remaining) toast('Max 5 photos. ' + remaining + ' slot(s) left.', 'error');
  for (const f of files.slice(0, remaining)) {
    if (f.size > 20 * 1024 * 1024) { toast(f.name + ' exceeds 20 MB, skipped.', 'error'); continue; }
    const dataUrl = await readFileAsDataUrl(f);
    pendingPhotos.push({ dataUrl, name: f.name, uploaded: false });
  }
  renderPhotoPreview();
  e.target.value = '';
});

function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  const grid = document.getElementById('photo-preview-grid');
  document.getElementById('photo-count-label').textContent = '(' + pendingPhotos.length + ' / 5)';
  grid.innerHTML = '';
  pendingPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'photo-thumb'; img.src = p.dataUrl; img.alt = 'Photo ' + (i + 1);
    const btn = document.createElement('button');
    btn.className = 'photo-remove';
    btn.setAttribute('aria-label', 'Remove photo ' + (i + 1));
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btn.addEventListener('click', () => { pendingPhotos.splice(i, 1); renderPhotoPreview(); });
    wrap.appendChild(img); wrap.appendChild(btn);
    grid.appendChild(wrap);
  });
}

// ── Storage helpers ───────────────────────────────────────────────────────────
function storagePathFromUrl(url) {
  const marker = '/object/public/' + PHOTO_BUCKET + '/';
  const idx    = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

async function deletePhotosFromStorage(urls) {
  const paths = (urls || []).map(storagePathFromUrl).filter(Boolean);
  if (!paths.length) return;
  try {
    await db.storage.from(PHOTO_BUCKET).remove(paths);
  } catch { /* best-effort cleanup */ }
}

// ── Upload photos ─────────────────────────────────────────────────────────────
async function uploadPendingPhotos() {
  const urls = [];
  for (const p of pendingPhotos) {
    if (p.uploaded) { urls.push(p.dataUrl); continue; }
    try {
      const res  = await fetch(p.dataUrl);
      const blob = await res.blob();
      const ext  = blob.type.split('/')[1] || 'jpg';
      const path = currentUserId + '/' + uuid() + '.' + ext;
      const up   = await db.storage.from(PHOTO_BUCKET).upload(path, blob);
      if (up.error) throw up.error;
      const pub = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      urls.push(pub.data.publicUrl);
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    }
  }
  return urls;
}

// ── Save spot ─────────────────────────────────────────────────────────────────
async function saveSpot() {
  const name = document.getElementById('spot-name').value.trim();
  if (!name) { toast('Spot name is required.', 'error'); return; }

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const photoUrls = await uploadPendingPhotos();
    const existing  = editingId ? spots.find(s => s.id === editingId) : null;
    const tags      = Array.from(document.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value);

    const payload = {
      id:          editingId || uuid(),
      name,
      description: document.getElementById('spot-desc').value.trim(),
      safety:      document.getElementById('spot-safety').value.trim(),
      best_time:   document.getElementById('spot-time').value,
      tags,
      photos:      photoUrls,
      lat:         pendingLatLng ? pendingLatLng.lat : existing.lat,
      lng:         pendingLatLng ? pendingLatLng.lng : existing.lng,
      user_id:     currentUserId,
      date_added:  existing ? existing.date_added : new Date().toISOString(),
    };

    if (editingId) {
      const upd = await db.from('spots').update(payload).eq('id', editingId);
      if (upd.error) throw upd.error;
      const removedPhotos = (existing.photos || []).filter(url => !photoUrls.includes(url));
      await deletePhotosFromStorage(removedPhotos);
      const idx = spots.findIndex(s => s.id === editingId);
      if (idx !== -1) spots[idx] = payload;
      removeMarker(editingId);
      addMarkerForSpot(payload);
      if (activeSpotId === editingId) openDetailPanel(editingId);
    } else {
      const ins = await db.from('spots').insert(payload);
      if (ins.error) throw ins.error;
      if (!spots.find(s => s.id === payload.id)) {
        spots.push(payload);
        addMarkerForSpot(payload);
      }
      map.flyTo([payload.lat, payload.lng], Math.max(map.getZoom(), 14));
      openDetailPanel(payload.id);
    }

    renderSpotsList();
    closeModal();
    toast(editingId ? 'Spot updated!' : 'Spot added!');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Spot';
  }
}

// ── Spot list ─────────────────────────────────────────────────────────────────
function filteredSpots() {
  return spots.filter(s => {
    const matchSearch = !searchQuery
      || s.name.toLowerCase().includes(searchQuery)
      || (s.description || '').toLowerCase().includes(searchQuery);
    const matchTags = filterTags.size === 0 || (s.tags || []).some(t => filterTags.has(t));
    return matchSearch && matchTags;
  });
}

function renderSpotsList() {
  const list     = document.getElementById('spots-list');
  const empty    = document.getElementById('empty-state');
  const clearBtn = document.getElementById('clear-filters-btn');
  const fs       = filteredSpots();

  // Remove only spot cards, keep the loading and empty-state elements
  Array.from(list.querySelectorAll('.spot-card')).forEach(c => c.remove());

  if (clearBtn) clearBtn.style.display = (searchQuery || filterTags.size > 0) ? 'flex' : 'none';
  updateSpotsCount();

  if (fs.length === 0) {
    empty.style.display = 'flex';
    empty.querySelector('span').innerHTML = spots.length === 0
      ? 'No spots yet.<br>Click the map to add one!'
      : 'No spots match your filter.';
    return;
  }
  empty.style.display = 'none';

  fs.forEach(spot => {
    const card = document.createElement('div');
    card.className = 'spot-card' + (spot.id === activeSpotId ? ' active' : '');
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'View spot: ' + spot.name);

    if (spot.photos && spot.photos.length > 0) {
      const img = document.createElement('img');
      img.className = 'card-thumb'; img.src = spot.photos[0]; img.alt = spot.name;
      card.appendChild(img);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'card-name'; nameEl.textContent = spot.name;

    const dateEl = document.createElement('div');
    dateEl.className = 'card-date';
    dateEl.textContent = new Date(spot.date_added).toLocaleDateString('en-PH',
      { year: 'numeric', month: 'short', day: 'numeric' });

    card.appendChild(nameEl); card.appendChild(dateEl);

    if (spot.description) {
      const descEl = document.createElement('div');
      descEl.className = 'card-desc';
      descEl.textContent = spot.description.length > 72
        ? spot.description.slice(0, 72) + '…'
        : spot.description;
      card.appendChild(descEl);
    }

    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    (spot.tags || []).forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip tag-' + t; chip.textContent = t;
      tagsEl.appendChild(chip);
    });
    card.appendChild(tagsEl);

    const activate = () => {
      map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 14));
      openDetailPanel(spot.id);
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });

    list.appendChild(card);
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function openDetailPanel(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;
  activeSpotId = id;
  photoIndex   = 0;

  document.getElementById('detail-name').textContent = spot.name;
  document.getElementById('detail-coords').textContent = spot.lat.toFixed(6) + ', ' + spot.lng.toFixed(6);
  const timeMap = { any: 'Any time', morning: 'Morning', afternoon: 'Afternoon', 'golden-hour': 'Golden Hour' };
  document.getElementById('detail-time').textContent = timeMap[spot.best_time] || spot.best_time;
  document.getElementById('detail-date').textContent =
    new Date(spot.date_added).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = '';
  (spot.tags || []).forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip tag-' + t; chip.textContent = t;
    tagsEl.appendChild(chip);
  });
  document.getElementById('detail-tags-row').style.display   = spot.tags && spot.tags.length ? '' : 'none';
  document.getElementById('detail-desc').textContent         = spot.description || '—';
  document.getElementById('detail-desc-row').style.display   = spot.description ? '' : 'none';
  document.getElementById('detail-safety').textContent       = spot.safety || '—';
  document.getElementById('detail-safety-row').style.display = spot.safety ? '' : 'none';

  document.getElementById('detail-edit').style.display   = '';
  document.getElementById('detail-delete').style.display = '';

  renderDetailPhotos(spot.photos || []);
  detailPanel.classList.add('open');

  // Update URL hash so this spot can be shared
  history.replaceState(null, '', '#' + id);

  renderSpotsList();
}

function closeDetailPanel() {
  detailPanel.classList.remove('open');
  activeSpotId = null;
  // Clear hash from URL
  history.replaceState(null, '', window.location.pathname + window.location.search);
  renderSpotsList();
}

function renderDetailPhotos(photos) {
  const container = document.getElementById('detail-photos');
  const prev      = document.getElementById('photo-prev');
  const next      = document.getElementById('photo-next');
  const dots      = document.getElementById('photo-dots');

  container.querySelectorAll('img').forEach(i => i.remove());
  dots.innerHTML = '';

  if (!photos.length) {
    container.querySelector('.no-photo-placeholder').style.display = 'flex';
    prev.style.display = next.style.display = 'none';
    dots.style.display = 'none';
    return;
  }
  container.querySelector('.no-photo-placeholder').style.display = 'none';
  prev.style.display = next.style.display = photos.length > 1 ? 'flex' : 'none';
  dots.style.display = photos.length > 1 ? 'flex' : 'none';

  photos.forEach((url, i) => {
    const img = document.createElement('img');
    img.src = url; img.alt = 'Photo ' + (i + 1);
    img.style.cursor = 'zoom-in';
    if (i === photoIndex) img.classList.add('active');
    img.addEventListener('click', () => openLightbox(photos, i));
    container.insertBefore(img, prev);
    if (photos.length > 1) {
      const dot = document.createElement('button');
      dot.className = 'photo-dot' + (i === photoIndex ? ' active' : '');
      dot.setAttribute('aria-label', 'Photo ' + (i + 1));
      dot.addEventListener('click', () => setPhotoIndex(i));
      dots.appendChild(dot);
    }
  });
}

function setPhotoIndex(i) {
  const imgs   = document.querySelectorAll('#detail-photos img');
  const dotsEl = document.querySelectorAll('.photo-dot');
  photoIndex = (i + imgs.length) % imgs.length;
  imgs.forEach((img, idx)  => img.classList.toggle('active', idx === photoIndex));
  dotsEl.forEach((d, idx)  => d.classList.toggle('active', idx === photoIndex));
}

document.getElementById('photo-prev').addEventListener('click', () => setPhotoIndex(photoIndex - 1));
document.getElementById('photo-next').addEventListener('click', () => setPhotoIndex(photoIndex + 1));
document.getElementById('detail-close').addEventListener('click', closeDetailPanel);

// ── Copy coordinates ──────────────────────────────────────────────────────────
document.getElementById('copy-coords-btn').addEventListener('click', async function() {
  const coords = document.getElementById('detail-coords').textContent;
  await copyToClipboard(coords);
  toast('Coordinates copied!');
});

// ── Share spot ────────────────────────────────────────────────────────────────
document.getElementById('detail-share').addEventListener('click', async function() {
  await copyToClipboard(window.location.href);
  toast('Spot link copied!');
});

// ── Photo lightbox ────────────────────────────────────────────────────────────
const lightboxOverlay = document.getElementById('lightbox-overlay');
const lightboxImg     = document.getElementById('lightbox-img');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxPrev    = document.getElementById('lightbox-prev');
const lightboxNext    = document.getElementById('lightbox-next');
let lightboxPhotos    = [];
let lightboxIndex     = 0;

function openLightbox(photos, index) {
  lightboxPhotos = photos;
  lightboxIndex  = index;
  updateLightbox();
  lightboxOverlay.classList.add('open');
}

function closeLightbox() {
  lightboxOverlay.classList.remove('open');
}

function updateLightbox() {
  lightboxImg.src = lightboxPhotos[lightboxIndex];
  const multi = lightboxPhotos.length > 1;
  lightboxPrev.style.display = lightboxNext.style.display = multi ? 'flex' : 'none';
  lightboxCounter.style.display = multi ? 'block' : 'none';
  lightboxCounter.textContent = (lightboxIndex + 1) + ' / ' + lightboxPhotos.length;
}

function lightboxStep(delta) {
  lightboxIndex = (lightboxIndex + delta + lightboxPhotos.length) % lightboxPhotos.length;
  updateLightbox();
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', () => lightboxStep(-1));
document.getElementById('lightbox-next').addEventListener('click', () => lightboxStep(1));
lightboxOverlay.addEventListener('click', e => { if (e.target === lightboxOverlay) closeLightbox(); });
document.addEventListener('keydown', e => {
  if (!lightboxOverlay.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft')  lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});

// ── Edit / Delete ─────────────────────────────────────────────────────────────
document.getElementById('detail-edit').addEventListener('click', function() {
  const spot = spots.find(s => s.id === activeSpotId);
  if (!spot) return;
  editingId     = spot.id;
  pendingLatLng = { lat: spot.lat, lng: spot.lng };
  openModal(spot);
});

document.getElementById('detail-delete').addEventListener('click', function() {
  const spot = spots.find(s => s.id === activeSpotId);
  if (!spot) return;
  document.getElementById('request-delete-spot-name').textContent = spot.name;
  document.getElementById('request-delete-reason').value = '';
  document.getElementById('request-delete-overlay').classList.add('open');
});

document.getElementById('request-delete-cancel').addEventListener('click', function() {
  document.getElementById('request-delete-overlay').classList.remove('open');
});

document.getElementById('request-delete-submit').addEventListener('click', async function() {
  const spot = spots.find(s => s.id === activeSpotId);
  if (!spot) return;
  const reason = document.getElementById('request-delete-reason').value.trim();
  const ins = await db.from('deletion_requests').insert({
    spot_id:      spot.id,
    spot_name:    spot.name,
    reason,
    requested_by: currentUserId,
  });
  if (ins.error) { toast('Request failed: ' + ins.error.message, 'error'); return; }
  document.getElementById('request-delete-overlay').classList.remove('open');
  toast('Deletion request submitted. An admin will review it.');
});

// ── FAB ───────────────────────────────────────────────────────────────────────
const fabTooltip = document.getElementById('fab-tooltip');
document.getElementById('fab-add').addEventListener('click', function() {
  fabTooltip.classList.toggle('visible');
  setTimeout(() => fabTooltip.classList.remove('visible'), 3000);
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
document.getElementById('toggle-sidebar').addEventListener('click', function() {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('close-sidebar').addEventListener('click', function() {
  document.getElementById('sidebar').classList.remove('open');
});

// ── Search & filter ───────────────────────────────────────────────────────────
let searchDebounceTimer = null;
document.getElementById('search-input').addEventListener('input', function(e) {
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = value.trim().toLowerCase();
    renderSpotsList();
  }, 200);
});

document.querySelectorAll('.filter-tag').forEach(btn => {
  btn.addEventListener('click', function() {
    const tag = btn.dataset.tag;
    if (filterTags.has(tag)) { filterTags.delete(tag); btn.classList.remove('active'); }
    else                     { filterTags.add(tag);    btn.classList.add('active'); }
    renderSpotsList();
  });
});

// ── Clear filters ─────────────────────────────────────────────────────────────
document.getElementById('clear-filters-btn').addEventListener('click', function() {
  searchQuery = '';
  filterTags.clear();
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.filter-tag.active').forEach(btn => btn.classList.remove('active'));
  renderSpotsList();
});

// ── Export ────────────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', function() {
  if (!spots.length) { toast('No spots to export.', 'error'); return; }
  const blob = new Blob([JSON.stringify(spots, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'fpv-spots-ph-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(url);
  toast('Spots exported!');
});

// ── Realtime subscription ─────────────────────────────────────────────────────
function subscribeToSpots() {
  db.channel('spots-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spots' }, payload => {
      const spot = payload.new;
      if (spots.find(s => s.id === spot.id)) return;
      spots.push(spot);
      addMarkerForSpot(spot);
      renderSpotsList();
      toast('New spot: ' + spot.name);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'spots' }, payload => {
      const spot = payload.new;
      const idx  = spots.findIndex(s => s.id === spot.id);
      if (idx !== -1) spots[idx] = spot; else spots.push(spot);
      removeMarker(spot.id);
      addMarkerForSpot(spot);
      if (activeSpotId === spot.id) openDetailPanel(spot.id);
      renderSpotsList();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'spots' }, payload => {
      const id = payload.old.id;
      spots = spots.filter(s => s.id !== id);
      removeMarker(id);
      if (activeSpotId === id) closeDetailPanel();
      renderSpotsList();
    })
    .subscribe(status => setStatus(status === 'SUBSCRIBED'));
}

// ── localStorage migration (legacy one-time) ──────────────────────────────────
async function migrateLocalStorage() {
  const raw = localStorage.getItem('fpv_spots_ph');
  if (!raw) return;
  let local = [];
  try { local = JSON.parse(raw); } catch { localStorage.removeItem('fpv_spots_ph'); return; }
  if (!local.length) { localStorage.removeItem('fpv_spots_ph'); return; }

  toast('Migrating ' + local.length + ' local spot(s) to the cloud…');
  for (const s of local) {
    const photoUrls = [];
    for (const photo of (s.photos || [])) {
      if (!photo.startsWith('data:')) { photoUrls.push(photo); continue; }
      try {
        const res  = await fetch(photo);
        const blob = await res.blob();
        const path = currentUserId + '/' + uuid() + '.' + (blob.type.split('/')[1] || 'jpg');
        const up   = await db.storage.from(PHOTO_BUCKET).upload(path, blob);
        if (!up.error) {
          const pub = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
          photoUrls.push(pub.data.publicUrl);
        }
      } catch { /* skip failed photo */ }
    }
    await db.from('spots').upsert({
      id:          s.id,
      name:        s.name,
      description: s.description || '',
      safety:      s.safety || '',
      best_time:   s.bestTime || s.best_time || 'any',
      tags:        s.tags || [],
      photos:      photoUrls,
      lat:         s.lat,
      lng:         s.lng,
      user_id:     currentUserId,
      date_added:  s.dateAdded || s.date_added || new Date().toISOString(),
    }, { onConflict: 'id' });
  }
  localStorage.removeItem('fpv_spots_ph');
  toast('Migration complete! Your spots are now shared live.');
}

// ── URL hash routing ──────────────────────────────────────────────────────────
function initFromUrlHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const spot = spots.find(s => s.id === hash);
  if (spot) {
    map.setView([spot.lat, spot.lng], Math.max(map.getZoom(), 14));
    openDetailPanel(spot.id);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setStatus(false);

  const loadingEl = document.getElementById('spots-loading');
  if (loadingEl) loadingEl.style.display = 'flex';

  const sessionRes = await db.auth.getSession();
  if (sessionRes.data.session) {
    currentUserId = sessionRes.data.session.user.id;
  } else {
    const anonRes = await db.auth.signInAnonymously();
    if (anonRes.error) { toast('Auth error: ' + anonRes.error.message, 'error'); return; }
    currentUserId = anonRes.data.user.id;
  }

  await migrateLocalStorage();

  const fetchRes = await db.from('spots').select('*').order('date_added', { ascending: false });
  if (loadingEl) loadingEl.style.display = 'none';
  if (fetchRes.error) { toast('Failed to load spots: ' + fetchRes.error.message, 'error'); return; }
  spots = fetchRes.data || [];

  spots.forEach(addMarkerForSpot);
  renderSpotsList();
  subscribeToSpots();
  initFromUrlHash();
}

init();
