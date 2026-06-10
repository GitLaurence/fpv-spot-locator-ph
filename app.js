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

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false }).setView([12.8797, 121.7740], 6);
L.control.zoom({ position: 'topright' }).addTo(map);

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
}, null, { position: 'topright' }).addTo(map);

const fpvIcon = L.icon({
  iconUrl: 'assets/marker-fpv.svg',
  iconSize: [36, 46], iconAnchor: [18, 46],
  popupAnchor: [0, -46], tooltipAnchor: [18, -30],
});

const markerMap = {};

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
function setStatus(connected) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot) return;
  dot.className    = 'status-dot ' + (connected ? 'online' : 'offline');
  text.textContent = connected ? 'Live' : 'Connecting…';
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
spotModal.addEventListener('click', function(e) { if (e.target === spotModal) closeModal(); });
document.getElementById('modal-save-btn').addEventListener('click', saveSpot);

// ── Photo file input ──────────────────────────────────────────────────────────
document.getElementById('spot-photos').addEventListener('change', async function(e) {
  var files = Array.from(e.target.files);
  var remaining = 5 - pendingPhotos.length;
  if (files.length > remaining) toast('Max 5 photos. ' + remaining + ' slot(s) left.', 'error');
  for (var f of files.slice(0, remaining)) {
    if (f.size > 4 * 1024 * 1024) { toast(f.name + ' exceeds 4 MB, skipped.', 'error'); continue; }
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
      lat:         existing ? existing.lat : pendingLatLng.lat,
      lng:         existing ? existing.lng : pendingLatLng.lng,
      user_id:     currentUserId,
      date_added:  existing ? existing.date_added : new Date().toISOString(),
    };

    if (editingId) {
      var upd = await db.from('spots').update(payload).eq('id', editingId);
      if (upd.error) throw upd.error;
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
  return spots.filter(function(s) {
    var matchSearch = !searchQuery
      || s.name.toLowerCase().includes(searchQuery)
      || (s.description || '').toLowerCase().includes(searchQuery);
    var matchTags = filterTags.size === 0 || (s.tags || []).some(function(t) { return filterTags.has(t); });
    return matchSearch && matchTags;
  });
}

function renderSpotsList() {
  var list  = document.getElementById('spots-list');
  var empty = document.getElementById('empty-state');
  var fs    = filteredSpots();

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

    var dateEl = document.createElement('div');
    dateEl.className = 'card-date';
    dateEl.textContent = new Date(spot.date_added).toLocaleDateString('en-PH',
      { year: 'numeric', month: 'short', day: 'numeric' });

    var tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    (spot.tags || []).forEach(function(t) {
      var chip = document.createElement('span');
      chip.className = 'tag-chip tag-' + t; chip.textContent = t;
      tagsEl.appendChild(chip);
    });

    card.appendChild(nameEl); card.appendChild(dateEl); card.appendChild(tagsEl);
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

  var isOwner = spot.user_id === currentUserId;
  document.getElementById('detail-edit').style.display   = isOwner ? '' : 'none';
  document.getElementById('detail-delete').style.display = isOwner ? '' : 'none';

  renderDetailPhotos(spot.photos || []);
  detailPanel.classList.add('open');
  renderSpotsList();
}

function closeDetailPanel() {
  detailPanel.classList.remove('open');
  activeSpotId = null;
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

document.getElementById('detail-delete').addEventListener('click', async function() {
  var spot = spots.find(function(s) { return s.id === activeSpotId; });
  if (!spot) return;
  var ok = await showConfirm('Delete "' + spot.name + '"? This cannot be undone.');
  if (!ok) return;
  var del = await db.from('spots').delete().eq('id', spot.id);
  if (del.error) { toast('Delete failed: ' + del.error.message, 'error'); return; }
  spots = spots.filter(function(s) { return s.id !== spot.id; });
  removeMarker(spot.id);
  closeDetailPanel();
  renderSpotsList();
  toast('Spot deleted.');
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
document.getElementById('search-input').addEventListener('input', function(e) {
  searchQuery = e.target.value.trim().toLowerCase();
  renderSpotsList();
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
}

init();
