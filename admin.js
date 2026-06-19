'use strict';

const SUPABASE_URL = 'https://fauqswafzifswsfgfffz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhdXFzd2Fmemlmc3dzZmdmZmZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NTA0NDgsImV4cCI6MjA5NjUyNjQ0OH0.ThwEMHpbbd2uU9Yh96jZm82xpFLVWtmbcsObO2eHAAQ';
const PHOTO_BUCKET = 'spot-photos';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TAG_LABELS = {
  freestyle: 'Freestyle',
  racing: 'Racing',
  'long-range': 'Long-range',
  photography: 'Photography'
};

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

// ── Photo storage cleanup ────────────────────────────────────────────────────
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

// ── Auth / login screen toggling ─────────────────────────────────────────────
const loginScreen = document.getElementById('admin-login-screen');
const dashboard   = document.getElementById('admin-dashboard');
const loginError  = document.getElementById('admin-login-error');

function showLogin() {
  loginScreen.style.display = 'flex';
  dashboard.style.display   = 'none';
}

function showDashboard() {
  loginScreen.style.display = 'none';
  dashboard.style.display   = 'block';
  loadAll();
}

async function checkIsAdmin(userId) {
  const res = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !res.error && !!res.data;
}

async function init() {
  const sessionRes = await db.auth.getSession();
  const user = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user;
  if (user && await checkIsAdmin(user.id)) {
    showDashboard();
  } else {
    if (user) await db.auth.signOut();
    showLogin();
  }
}

document.getElementById('admin-login-btn').addEventListener('click', async function() {
  loginError.textContent = '';
  const email    = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  if (!email || !password) {
    loginError.textContent = 'Please enter your email and password.';
    return;
  }
  const res = await db.auth.signInWithPassword({ email, password });
  if (res.error) {
    loginError.textContent = res.error.message;
    return;
  }
  const isAdmin = await checkIsAdmin(res.data.user.id);
  if (!isAdmin) {
    await db.auth.signOut();
    loginError.textContent = 'This account does not have admin access.';
    return;
  }
  showDashboard();
});

document.getElementById('admin-password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
});

document.getElementById('admin-logout-btn').addEventListener('click', async function() {
  await db.auth.signOut();
  showLogin();
});

// ── Data loading ──────────────────────────────────────────────────────────────
let allSpots = [];

async function loadAll() {
  const loading = document.getElementById('admin-loading');
  loading.classList.remove('hidden');
  await Promise.all([loadRequests(), loadSpots()]);
  loading.classList.add('hidden');
}

document.getElementById('spots-search').addEventListener('input', function() {
  filterSpots(this.value.trim().toLowerCase());
});

async function loadRequests() {
  const res = await db.from('deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const list  = document.getElementById('requests-list');
  const empty = document.getElementById('requests-empty');
  const count = document.getElementById('requests-count');

  if (res.error) { toast('Failed to load requests: ' + res.error.message, 'error'); return; }

  const requests = res.data || [];
  count.textContent = requests.length;
  list.querySelectorAll('.request-card').forEach(el => el.remove());
  empty.style.display = requests.length ? 'none' : '';

  requests.forEach(req => {
    const card = document.createElement('div');
    card.className = 'request-card';
    card.innerHTML =
      '<div class="request-info">' +
        '<strong>' + escapeHtml(req.spot_name) + '</strong>' +
        (req.reason ? '<p>' + escapeHtml(req.reason) + '</p>' : '<p class="muted">No reason given.</p>') +
        '<span class="muted">Requested ' + new Date(req.created_at).toLocaleString() + '</span>' +
      '</div>' +
      '<div class="request-actions">' +
        '<button class="btn btn-danger btn-sm" data-action="approve">Delete Spot</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="dismiss">Dismiss</button>' +
      '</div>';

    card.querySelector('[data-action="approve"]').addEventListener('click', () => approveRequest(req));
    card.querySelector('[data-action="dismiss"]').addEventListener('click', () => dismissRequest(req));
    list.appendChild(card);
  });
}

async function approveRequest(req) {
  const ok = await showConfirm('Delete spot "' + req.spot_name + '" and resolve this request?');
  if (!ok) return;

  if (req.spot_id) {
    const spotRes = await db.from('spots').select('photos').eq('id', req.spot_id).maybeSingle();
    const del = await db.from('spots').delete().eq('id', req.spot_id);
    if (del.error) { toast('Delete failed: ' + del.error.message, 'error'); return; }
    if (spotRes.data) await deletePhotosFromStorage(spotRes.data.photos);
  }

  await db.from('deletion_requests').update({ status: 'resolved' }).eq('id', req.id);
  toast('Spot deleted and request resolved.');
  loadAll();
}

async function dismissRequest(req) {
  const ok = await showConfirm('Dismiss this deletion request without deleting the spot?');
  if (!ok) return;
  await db.from('deletion_requests').update({ status: 'dismissed' }).eq('id', req.id);
  toast('Request dismissed.');
  loadRequests();
}

async function loadSpots() {
  const res = await db.from('spots').select('*').order('date_added', { ascending: false });

  if (res.error) { toast('Failed to load spots: ' + res.error.message, 'error'); return; }

  allSpots = res.data || [];
  document.getElementById('spots-count').textContent = allSpots.length;
  document.getElementById('spots-empty').style.display = allSpots.length ? 'none' : '';
  document.getElementById('spots-search').value = '';
  renderSpots(allSpots);
}

function filterSpots(query) {
  if (!query) { renderSpots(allSpots); return; }
  const filtered = allSpots.filter(s =>
    s.name.toLowerCase().includes(query) ||
    (s.tags || []).some(t => t.toLowerCase().includes(query))
  );
  renderSpots(filtered);
  document.getElementById('spots-no-match').style.display = filtered.length ? 'none' : '';
}

function renderSpots(spots) {
  const tbody = document.getElementById('spots-tbody');
  const noMatch = document.getElementById('spots-no-match');
  tbody.innerHTML = '';
  if (noMatch) noMatch.style.display = 'none';

  spots.forEach(spot => {
    const tr = document.createElement('tr');
    const tags = (spot.tags || []).map(t => TAG_LABELS[t] || t).join(', ') || '—';
    tr.innerHTML =
      '<td>' + escapeHtml(spot.name) + '</td>' +
      '<td>' + escapeHtml(tags) + '</td>' +
      '<td>' + spot.lat.toFixed(5) + ', ' + spot.lng.toFixed(5) + '</td>' +
      '<td>' + (spot.photos ? spot.photos.length : 0) + '</td>' +
      '<td>' + (spot.date_added ? new Date(spot.date_added).toLocaleDateString() : '—') + '</td>' +
      '<td><button class="btn btn-danger btn-sm" data-action="delete-spot"><i class="fa-solid fa-trash"></i></button></td>';

    tr.querySelector('[data-action="delete-spot"]').addEventListener('click', () => deleteSpot(spot));
    tbody.appendChild(tr);
  });
}

async function deleteSpot(spot) {
  const ok = await showConfirm('Delete "' + spot.name + '"? This cannot be undone.');
  if (!ok) return;
  const del = await db.from('spots').delete().eq('id', spot.id);
  if (del.error) { toast('Delete failed: ' + del.error.message, 'error'); return; }
  await deletePhotosFromStorage(spot.photos);
  toast('Spot deleted.');
  loadAll();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

init();
