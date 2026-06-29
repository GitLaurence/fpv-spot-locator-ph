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
let sortMode      = 'newest';
let userLocation  = null;
let userMarker    = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return Math.round(km * 1000) + ' m';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km) + ' km';
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

L.control.layers({
  'Map': streetLayer,
  'Satellite': satelliteLayer,
}, null, { position: 'topleft' }).addTo(map);

// ── Category colors & marker icons ─────────────────────────────────────────────
const TAG_COLORS = {
  'freestyle':   '#9f7aea',
  'racing':      '#ecc94b',
  'long-range':  '#4299e1',
  'photography': '#48bb78',
};
const DEFAULT_PIN_COLOR = '#e53e3e';

// ── Category legend ──────────────────────────────────────────────────────────
const LEGEND_LABELS = {
  'freestyle':   'Freestyle',
  'racing':      'Racing',
  'long-range':  'Long-range',
  'photography': 'Photography',
};

const legendControl = L.control({ position: 'bottomleft' });
legendControl.onAdd = function() {
  var div = L.DomUtil.create('div', 'map-legend');
  var rows = Object.keys(LEGEND_LABELS).map(function(key) {
    return '<div class="map-legend-row">' +
      '<span class="map-legend-dot" style="background:' + TAG_COLORS[key] + '"></span>' +
      '<span>' + LEGEND_LABELS[key] + '</span></div>';
  }).join('');
  rows += '<div class="map-legend-row">' +
    '<span class="map-legend-dot" style="background:' + DEFAULT_PIN_COLOR + '"></span>' +
    '<span>Other / Untagged</span></div>';
  div.innerHTML = '<div class="map-legend-title">Spot Type</div>' + rows;
  L.DomEvent.disableClickPropagation(div);
  return div;
};
legendControl.addTo(map);

const PIN_SVG_TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" width="36" height="46">' +
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
    var svg = PIN_SVG_TEMPLATE.replace('{{COLOR}}', color);
    iconCache[color] = L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
      iconSize: [36, 46], iconAnchor: [18, 46],
      popupAnchor: [0, -46], tooltipAnchor: [18, -30],
    });
  }
  return iconCache[color];
}

function getIconForSpot(spot) {
  var tags = spot.tags || [];
  for (var key in TAG_COLORS) {
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
  const dot      = document.getElementById('status-dot');
  const text     = document.getElementById('status-text');
  const overlay  = document.getElementById('connecting-overlay');
  if (!dot) return;
  dot.className    = 'status-dot ' + (connected ? 'online' : 'offline');
  text.textContent = connected ? 'Live' : 'Connecting…';
  overlay.classList.toggle('open', !connected);
  if (connected && !wasConnected) {
    statusToast('Connected — live updates enabled.', 'success');
  }
  wasConnected = connected;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(spot) {
  pendingPhotos = spot
    ? spot.photos.map((url, i) => ({ dataUrl: url, name: 'photo-' + i, uploaded: true }))
    : [];
  document.getElementById('modal-title').textContent = spot ? 'Edit Spot' : 'Add New Spot';
  var latlng = spot ? { lat: spot.lat, lng: spot.lng } : pendingLatLng;
  document.getElementById('modal-coords').textContent =
    latlng ? (latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6)) : 'Click a location on the map first';
  document.getElementById('gmaps-coords').value = '';
  document.getElementById('spot-name').value   = spot ? spot.name : '';
  document.getElementById('spot-desc').value   = spot ? (spot.description || '') : '';
  document.getElementById('spot-safety').value = spot ? (spot.safety || '') : '';
  document.getElementById('spot-time').value   = spot ? (spot.best_time || 'any') : 'any';
  document.querySelectorAll('.tag-checkbox').forEach(function(cb) {
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

// ── Google Maps coordinate paste ────────────────────────────────────────────
function parseGoogleMapsCoords(input) {
  input = input.trim();

  // Plain "lat, lng" pair
  var plain = input.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (plain) return { lat: parseFloat(plain[1]), lng: parseFloat(plain[2]) };

  // URL containing @lat,lng (standard Google Maps share links)
  var at = input.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };

  // URL with ?q=lat,lng or &q=lat,lng
  var q = input.match(/[?&]q=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };

  // URL with !3dlat!4dlng (precise marker location)
  var bang = input.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };

  return null;
}

document.getElementById('gmaps-apply-btn').addEventListener('click', function() {
  var input = document.getElementById('gmaps-coords').value;
  if (!input.trim()) return;

  var coords = parseGoogleMapsCoords(input);
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
spotModal.addEventListener('click', function(e) { if (e.target === spotModal) closeModal(); });
document.getElementById('modal-save-btn').addEventListener('click', saveSpot);

// ── Photo file input ──────────────────────────────────────────────────────────
document.getElementById('spot-photos').addEventListener('change', async function(e) {
  var files = Array.from(e.target.files);
  var remaining = 5 - pendingPhotos.length;
  if (files.length > remaining) toast('Max 5 photos. ' + remaining + ' slot(s) left.', 'error');
  for (var f of files.slice(0, remaining)) {
    if (f.size > 20 * 1024 * 1024) { toast(f.name + ' exceeds 20 MB, skipped.', 'error'); continue; }
    var dataUrl = await readFileAsDataUrl(f);
    pendingPhotos.push({ dataUrl: dataUrl, name: f.name, uploaded: false });
  }
  renderPhotoPreview();
  e.target.value = '';
});

function readFileAsDataUrl(file) {
  return new Promise(function(res, rej) {
    var r = new FileReader();
    r.onload  = function() { res(r.result); };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  var grid = document.getElementById('photo-preview-grid');
  document.getElementById('photo-count-label').textContent = '(' + pendingPhotos.length + ' / 5)';
  grid.innerHTML = '';
  pendingPhotos.forEach(function(p, i) {
    var wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    var img = document.createElement('img');
    img.className = 'photo-thumb'; img.src = p.dataUrl;
    var btn = document.createElement('button');
    btn.className = 'photo-remove';
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btn.addEventListener('click', function() { pendingPhotos.splice(i, 1); renderPhotoPreview(); });
    wrap.appendChild(img); wrap.appendChild(btn);
    grid.appendChild(wrap);
  });
}

// ── Storage helpers ────────────────────────────────────────────────────────────
function storagePathFromUrl(url) {
  var marker = '/object/public/' + PHOTO_BUCKET + '/';
  var idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

async function deletePhotosFromStorage(urls) {
  var paths = (urls || []).map(storagePathFromUrl).filter(Boolean);
  if (!paths.length) return;
  try {
    await db.storage.from(PHOTO_BUCKET).remove(paths);
  } catch (err) { /* best-effort cleanup */ }
}

// ── Upload photos to Supabase Storage ─────────────────────────────────────────
async function uploadPendingPhotos() {
  var urls = [];
  for (var p of pendingPhotos) {
    if (p.uploaded) { urls.push(p.dataUrl); continue; }
    try {
      var res  = await fetch(p.dataUrl);
      var blob = await res.blob();
      var ext  = blob.type.split('/')[1] || 'jpg';
      var path = currentUserId + '/' + uuid() + '.' + ext;
      var up   = await db.storage.from(PHOTO_BUCKET).upload(path, blob);
      if (up.error) throw up.error;
      var pub = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      urls.push(pub.data.publicUrl);
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    }
  }
  return urls;
}

// ── Save spot ─────────────────────────────────────────────────────────────────
async function saveSpot() {
  var name = document.getElementById('spot-name').value.trim();
  if (!name) { toast('Spot name is required.', 'error'); return; }

  var saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    var photoUrls = await uploadPendingPhotos();
    var existing  = editingId ? spots.find(function(s) { return s.id === editingId; }) : null;
    var tags      = Array.from(document.querySelectorAll('.tag-checkbox:checked')).map(function(cb) { return cb.value; });

    var payload = {
      id:          editingId || uuid(),
      name:        name,
      description: document.getElementById('spot-desc').value.trim(),
      safety:      document.getElementById('spot-safety').value.trim(),
      best_time:   document.getElementById('spot-time').value,
      tags:        tags,
      photos:      photoUrls,
      lat:         pendingLatLng ? pendingLatLng.lat : existing.lat,
      lng:         pendingLatLng ? pendingLatLng.lng : existing.lng,
      user_id:     currentUserId,
      date_added:  existing ? existing.date_added : new Date().toISOString(),
    };

    if (editingId) {
      var upd = await db.from('spots').update(payload).eq('id', editingId);
      if (upd.error) throw upd.error;
      var removedPhotos = (existing.photos || []).filter(function(url) { return !photoUrls.includes(url); });
      await deletePhotosFromStorage(removedPhotos);
      var idx = spots.findIndex(function(s) { return s.id === editingId; });
      if (idx !== -1) spots[idx] = payload;
      removeMarker(editingId);
      addMarkerForSpot(payload);
      if (activeSpotId === editingId) openDetailPanel(editingId);
    } else {
      var ins = await db.from('spots').insert(payload);
      if (ins.error) throw ins.error;
      if (!spots.find(function(s) { return s.id === payload.id; })) {
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
  var result = spots.filter(function(s) {
    var matchSearch = !searchQuery
      || s.name.toLowerCase().includes(searchQuery)
      || (s.description || '').toLowerCase().includes(searchQuery);
    var matchTags = filterTags.size === 0 || (s.tags || []).some(function(t) { return filterTags.has(t); });
    return matchSearch && matchTags;
  });

  if (sortMode === 'newest') {
    result.sort(function(a, b) { return new Date(b.date_added) - new Date(a.date_added); });
  } else if (sortMode === 'oldest') {
    result.sort(function(a, b) { return new Date(a.date_added) - new Date(b.date_added); });
  } else if (sortMode === 'name') {
    result.sort(function(a, b) { return a.name.localeCompare(b.name); });
  } else if (sortMode === 'nearest' && userLocation) {
    result.sort(function(a, b) {
      var da = haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng);
      var db = haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
      return da - db;
    });
  }

  return result;
}

function renderSpotsList() {
  var list  = document.getElementById('spots-list');
  var empty = document.getElementById('empty-state');
  var fs    = filteredSpots();

  var countEl = document.getElementById('spots-count');
  if (countEl) {
    var total = spots.length;
    var shown = fs.length;
    countEl.textContent = total === shown
      ? total + ' spot' + (total !== 1 ? 's' : '')
      : shown + ' of ' + total + ' spots';
  }

  Array.from(list.children).forEach(function(c) { if (c !== empty) c.remove(); });

  if (fs.length === 0) {
    empty.style.display = 'flex';
    empty.querySelector('span').innerHTML = spots.length === 0
      ? 'No spots yet.<br>Click the map to add one!'
      : 'No spots match your filter.';
    return;
  }
  empty.style.display = 'none';

  fs.forEach(function(spot) {
    var card = document.createElement('div');
    card.className = 'spot-card' + (spot.id === activeSpotId ? ' active' : '');

    if (spot.photos && spot.photos.length > 0) {
      var img = document.createElement('img');
      img.className = 'card-thumb'; img.src = spot.photos[0]; img.alt = spot.name;
      card.appendChild(img);
    }

    var nameEl = document.createElement('div');
    nameEl.className = 'card-name'; nameEl.textContent = spot.name;
    card.appendChild(nameEl);

    if (userLocation) {
      var dist = haversineKm(userLocation.lat, userLocation.lng, spot.lat, spot.lng);
      var distEl = document.createElement('div');
      distEl.className = 'card-distance';
      distEl.textContent = formatDistance(dist) + ' away';
      card.appendChild(distEl);
    }

    var dateEl = document.createElement('div');
    dateEl.className = 'card-date';
    dateEl.textContent = new Date(spot.date_added).toLocaleDateString('en-PH',
      { year: 'numeric', month: 'short', day: 'numeric' });
    card.appendChild(dateEl);

    var tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    (spot.tags || []).forEach(function(t) {
      var chip = document.createElement('span');
      chip.className = 'tag-chip tag-' + t; chip.textContent = t;
      tagsEl.appendChild(chip);
    });
    card.appendChild(tagsEl);
    card.addEventListener('click', function() {
      map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 14));
      openDetailPanel(spot.id);
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    });
    list.appendChild(card);
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function openDetailPanel(id) {
  var spot = spots.find(function(s) { return s.id === id; });
  if (!spot) return;
  activeSpotId = id;
  photoIndex   = 0;

  document.getElementById('detail-name').textContent = spot.name;
  document.getElementById('detail-coords').textContent = spot.lat.toFixed(6) + ', ' + spot.lng.toFixed(6);
  var timeMap = { any: 'Any time', morning: 'Morning', afternoon: 'Afternoon', 'golden-hour': 'Golden Hour' };
  document.getElementById('detail-time').textContent = timeMap[spot.best_time] || spot.best_time;
  document.getElementById('detail-date').textContent =
    new Date(spot.date_added).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  var tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = '';
  (spot.tags || []).forEach(function(t) {
    var chip = document.createElement('span');
    chip.className = 'tag-chip tag-' + t; chip.textContent = t;
    tagsEl.appendChild(chip);
  });
  document.getElementById('detail-tags-row').style.display   = spot.tags && spot.tags.length ? '' : 'none';
  document.getElementById('detail-desc').textContent         = spot.description || '—';
  document.getElementById('detail-desc-row').style.display   = spot.description ? '' : 'none';
  document.getElementById('detail-safety').textContent       = spot.safety || '—';
  document.getElementById('detail-safety-row').style.display = spot.safety ? '' : 'none';

  // Anyone can edit/delete spots — community-maintained map.
  document.getElementById('detail-edit').style.display   = '';
  document.getElementById('detail-delete').style.display = '';

  var directionsLink = document.getElementById('detail-directions');
  directionsLink.href = 'https://www.google.com/maps/dir/?api=1&destination=' + spot.lat + ',' + spot.lng;

  window.location.hash = 'spot=' + spot.id;

  renderDetailPhotos(spot.photos || []);
  detailPanel.classList.add('open');
  renderSpotsList();
}

function closeDetailPanel() {
  detailPanel.classList.remove('open');
  activeSpotId = null;
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  renderSpotsList();
}

function renderDetailPhotos(photos) {
  var container = document.getElementById('detail-photos');
  var prev = document.getElementById('photo-prev');
  var next = document.getElementById('photo-next');
  var dots = document.getElementById('photo-dots');

  container.querySelectorAll('img').forEach(function(i) { i.remove(); });
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

  photos.forEach(function(url, i) {
    var img = document.createElement('img');
    img.src = url; img.alt = 'Photo ' + (i + 1);
    img.style.cursor = 'zoom-in';
    if (i === photoIndex) img.classList.add('active');
    img.addEventListener('click', function() { openLightbox(photos, i); });
    container.insertBefore(img, prev);
    if (photos.length > 1) {
      var dot = document.createElement('button');
      dot.className = 'photo-dot' + (i === photoIndex ? ' active' : '');
      dot.addEventListener('click', function() { setPhotoIndex(i); });
      dots.appendChild(dot);
    }
  });
}

function setPhotoIndex(i) {
  var imgs   = document.querySelectorAll('#detail-photos img');
  var dotsEl = document.querySelectorAll('.photo-dot');
  photoIndex = (i + imgs.length) % imgs.length;
  imgs.forEach(function(img, idx) { img.classList.toggle('active', idx === photoIndex); });
  dotsEl.forEach(function(d, idx) { d.classList.toggle('active', idx === photoIndex); });
}

document.getElementById('photo-prev').addEventListener('click', function() { setPhotoIndex(photoIndex - 1); });
document.getElementById('photo-next').addEventListener('click', function() { setPhotoIndex(photoIndex + 1); });
document.getElementById('detail-close').addEventListener('click', closeDetailPanel);

// ── Photo Lightbox ───────────────────────────────────────────────────────────
var lightboxOverlay = document.getElementById('lightbox-overlay');
var lightboxImg     = document.getElementById('lightbox-img');
var lightboxCounter = document.getElementById('lightbox-counter');
var lightboxPrev    = document.getElementById('lightbox-prev');
var lightboxNext    = document.getElementById('lightbox-next');
var lightboxPhotos  = [];
var lightboxIndex   = 0;

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
  var multi = lightboxPhotos.length > 1;
  lightboxPrev.style.display = lightboxNext.style.display = multi ? 'flex' : 'none';
  lightboxCounter.style.display = multi ? 'block' : 'none';
  lightboxCounter.textContent = (lightboxIndex + 1) + ' / ' + lightboxPhotos.length;
}

function lightboxStep(delta) {
  lightboxIndex = (lightboxIndex + delta + lightboxPhotos.length) % lightboxPhotos.length;
  updateLightbox();
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', function() { lightboxStep(-1); });
document.getElementById('lightbox-next').addEventListener('click', function() { lightboxStep(1); });
lightboxOverlay.addEventListener('click', function(e) {
  if (e.target === lightboxOverlay) closeLightbox();
});
document.addEventListener('keydown', function(e) {
  if (!lightboxOverlay.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});

document.getElementById('detail-edit').addEventListener('click', function() {
  var spot = spots.find(function(s) { return s.id === activeSpotId; });
  if (!spot) return;
  editingId     = spot.id;
  pendingLatLng = { lat: spot.lat, lng: spot.lng };
  openModal(spot);
});

document.getElementById('detail-delete').addEventListener('click', function() {
  var spot = spots.find(function(s) { return s.id === activeSpotId; });
  if (!spot) return;
  document.getElementById('request-delete-spot-name').textContent = spot.name;
  document.getElementById('request-delete-reason').value = '';
  document.getElementById('request-delete-overlay').classList.add('open');
});

document.getElementById('request-delete-cancel').addEventListener('click', function() {
  document.getElementById('request-delete-overlay').classList.remove('open');
});

document.getElementById('request-delete-submit').addEventListener('click', async function() {
  var spot = spots.find(function(s) { return s.id === activeSpotId; });
  if (!spot) return;
  var reason = document.getElementById('request-delete-reason').value.trim();
  var ins = await db.from('deletion_requests').insert({
    spot_id:      spot.id,
    spot_name:    spot.name,
    reason:       reason,
    requested_by: currentUserId
  });
  if (ins.error) { toast('Request failed: ' + ins.error.message, 'error'); return; }
  document.getElementById('request-delete-overlay').classList.remove('open');
  toast('Deletion request submitted. An admin will review it.');
});

// ── FAB ───────────────────────────────────────────────────────────────────────
var fabTooltip = document.getElementById('fab-tooltip');
document.getElementById('fab-add').addEventListener('click', function() {
  fabTooltip.classList.toggle('visible');
  setTimeout(function() { fabTooltip.classList.remove('visible'); }, 3000);
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
document.getElementById('toggle-sidebar').addEventListener('click', function() {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('close-sidebar').addEventListener('click', function() {
  document.getElementById('sidebar').classList.remove('open');
});

// ── Search & filter ───────────────────────────────────────────────────────────
var searchDebounceTimer = null;
document.getElementById('search-input').addEventListener('input', function(e) {
  var value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(function() {
    searchQuery = value.trim().toLowerCase();
    renderSpotsList();
  }, 200);
});
document.querySelectorAll('.filter-tag').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tag = btn.dataset.tag;
    if (filterTags.has(tag)) { filterTags.delete(tag); btn.classList.remove('active'); }
    else                     { filterTags.add(tag);    btn.classList.add('active'); }
    renderSpotsList();
  });
});

// ── Export ────────────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', function() {
  if (!spots.length) { toast('No spots to export.', 'error'); return; }
  var blob = new Blob([JSON.stringify(spots, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'fpv-spots-ph-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(url);
  toast('Spots exported!');
});

// ── Realtime subscription ─────────────────────────────────────────────────────
function subscribeToSpots() {
  db.channel('spots-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spots' }, function(payload) {
      var spot = payload.new;
      if (spots.find(function(s) { return s.id === spot.id; })) return;
      spots.push(spot);
      addMarkerForSpot(spot);
      renderSpotsList();
      toast('New spot: ' + spot.name);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'spots' }, function(payload) {
      var spot = payload.new;
      var idx = spots.findIndex(function(s) { return s.id === spot.id; });
      if (idx !== -1) spots[idx] = spot; else spots.push(spot);
      removeMarker(spot.id);
      addMarkerForSpot(spot);
      if (activeSpotId === spot.id) openDetailPanel(spot.id);
      renderSpotsList();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'spots' }, function(payload) {
      var id = payload.old.id;
      spots = spots.filter(function(s) { return s.id !== id; });
      removeMarker(id);
      if (activeSpotId === id) closeDetailPanel();
      renderSpotsList();
    })
    .subscribe(function(status) { setStatus(status === 'SUBSCRIBED'); });
}

// ── localStorage migration (one-time) ─────────────────────────────────────────
async function migrateLocalStorage() {
  var raw = localStorage.getItem('fpv_spots_ph');
  if (!raw) return;
  var local = [];
  try { local = JSON.parse(raw); } catch { localStorage.removeItem('fpv_spots_ph'); return; }
  if (!local.length) { localStorage.removeItem('fpv_spots_ph'); return; }

  toast('Migrating ' + local.length + ' local spot(s) to the cloud…');
  for (var s of local) {
    var photoUrls = [];
    for (var photo of (s.photos || [])) {
      if (!photo.startsWith('data:')) { photoUrls.push(photo); continue; }
      try {
        var res  = await fetch(photo);
        var blob = await res.blob();
        var path = currentUserId + '/' + uuid() + '.' + (blob.type.split('/')[1] || 'jpg');
        var up   = await db.storage.from(PHOTO_BUCKET).upload(path, blob);
        if (!up.error) {
          var pub = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
          photoUrls.push(pub.data.publicUrl);
        }
      } catch (e) { /* skip failed photo */ }
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

// ── Share spot ───────────────────────────────────────────────────────────────
document.getElementById('detail-share').addEventListener('click', function() {
  var url = window.location.origin + window.location.pathname + '#spot=' + activeSpotId;
  if (navigator.share) {
    var spot = spots.find(function(s) { return s.id === activeSpotId; });
    navigator.share({ title: spot ? spot.name : 'FPV Spot', url: url }).catch(function() {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      toast('Link copied to clipboard!');
    });
  } else {
    prompt('Copy this link:', url);
  }
});

// ── Sort select ──────────────────────────────────────────────────────────────
document.getElementById('sort-select').addEventListener('change', function(e) {
  sortMode = e.target.value;
  if (sortMode === 'nearest' && !userLocation) {
    toast('Enable location first (tap the crosshairs button).', 'error');
    e.target.value = 'newest';
    sortMode = 'newest';
    return;
  }
  renderSpotsList();
});

// ── Geolocation ──────────────────────────────────────────────────────────────
var locateBtn = document.getElementById('btn-locate');
locateBtn.addEventListener('click', function() {
  if (!navigator.geolocation) {
    toast('Geolocation not supported by your browser.', 'error');
    return;
  }
  locateBtn.classList.add('loading');
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      locateBtn.classList.remove('loading');
      locateBtn.classList.add('active');
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      if (userMarker) userMarker.remove();
      userMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 8, fillColor: '#4299e1', fillOpacity: 0.9,
        color: '#fff', weight: 2,
      }).addTo(map).bindTooltip('You are here', { direction: 'top', offset: [0, -10] });

      map.flyTo([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 12));
      renderSpotsList();
      toast('Location found!');
    },
    function(err) {
      locateBtn.classList.remove('loading');
      toast('Could not get location: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ── Deep linking ─────────────────────────────────────────────────────────────
function openSpotFromHash() {
  var hash = window.location.hash;
  if (!hash || !hash.startsWith('#spot=')) return;
  var spotId = hash.slice(6);
  if (spotId && spots.find(function(s) { return s.id === spotId; })) {
    var spot = spots.find(function(s) { return s.id === spotId; });
    map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 14));
    openDetailPanel(spotId);
  }
}
window.addEventListener('hashchange', openSpotFromHash);

// ── Global keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (lightboxOverlay.classList.contains('open')) return;
    if (spotModal.classList.contains('open')) { closeModal(); return; }
    if (detailPanel.classList.contains('open')) { closeDetailPanel(); return; }
    if (document.getElementById('request-delete-overlay').classList.contains('open')) {
      document.getElementById('request-delete-overlay').classList.remove('open'); return;
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setStatus(false);

  var sessionRes = await db.auth.getSession();
  if (sessionRes.data.session) {
    currentUserId = sessionRes.data.session.user.id;
  } else {
    var anonRes = await db.auth.signInAnonymously();
    if (anonRes.error) { toast('Auth error: ' + anonRes.error.message, 'error'); return; }
    currentUserId = anonRes.data.user.id;
  }

  await migrateLocalStorage();

  var fetchRes = await db.from('spots').select('*').order('date_added', { ascending: false });
  if (fetchRes.error) { toast('Failed to load spots: ' + fetchRes.error.message, 'error'); return; }
  spots = fetchRes.data || [];

  spots.forEach(addMarkerForSpot);
  renderSpotsList();
  subscribeToSpots();
  openSpotFromHash();
}

init();
