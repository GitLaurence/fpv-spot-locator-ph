'use strict';

// ── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fpv_spots_ph';

function loadSpots() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveSpots(spots) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
}
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

// ── DOM refs (declared early to avoid TDZ issues) ────────────────────────────
const spotModal    = document.getElementById('spot-modal');
const detailPanel  = document.getElementById('detail-panel');

// ── State ─────────────────────────────────────────────────────────────────────
let spots = loadSpots();
let pendingLatLng = null;
let editingId = null;
let pendingPhotos = []; // { dataUrl, name }
let activeSpotId = null;
let photoIndex = 0;
let filterTags = new Set();
let searchQuery = '';

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([12.8797, 121.7740], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

const fpvIcon = L.icon({
  iconUrl: 'assets/marker-fpv.svg',
  iconSize: [36, 46],
  iconAnchor: [18, 46],
  popupAnchor: [0, -46],
  tooltipAnchor: [18, -30],
});

const markerMap = {}; // id → L.marker

function addMarkerForSpot(spot) {
  const marker = L.marker([spot.lat, spot.lng], { icon: fpvIcon })
    .addTo(map)
    .bindTooltip(spot.name, { className: 'spot-tooltip', direction: 'top', offset: [0, -10] });
  marker.on('click', () => openDetailPanel(spot.id));
  markerMap[spot.id] = marker;
}

function removeMarker(id) {
  if (markerMap[id]) { markerMap[id].remove(); delete markerMap[id]; }
}

// ── Map click ─────────────────────────────────────────────────────────────────
map.on('click', e => {
  pendingLatLng = e.latlng;
  editingId = null;
  openModal();
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function confirm(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.add('open');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const cleanup = (val) => {
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

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(spot = null) {
  pendingPhotos = spot ? spot.photos.map((url, i) => ({ dataUrl: url, name: `photo-${i}` })) : [];
  document.getElementById('modal-title').textContent = spot ? 'Edit Spot' : 'Add New Spot';

  const latlng = spot ? { lat: spot.lat, lng: spot.lng } : pendingLatLng;
  document.getElementById('modal-coords').textContent =
    latlng ? `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}` : 'Click a location on the map first';

  document.getElementById('spot-name').value    = spot ? spot.name : '';
  document.getElementById('spot-desc').value    = spot ? spot.description : '';
  document.getElementById('spot-safety').value  = spot ? spot.safety : '';
  document.getElementById('spot-time').value    = spot ? spot.bestTime : 'any';

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
  editingId = null;
  document.getElementById('spot-photos').value = '';
}

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
spotModal.addEventListener('click', e => { if (e.target === spotModal) closeModal(); });

document.getElementById('modal-save-btn').addEventListener('click', saveSpot);

// ── Photo handling ────────────────────────────────────────────────────────────
document.getElementById('spot-photos').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  const remaining = 5 - pendingPhotos.length;
  if (files.length > remaining) {
    toast(`Max 5 photos. ${remaining} slot(s) remaining.`, 'error');
  }
  const toAdd = files.slice(0, remaining);
  for (const f of toAdd) {
    if (f.size > 4 * 1024 * 1024) { toast(`${f.name} exceeds 4 MB, skipped.`, 'error'); continue; }
    const dataUrl = await readFileAsDataUrl(f);
    pendingPhotos.push({ dataUrl, name: f.name });
  }
  renderPhotoPreview();
  e.target.value = '';
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  const grid = document.getElementById('photo-preview-grid');
  const label = document.getElementById('photo-count-label');
  label.textContent = `(${pendingPhotos.length} / 5)`;
  grid.innerHTML = '';
  pendingPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.src = p.dataUrl;
    const btn = document.createElement('button');
    btn.className = 'photo-remove';
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btn.title = 'Remove photo';
    btn.addEventListener('click', () => { pendingPhotos.splice(i, 1); renderPhotoPreview(); });
    wrap.appendChild(img);
    wrap.appendChild(btn);
    grid.appendChild(wrap);
  });
}

// ── Save spot ─────────────────────────────────────────────────────────────────
function saveSpot() {
  const name = document.getElementById('spot-name').value.trim();
  if (!name) { toast('Spot name is required.', 'error'); document.getElementById('spot-name').focus(); return; }

  const latlng = editingId
    ? spots.find(s => s.id === editingId)
    : pendingLatLng;

  if (!latlng) { toast('Select a location on the map first.', 'error'); return; }

  const tags = Array.from(document.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value);

  const spotData = {
    id: editingId || uuid(),
    name,
    description: document.getElementById('spot-desc').value.trim(),
    safety: document.getElementById('spot-safety').value.trim(),
    bestTime: document.getElementById('spot-time').value,
    tags,
    photos: pendingPhotos.map(p => p.dataUrl),
    lat: editingId ? latlng.lat : pendingLatLng.lat,
    lng: editingId ? latlng.lng : pendingLatLng.lng,
    dateAdded: editingId ? (spots.find(s => s.id === editingId)?.dateAdded || new Date().toISOString()) : new Date().toISOString(),
  };

  if (editingId) {
    const idx = spots.findIndex(s => s.id === editingId);
    spots[idx] = spotData;
    removeMarker(editingId);
  } else {
    spots.push(spotData);
  }

  saveSpots(spots);
  addMarkerForSpot(spotData);
  renderSpotsList();
  closeModal();

  if (activeSpotId === spotData.id || (!editingId && activeSpotId === null)) {
    openDetailPanel(spotData.id);
  }
  toast(editingId ? 'Spot updated!' : 'Spot added!');
  map.flyTo([spotData.lat, spotData.lng], Math.max(map.getZoom(), 14));
}

// ── Spot list ─────────────────────────────────────────────────────────────────
function filteredSpots() {
  return spots.filter(s => {
    const matchSearch = !searchQuery ||
      s.name.toLowerCase().includes(searchQuery) ||
      s.description.toLowerCase().includes(searchQuery);
    const matchTags = filterTags.size === 0 || s.tags.some(t => filterTags.has(t));
    return matchSearch && matchTags;
  });
}

function renderSpotsList() {
  const list = document.getElementById('spots-list');
  const empty = document.getElementById('empty-state');
  const fs = filteredSpots();

  // clear non-empty-state children
  Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

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
    card.dataset.id = spot.id;

    if (spot.photos.length > 0) {
      const img = document.createElement('img');
      img.className = 'card-thumb';
      img.src = spot.photos[0];
      img.alt = spot.name;
      card.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = spot.name;

    const date = document.createElement('div');
    date.className = 'card-date';
    date.textContent = new Date(spot.dateAdded).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

    const tags = document.createElement('div');
    tags.className = 'card-tags';
    spot.tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = `tag-chip tag-${t}`;
      chip.textContent = t;
      tags.appendChild(chip);
    });

    card.appendChild(name);
    card.appendChild(date);
    card.appendChild(tags);

    card.addEventListener('click', () => {
      map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 14));
      openDetailPanel(spot.id);
      // close sidebar on mobile
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    });

    list.appendChild(card);
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openDetailPanel(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;
  activeSpotId = id;
  photoIndex = 0;

  document.getElementById('detail-name').textContent = spot.name;
  document.getElementById('detail-coords').textContent = `${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}`;
  document.getElementById('detail-time').textContent =
    { any: 'Any time', morning: 'Morning', afternoon: 'Afternoon', 'golden-hour': 'Golden Hour' }[spot.bestTime] || spot.bestTime;
  document.getElementById('detail-date').textContent =
    new Date(spot.dateAdded).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = '';
  spot.tags.forEach(t => {
    const chip = document.createElement('span');
    chip.className = `tag-chip tag-${t}`;
    chip.textContent = t;
    tagsEl.appendChild(chip);
  });
  document.getElementById('detail-tags-row').style.display = spot.tags.length ? '' : 'none';

  document.getElementById('detail-desc').textContent = spot.description || '—';
  document.getElementById('detail-desc-row').style.display = spot.description ? '' : 'none';

  document.getElementById('detail-safety').textContent = spot.safety || '—';
  document.getElementById('detail-safety-row').style.display = spot.safety ? '' : 'none';

  renderDetailPhotos(spot.photos);

  detailPanel.classList.add('open');
  renderSpotsList(); // update active state
}

function closeDetailPanel() {
  detailPanel.classList.remove('open');
  activeSpotId = null;
  renderSpotsList();
}

function renderDetailPhotos(photos) {
  const container = document.getElementById('detail-photos');
  const prev = document.getElementById('photo-prev');
  const next = document.getElementById('photo-next');
  const dots = document.getElementById('photo-dots');

  // remove old imgs
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

  photos.forEach((url, i) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Photo ${i + 1}`;
    if (i === photoIndex) img.classList.add('active');
    container.insertBefore(img, prev);

    if (photos.length > 1) {
      const dot = document.createElement('button');
      dot.className = 'photo-dot' + (i === photoIndex ? ' active' : '');
      dot.addEventListener('click', () => setPhotoIndex(i));
      dots.appendChild(dot);
    }
  });

  dots.style.display = photos.length > 1 ? 'flex' : 'none';
}

function setPhotoIndex(i) {
  const imgs = document.querySelectorAll('#detail-photos img');
  const dotsEl = document.querySelectorAll('.photo-dot');
  photoIndex = (i + imgs.length) % imgs.length;
  imgs.forEach((img, idx) => img.classList.toggle('active', idx === photoIndex));
  dotsEl.forEach((d, idx) => d.classList.toggle('active', idx === photoIndex));
}

document.getElementById('photo-prev').addEventListener('click', () => {
  const imgs = document.querySelectorAll('#detail-photos img');
  setPhotoIndex(photoIndex - 1);
});
document.getElementById('photo-next').addEventListener('click', () => {
  const imgs = document.querySelectorAll('#detail-photos img');
  setPhotoIndex(photoIndex + 1);
});
document.getElementById('detail-close').addEventListener('click', closeDetailPanel);

document.getElementById('detail-edit').addEventListener('click', () => {
  const spot = spots.find(s => s.id === activeSpotId);
  if (!spot) return;
  editingId = spot.id;
  pendingLatLng = { lat: spot.lat, lng: spot.lng };
  openModal(spot);
});

document.getElementById('detail-delete').addEventListener('click', async () => {
  const spot = spots.find(s => s.id === activeSpotId);
  if (!spot) return;
  const ok = await confirm(`Delete "${spot.name}"? This cannot be undone.`);
  if (!ok) return;
  spots = spots.filter(s => s.id !== activeSpotId);
  saveSpots(spots);
  removeMarker(activeSpotId);
  closeDetailPanel();
  renderSpotsList();
  toast('Spot deleted.');
});

// ── FAB ───────────────────────────────────────────────────────────────────────
const fabTooltip = document.getElementById('fab-tooltip');
document.getElementById('fab-add').addEventListener('click', () => {
  fabTooltip.classList.toggle('visible');
  setTimeout(() => fabTooltip.classList.remove('visible'), 3000);
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ── Search & filter ───────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderSpotsList();
});

document.querySelectorAll('.filter-tag').forEach(btn => {
  btn.addEventListener('click', () => {
    const tag = btn.dataset.tag;
    if (filterTags.has(tag)) { filterTags.delete(tag); btn.classList.remove('active'); }
    else { filterTags.add(tag); btn.classList.add('active'); }
    renderSpotsList();
  });
});

// ── Export ────────────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  if (!spots.length) { toast('No spots to export.', 'error'); return; }
  const json = JSON.stringify(spots, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fpv-spots-ph-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Spots exported!');
});

// ── Import ────────────────────────────────────────────────────────────────────
document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      let added = 0;
      imported.forEach(s => {
        if (!s.id || !s.name || s.lat === undefined || s.lng === undefined) return;
        if (!spots.find(ex => ex.id === s.id)) { spots.push(s); added++; }
      });
      saveSpots(spots);
      // rebuild markers
      Object.keys(markerMap).forEach(id => removeMarker(id));
      spots.forEach(addMarkerForSpot);
      renderSpotsList();
      toast(`Imported ${added} new spot(s).`);
    } catch {
      toast('Invalid JSON file.', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ── Init ──────────────────────────────────────────────────────────────────────
spots.forEach(addMarkerForSpot);
renderSpotsList();
