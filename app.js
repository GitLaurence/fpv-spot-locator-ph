/* ── FPV Spot Locator PH ─────────────────────────── */

const STORAGE_KEY = 'fpv_spots_ph';
const PH_CENTER   = [12.8797, 121.7740];
const PH_ZOOM     = 6;
const MAX_PHOTOS  = 5;

/* ── State ──────────────────────────────────────── */
let spots       = loadSpots();
let markers     = {};          // id → Leaflet marker
let activeId    = null;        // currently open detail
let pendingLatLng = null;      // latlng from map click
let editingId   = null;        // id being edited
let pendingPhotos = [];        // { dataUrl, name } during form
let deleteTargetId = null;
let activeTag   = 'all';
let searchQuery = '';

/* ── Map ────────────────────────────────────────── */
const map = L.map('map', {
  center: PH_CENTER,
  zoom:   PH_ZOOM,
  zoomControl: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

const droneIcon = L.divIcon({
  className: '',
  html: `<div class="fpv-marker"><svg viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="glow"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path d="M18 2C10.3 2 4 8.3 4 16c0 10.5 14 26 14 26s14-15.5 14-26C32 8.3 25.7 2 18 2z" fill="rgba(0,240,255,0.15)" stroke="#00f0ff" stroke-width="1.5" filter="url(#glow)"/>
    <g transform="translate(18,15)" filter="url(#glow)">
      <line x1="-6" y1="-6" x2="-3.5" y2="-3.5" stroke="#00f0ff" stroke-width="1.2"/>
      <line x1="6" y1="-6" x2="3.5" y2="-3.5" stroke="#00f0ff" stroke-width="1.2"/>
      <line x1="-6" y1="6" x2="-3.5" y2="3.5" stroke="#00f0ff" stroke-width="1.2"/>
      <line x1="6" y1="6" x2="3.5" y2="3.5" stroke="#00f0ff" stroke-width="1.2"/>
      <circle cx="-6" cy="-6" r="2.8" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
      <circle cx="6" cy="-6" r="2.8" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
      <circle cx="-6" cy="6" r="2.8" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
      <circle cx="6" cy="6" r="2.8" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
      <rect x="-3.5" y="-3.5" width="7" height="7" rx="1.5" fill="rgba(0,240,255,0.25)" stroke="#00f0ff" stroke-width="1.2"/>
      <circle cx="0" cy="0" r="1.5" fill="#00f0ff"/>
    </g>
  </svg></div>`,
  iconSize:   [36, 44],
  iconAnchor: [18, 44],
  popupAnchor:[0, -44],
});

// Map click → open add modal
map.on('click', e => {
  pendingLatLng = e.latlng;
  editingId     = null;
  openModal();
});

// Hide hint after first interaction
let hintDismissed = false;
map.on('click zoom movestart', () => {
  if (!hintDismissed) {
    hintDismissed = true;
    document.getElementById('map-hint').classList.add('hidden');
  }
});

/* ── Persistence ────────────────────────────────── */
function loadSpots() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveSpots() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

/* ── Render markers ─────────────────────────────── */
function renderAllMarkers() {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  spots.forEach(addMarker);
}

function addMarker(spot) {
  const m = L.marker([spot.lat, spot.lng], { icon: droneIcon })
    .bindPopup(`<div class="popup-name">${escHtml(spot.name)}</div><div class="popup-sub">${spot.tags.join(', ') || 'No tags'}</div>`)
    .addTo(map);
  m.on('click', () => openDetail(spot.id));
  markers[spot.id] = m;
}

/* ── Sidebar / cards ────────────────────────────── */
function renderSidebar() {
  const list   = document.getElementById('spot-list');
  const empty  = document.getElementById('empty-state');
  const countEl= document.getElementById('spot-count');

  let filtered = spots.filter(s => {
    const matchTag = activeTag === 'all' || s.tags.includes(activeTag);
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || (s.description||'').toLowerCase().includes(q);
    return matchTag && matchSearch;
  });

  countEl.textContent = spots.length;

  // Remove old cards (keep empty-state)
  list.querySelectorAll('.spot-card').forEach(el => el.remove());

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  filtered.forEach(spot => {
    const card = document.createElement('div');
    card.className = 'spot-card' + (spot.id === activeId ? ' active' : '');
    card.dataset.id = spot.id;

    const thumb = spot.photos.length
      ? `<div class="card-thumb"><img src="${spot.photos[0]}" alt="" /></div>`
      : `<div class="card-thumb"><i class="fa-solid fa-drone-front"></i></div>`;

    const tagsHtml = spot.tags.map(t => `<span class="card-tag">${t}</span>`).join('');
    const date = new Date(spot.dateAdded).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });

    card.innerHTML = `
      ${thumb}
      <div class="card-info">
        <div class="card-name">${escHtml(spot.name)}</div>
        <div class="card-meta">${date}</div>
        <div class="card-tags">${tagsHtml}</div>
      </div>`;

    card.addEventListener('click', () => {
      map.setView([spot.lat, spot.lng], 14, { animate: true });
      markers[spot.id]?.openPopup();
      openDetail(spot.id);
    });

    list.appendChild(card);
  });
}

/* ── Detail panel ───────────────────────────────── */
function openDetail(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;
  activeId = id;
  renderSidebar();

  const content = document.getElementById('detail-content');

  // Photos
  let photosHtml = spot.photos.length
    ? `<div class="detail-photos">${spot.photos.map(p => `<img class="detail-photo" src="${p}" alt="" />`).join('')}</div>`
    : `<div class="detail-no-photo"><i class="fa-solid fa-drone-front"></i></div>`;

  const tagsHtml = spot.tags.length
    ? spot.tags.map(t => `<span class="detail-tag">${t}</span>`).join('')
    : '<span style="color:var(--text-muted);font-size:12px">No tags</span>';

  const timeLabels = { any:'Any time', morning:'Morning', afternoon:'Afternoon', golden:'Golden hour', night:'Night' };
  const date = new Date(spot.dateAdded).toLocaleDateString('en-PH', { weekday:'short', month:'long', day:'numeric', year:'numeric' });

  content.innerHTML = `
    ${photosHtml}
    <h2 class="detail-name">${escHtml(spot.name)}</h2>
    <div class="detail-coords">${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}</div>
    <div class="detail-tags">${tagsHtml}</div>

    ${spot.description ? `<div class="detail-section">
      <div class="detail-section-label"><i class="fa-solid fa-align-left"></i> Description</div>
      <p>${escHtml(spot.description)}</p>
    </div>` : ''}

    ${spot.safety ? `<div class="detail-section">
      <div class="detail-section-label"><i class="fa-solid fa-triangle-exclamation"></i> Safety / Legality</div>
      <p>${escHtml(spot.safety)}</p>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-section-label"><i class="fa-solid fa-clock"></i> Best Time</div>
      <span class="detail-badge"><i class="fa-solid fa-sun"></i> ${timeLabels[spot.bestTime] || 'Any time'}</span>
    </div>

    <div class="detail-section">
      <div class="detail-section-label"><i class="fa-solid fa-calendar"></i> Added</div>
      <span class="detail-badge"><i class="fa-regular fa-calendar"></i> ${date}</span>
    </div>

    <div class="detail-actions">
      <button class="btn-ghost" id="detail-edit"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="btn-danger" id="detail-delete"><i class="fa-solid fa-trash"></i> Delete</button>
    </div>`;

  // Photo lightbox
  content.querySelectorAll('.detail-photo').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src));
  });

  document.getElementById('detail-edit').addEventListener('click', () => {
    openModal(spot);
    closeDetail();
  });
  document.getElementById('detail-delete').addEventListener('click', () => {
    deleteTargetId = id;
    document.getElementById('confirm-backdrop').classList.add('open');
  });

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('visible');
}

function closeDetail() {
  activeId = null;
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('visible');
  renderSidebar();
}

document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('panel-overlay').addEventListener('click', closeDetail);

/* ── Lightbox ───────────────────────────────────── */
function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="" />`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

/* ── Modal ──────────────────────────────────────── */
function openModal(spot = null) {
  editingId     = spot?.id || null;
  pendingPhotos = spot ? spot.photos.map(p => ({ dataUrl: p })) : [];

  const form  = document.getElementById('spot-form');
  form.reset();
  document.getElementById('photo-preview-grid').innerHTML = '';
  clearErrors();

  document.getElementById('modal-title').textContent = spot ? 'Edit FPV Spot' : 'Add FPV Spot';
  document.getElementById('form-id').value   = spot?.id || '';

  const lat = spot ? spot.lat : pendingLatLng?.lat;
  const lng = spot ? spot.lng : pendingLatLng?.lng;

  document.getElementById('form-lat').value          = lat || '';
  document.getElementById('form-lng').value          = lng || '';
  document.getElementById('form-lat-display').value  = lat ? lat.toFixed(6) : '';
  document.getElementById('form-lng-display').value  = lng ? lng.toFixed(6) : '';

  if (spot) {
    document.getElementById('form-name').value      = spot.name;
    document.getElementById('form-desc').value      = spot.description || '';
    document.getElementById('form-safety').value    = spot.safety || '';
    document.getElementById('form-best-time').value = spot.bestTime || 'any';
    form.querySelectorAll('input[name="tags"]').forEach(cb => {
      cb.checked = spot.tags.includes(cb.value);
    });
    renderPhotoPreviews();
  }

  document.getElementById('modal-backdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  pendingLatLng = null;
  editingId     = null;
  pendingPhotos = [];
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('form-cancel').addEventListener('click', closeModal);
document.getElementById('btn-add-spot').addEventListener('click', () => {
  pendingLatLng = null;
  editingId     = null;
  openModal();
});

// Close on backdrop click
document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-backdrop')) closeModal();
});

/* ── Photo handling ─────────────────────────────── */
const photoInput   = document.getElementById('form-photos');
const dropZone     = document.getElementById('photo-drop-zone');

photoInput.addEventListener('change', () => handleFiles(photoInput.files));

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

function handleFiles(files) {
  const errEl = document.getElementById('err-photos');
  const remaining = MAX_PHOTOS - pendingPhotos.length;
  if (remaining <= 0) { errEl.textContent = `Max ${MAX_PHOTOS} photos allowed.`; return; }
  errEl.textContent = '';

  Array.from(files).slice(0, remaining).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      pendingPhotos.push({ dataUrl: e.target.result, name: file.name });
      renderPhotoPreviews();
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreviews() {
  const grid = document.getElementById('photo-preview-grid');
  grid.innerHTML = '';
  pendingPhotos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<img src="${p.dataUrl}" alt="" />
      <button class="preview-remove" data-i="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>`;
    grid.appendChild(item);
  });
  grid.querySelectorAll('.preview-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingPhotos.splice(parseInt(btn.dataset.i), 1);
      renderPhotoPreviews();
    });
  });
}

/* ── Form submit ────────────────────────────────── */
document.getElementById('spot-form').addEventListener('submit', e => {
  e.preventDefault();
  clearErrors();

  const name = document.getElementById('form-name').value.trim();
  const lat  = parseFloat(document.getElementById('form-lat').value);
  const lng  = parseFloat(document.getElementById('form-lng').value);

  let valid = true;
  if (!name) {
    document.getElementById('err-name').textContent = 'Name is required.';
    valid = false;
  }
  if (!lat || !lng) {
    showToast('Please click the map first to set a location, or use Edit for an existing spot.', 'error');
    valid = false;
  }
  if (!valid) return;

  const tags = [...document.querySelectorAll('input[name="tags"]:checked')].map(cb => cb.value);

  if (editingId) {
    const idx = spots.findIndex(s => s.id === editingId);
    if (idx !== -1) {
      spots[idx] = {
        ...spots[idx],
        name,
        description: document.getElementById('form-desc').value.trim(),
        safety:      document.getElementById('form-safety').value.trim(),
        bestTime:    document.getElementById('form-best-time').value,
        tags,
        photos:      pendingPhotos.map(p => p.dataUrl),
        lat, lng,
      };
      if (markers[editingId]) {
        map.removeLayer(markers[editingId]);
        delete markers[editingId];
      }
      addMarker(spots[idx]);
      showToast('Spot updated!', 'success');
    }
  } else {
    const spot = {
      id:          uuid(),
      name,
      description: document.getElementById('form-desc').value.trim(),
      safety:      document.getElementById('form-safety').value.trim(),
      bestTime:    document.getElementById('form-best-time').value,
      tags,
      photos:      pendingPhotos.map(p => p.dataUrl),
      lat, lng,
      dateAdded:   new Date().toISOString(),
    };
    spots.push(spot);
    addMarker(spot);
    showToast('Spot added!', 'success');

    // Fly to new spot
    map.setView([lat, lng], 14, { animate: true });
    setTimeout(() => markers[spot.id]?.openPopup(), 500);
  }

  saveSpots();
  renderSidebar();
  closeModal();
});

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
}

/* ── Delete ─────────────────────────────────────── */
document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-backdrop').classList.remove('open');
  deleteTargetId = null;
});

document.getElementById('confirm-delete').addEventListener('click', () => {
  if (!deleteTargetId) return;
  const id = deleteTargetId;
  spots = spots.filter(s => s.id !== id);
  if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
  saveSpots();
  renderSidebar();
  closeDetail();
  document.getElementById('confirm-backdrop').classList.remove('open');
  deleteTargetId = null;
  showToast('Spot deleted.', 'success');
});

/* ── Sidebar toggle ─────────────────────────────── */
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sidebar  = document.getElementById('sidebar');
  const chevron  = document.getElementById('sidebar-chevron');
  sidebar.classList.toggle('collapsed');
  chevron.style.transform = sidebar.classList.contains('collapsed') ? 'rotate(180deg)' : '';
  setTimeout(() => map.invalidateSize(), 300);
});

/* ── Search & filters ───────────────────────────── */
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderSidebar();
});

document.querySelectorAll('.tag-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tag-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTag = btn.dataset.tag;
    renderSidebar();
  });
});

/* ── Export ─────────────────────────────────────── */
document.getElementById('btn-export').addEventListener('click', () => {
  if (spots.length === 0) { showToast('No spots to export.', 'error'); return; }
  const blob = new Blob([JSON.stringify(spots, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `fpv-spots-ph-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Exported ${spots.length} spot${spots.length!==1?'s':''}.`, 'success');
});

/* ── Import ─────────────────────────────────────── */
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      let added = 0;
      imported.forEach(s => {
        if (!s.id || !s.name || s.lat == null || s.lng == null) return;
        if (!spots.find(x => x.id === s.id)) {
          spots.push(s);
          addMarker(s);
          added++;
        }
      });
      saveSpots();
      renderSidebar();
      showToast(`Imported ${added} new spot${added!==1?'s':''}.`, 'success');
    } catch {
      showToast('Invalid JSON file.', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

/* ── Toast ──────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${escHtml(msg)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

/* ── Utils ──────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Boot ───────────────────────────────────────── */
renderAllMarkers();
renderSidebar();

// Resize map on load
setTimeout(() => map.invalidateSize(), 100);
