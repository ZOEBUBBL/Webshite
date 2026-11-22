// Scroller: your own videos and photos as a phone-style feed, or as Live TV with a channel per subfolder.
// Everything runs in this page. Files are read straight from the visitor's disk (a folder picker, a file list, or a drag
// and drop) and played through object URLs; nothing is sent anywhere. Likes, stars and settings live in localStorage.
(() => {
  'use strict';

  // ---- small helpers ---------------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
  const PHOTO = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);
  const PHOTO_SECONDS = 7;      // how long a photo stays up when the feed plays on by itself
  const TV_PHOTO_SECONDS = 8;   // and on Live TV
  const store = {
    get(k, d) { try { const v = localStorage.getItem('scroller.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('scroller.' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const toast = (t) => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1400); };
  const fmtSize = (b) => !b ? '' : b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB';
  const fmtTime = (s) => { if (!isFinite(s)) return ''; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const ext = (name) => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };
  const stem = (name) => { const i = name.lastIndexOf('.'); return (i < 0 ? name : name.slice(0, i)).replace(/[_]+/g, ' '); };

  // Inline SVG icons (stroke style), so the buttons look the same on every system.
  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    files: '<rect x="4" y="3" width="12" height="16" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V7"/>',
    play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor" stroke="none"/>',
    heart: '<path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5c-2.3 4.6-9.3 9-9.3 9z" fill="currentColor" stroke="none"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/>',
    muted: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    auto: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M6 20h12"/>',
    guide: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  const paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  const setIcon = (el, name) => { const i = el.querySelector('[data-icon]'); if (i) { i.dataset.icon = name; i.innerHTML = icon(name); } };
  paintIcons();

  // ---- state -----------------------------------------------------------------------------------------------------
  let items = [];               // { id, name, rel, channel, size, mtime, kind, file?, url?, duration? }
  let sourceName = '';
  let view = 'welcome';
  let muted = store.get('muted', true), fill = store.get('fill', false), auto = store.get('auto', false);
  let sortMode = store.get('sort', 'new');
  let rates = store.get('rates', {});
  const rateKey = (it) => it.rel + '|' + (it.size || 0);

  // ---- reading files ---------------------------------------------------------------------------------------------
  function makeItem(rel, file, extra = {}) {
    const name = rel.split('/').pop();
    const e = ext(name);
    const kind = VIDEO.has(e) ? 'video' : PHOTO.has(e) ? 'photo' : null;
    if (!kind) return null;
    const parts = rel.split('/');
    const it = {
      id: items.length + ':' + rel, rel, name: stem(name), kind,
      channel: parts.length > 1 ? parts[0] : '',
      size: file ? file.size : (extra.size || 0),
      mtime: file ? file.lastModified : (extra.mtime || 0),
      file, url: extra.url || null, duration: extra.duration || 0,
    };
    const r = rates[rateKey(it)];
    if (r) { it.like = !!r.like; it.stars = r.stars || 0; }
    return it;
  }
  function srcOf(it) {
    if (it.url) return it.url;
    if (!it._obj && it.file) it._obj = URL.createObjectURL(it.file);
    return it._obj || '';
  }
  function release(it) { if (it._obj) { URL.revokeObjectURL(it._obj); it._obj = null; } }
  function releaseAll() { items.forEach(release); }

  // When everything comes from one top folder (a folder input lists "Holiday/a.mp4"), drop that prefix so its
  // subfolders become the channels.
  function trimCommonRoot(list) {
    if (!list.length) return '';
    const first = list[0].rel.split('/')[0];
    if (list.every((it) => it.rel.includes('/') && it.rel.split('/')[0] === first)) {
      list.forEach((it) => { it.rel = it.rel.slice(first.length + 1); const p = it.rel.split('/'); it.channel = p.length > 1 ? p[0] : ''; });
      return first;
    }
    return '';
  }

  async function walkHandle(dir, prefix, out, depth = 0) {
    if (depth > 12) return;
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') await walkHandle(handle, prefix + name + '/', out, depth + 1);
      else if (VIDEO.has(ext(name)) || PHOTO.has(ext(name))) {
        try { out.push({ rel: prefix + name, file: await handle.getFile() }); } catch (e) {}
      }
    }
  }
  async function walkEntry(entry, prefix, out, depth = 0) {
    if (depth > 12) return;
    if (entry.isFile) {
      if (VIDEO.has(ext(entry.name)) || PHOTO.has(ext(entry.name))) {
        const file = await new Promise((res) => entry.file(res, () => res(null)));
        if (file) out.push({ rel: prefix + entry.name, file });
      }
      return;
    }
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res) => reader.readEntries(res, () => res([])));
      for (const child of batch) await walkEntry(child, prefix + entry.name + '/', out, depth + 1);
    } while (batch.length);
  }

  function busy(on, text) { $('loading').classList.toggle('on', on); if (text) $('loadingText').textContent = text; }

  function open(list, name) {
    releaseAll();
    items = [];
    for (const f of list) { const it = makeItem(f.rel, f.file, f); if (it) items.push(it); }
    const root = trimCommonRoot(items);
    sourceName = name || root || 'Your files';
    busy(false);
    if (!items.length) {
      toast('No videos or photos in there');
      show('welcome');
      return;
    }
    document.querySelectorAll('.sourceName').forEach((el) => { el.textContent = sourceName; });
    const v = items.filter((i) => i.kind === 'video').length, p = items.length - v;
    const countText = [v && `${v} video${v === 1 ? '' : 's'}`, p && `${p} photo${p === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    document.querySelectorAll('.count').forEach((el) => { el.textContent = countText; });
    feedBuilt = false;
    channels = [];
    show(store.get('lastView', 'feed') === 'tv' ? 'tv' : 'feed');
  }

  // Folder: the modern picker where there is one (Chrome, Edge), which can also reopen the folder next time.
  async function pickFolder() {
    if (window.showDirectoryPicker) {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: 'scroller', mode: 'read' }); }
      catch (e) { if (e && e.name === 'AbortError') return; dir = null; }
      if (dir) { await openHandle(dir); rememberHandle(dir); return; }
    }
    $('folderInput').click();
  }
  async function openHandle(dir) {
    busy(true, 'Reading ' + dir.name + '...');
    const out = [];
    try { await walkHandle(dir, '', out); } catch (e) { busy(false); toast("Couldn't read that folder"); return; }
    open(out, dir.name);
  }
  $('pickFolder').onclick = pickFolder;
  $('pickFiles').onclick = () => $('filesInput').click();
  $('folderInput').onchange = (e) => {
    const files = [...e.target.files];
    busy(true, 'Reading your folder...');
    open(files.map((f) => ({ rel: f.webkitRelativePath || f.name, file: f })));
    e.target.value = '';
  };
  $('filesInput').onchange = (e) => {
    const files = [...e.target.files];
    open(files.map((f) => ({ rel: f.name, file: f })), files.length === 1 ? files[0].name : `${files.length} files`);
    e.target.value = '';
  };
  $('trySamples').onclick = () => {
    const list = (window.SCROLLER_SAMPLES || []).map((s) => ({ rel: s.rel, url: s.url, size: s.size, mtime: s.mtime, duration: s.duration }));
    if (!list.length) { toast('The samples folder is missing'); return; }
    open(list, 'Samples');
  };

  // Drag and drop, anywhere on the welcome screen.
  const welcome = $('welcome');
  ['dragenter', 'dragover'].forEach((t) => welcome.addEventListener(t, (e) => { e.preventDefault(); welcome.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((t) => welcome.addEventListener(t, (e) => { if (t === 'dragleave' && welcome.contains(e.relatedTarget)) return; welcome.classList.remove('dragging'); }));
  welcome.addEventListener('drop', async (e) => {
    e.preventDefault();
    const entries = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return;
    busy(true, 'Reading what you dropped...');
    const out = [];
    for (const en of entries) await walkEntry(en, '', out);
    open(out, entries.length === 1 ? entries[0].name : `${entries.length} items`);
  });

  // Remember the last folder (Chrome and Edge keep the handle; the browser asks again before reading it).
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('scroller', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function rememberHandle(dir) {
    try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(dir, 'lastDir'); } catch (e) {}
  }
  async function lastHandle() {
    try {
      const db = await idb();
      return await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('lastDir'); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
    } catch (e) { return null; }
  }
  (async () => {
    if (!window.showDirectoryPicker) return;
    const dir = await lastHandle();
    if (!dir) return;
    $('reopen').classList.remove('hidden');
    $('reopenName').textContent = 'Open ' + dir.name + ' again';
    $('reopen').onclick = async () => {
      try {
        if ((await dir.queryPermission({ mode: 'read' })) !== 'granted' && (await dir.requestPermission({ mode: 'read' })) !== 'granted') return;
        await openHandle(dir);
      } catch (e) { toast("That folder isn't there any more"); $('reopen').classList.add('hidden'); }
    };
  })();

  // ---- views -----------------------------------------------------------------------------------------------------
  function show(name) {
    if (view === 'feed' && name !== 'feed') pauseFeed();
    if (view === 'tv' && name !== 'tv') stopTv();
    view = name;
    ['welcome', 'feedView', 'tvView'].forEach((id) => $(id).classList.toggle('on', id === (name === 'welcome' ? 'welcome' : name + 'View')));
    if (name === 'feed') { store.set('lastView', 'feed'); enterFeed(); }
    if (name === 'tv') { store.set('lastView', 'tv'); enterTv(); }
  }
  const help = (on) => $('help').classList.toggle('on', on === undefined ? !$('help').classList.contains('on') : on);
  $('helpLink').onclick = () => help(true);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    switch (b.dataset.act) {
      case 'home': show('welcome'); break;
      case 'feed': if (items.length) show('feed'); break;
      case 'tv': if (items.length) show('tv'); break;
      case 'help': help(); break;
      case 'coach': $('coach').classList.remove('on'); store.set('coached', true); $('feed').focus(); break;
      case 'mute': setMute(!muted); break;
      case 'fit': setFill(!fill); break;
      case 'auto': setAuto(!auto); break;
      case 'rated': setSort(sortMode === 'rated' ? 'new' : 'rated'); break;
      case 'shuffle': setSort('shuffle'); break;
      case 'guide': toggleGuide(); break;
      case 'chup': tune(cur + 1); break;
      case 'chdown': tune(cur - 1); break;
    }
  });
  $('help').addEventListener('click', (e) => { if (e.target.id === 'help') help(false); });

  function setMute(m) {
    muted = m; store.set('muted', m);
    document.querySelectorAll('[data-act="mute"]').forEach((b) => { setIcon(b, m ? 'muted' : 'sound'); b.classList.toggle('on', !m); });
    cards.forEach((c) => { const v = c.querySelector('video'); if (v) v.muted = m; });
    $('tv').muted = m;
    toast(m ? 'Muted' : 'Sound on');
  }
  function setFill(f) {
    fill = f; store.set('fill', f);
    document.querySelectorAll('[data-act="fit"]').forEach((b) => b.classList.toggle('on', f));
    cards.forEach((c) => c.classList.toggle('fill', f));
    $('screen').classList.toggle('fill', f);
    toast(f ? 'Filling the screen' : 'Whole frame');
  }
  function setAuto(a, quiet) {
    auto = a; store.set('auto', a);
    document.querySelectorAll('[data-act="auto"]').forEach((b) => b.classList.toggle('on', a));
    cards.forEach((c) => { const v = c.querySelector('video'); if (v) v.loop = !a; });
    armPhotoTimer();
    if (!quiet) toast(a ? 'Auto: on to the next one when this ends' : 'Auto off: each one loops');
  }
  function paintToggles() {
    document.querySelectorAll('[data-act="mute"]').forEach((b) => { setIcon(b, muted ? 'muted' : 'sound'); b.classList.toggle('on', !muted); });
    document.querySelectorAll('[data-act="fit"]').forEach((b) => b.classList.toggle('on', fill));
    document.querySelectorAll('[data-act="auto"]').forEach((b) => b.classList.toggle('on', auto));
    $('sortRated').classList.toggle('on', sortMode === 'rated');
    $('sortShuffle').classList.toggle('on', sortMode === 'shuffle');
    $('screen').classList.toggle('fill', fill);
  }

  // ---- the feed --------------------------------------------------------------------------------------------------
  const feed = $('feed');
  let cards = [], current = -1, feedBuilt = false, photoTimer = 0;

  function ordered(list) {
    const a = list.slice();
    if (sortMode === 'rated') a.sort((x, y) => (y.stars || 0) - (x.stars || 0) || ((y.like ? 1 : 0) - (x.like ? 1 : 0)) || y.mtime - x.mtime);
    else if (sortMode === 'shuffle') { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
    else a.sort((x, y) => y.mtime - x.mtime || x.rel.localeCompare(y.rel));
    return a;
  }
  function setSort(mode) {
    sortMode = mode; store.set('sort', mode);
    paintToggles();
    buildFeed();
    toast(mode === 'rated' ? 'Top rated first' : mode === 'shuffle' ? 'Shuffled' : 'Newest first');
  }

  function enterFeed() {
    paintToggles();
    if (!feedBuilt) buildFeed();
    else if (cards[current]) playCard(cards[current]);
    feed.focus();
    if (!store.get('coached', false)) $('coach').classList.add('on');
  }
  function pauseFeed() {
    clearTimeout(photoTimer);
    cards.forEach((c) => { const v = c.querySelector('video'); if (v && !v.paused) v.pause(); });
  }

  function buildFeed() {
    feedBuilt = true;
    io.disconnect();
    cards.forEach((c) => { const v = c.querySelector('video'); if (v) { v.removeAttribute('src'); v.load(); } });
    items.forEach(release);
    feed.innerHTML = ''; cards = []; current = -1;
    const list = ordered(items);
    list.forEach((it, i) => {
      const card = document.createElement('section');
      card.className = 'card' + (fill ? ' fill' : '');
      card.dataset.i = i;
      card.item = it;
      let media;
      if (it.kind === 'video') {
        media = document.createElement('video');
        media.loop = !auto; media.playsInline = true; media.preload = 'none'; media.muted = muted;
      } else {
        media = document.createElement('img');
        media.alt = it.name; media.decoding = 'async'; media.className = 'kb';
      }
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = '<div class="name"></div><div class="sub"></div>';
      meta.querySelector('.name').textContent = it.name;
      const sub = meta.querySelector('.sub');
      const bits = [it.channel, fmtDate(it.mtime), fmtSize(it.size)].filter(Boolean);
      sub.innerHTML = it.kind === 'photo' ? '<span class="tag">PHOTO</span>' : '';
      sub.appendChild(document.createTextNode(bits.join(' · ')));
      const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = '<i></i>';
      const paused = document.createElement('div'); paused.className = 'paused';
      paused.innerHTML = `<span><span class="ico">${icon('play')}</span></span>`;
      const tools = document.createElement('div'); tools.className = 'tools';
      const heart = document.createElement('button'); heart.className = 'heart' + (it.like ? ' on' : ''); heart.title = 'Like (L)';
      heart.innerHTML = `<span class="ico">${icon('heart')}</span>`;
      const stars = document.createElement('div'); stars.className = 'stars'; stars.title = 'Rate it: hover, then pick 1 to 5 stars';
      // Laid out right to left, so the face (1 star) sits by the edge and 5 opens out to the left.
      for (let s = 5; s >= 1; s--) {
        const b = document.createElement('button');
        b.innerHTML = `<span class="ico">${icon('star')}</span>`; b.dataset.n = String(s); b.title = s + (s === 1 ? ' star' : ' stars');
        if (s === 1) b.classList.add('face');
        b.addEventListener('mouseenter', () => paintStars(stars, s));
        b.addEventListener('click', (e) => { e.stopPropagation(); setStars(it, (it.stars || 0) === s ? 0 : s); });
        stars.appendChild(b);
      }
      paintStars(stars, it.stars || 0);
      stars.addEventListener('mouseleave', () => paintStars(stars, it.stars || 0));
      heart.addEventListener('click', (e) => { e.stopPropagation(); setLike(it, !it.like); });
      tools.append(heart, stars);
      card.append(media, meta, bar, paused, tools);
      if (it.kind === 'video') {
        media.addEventListener('timeupdate', () => { if (media.duration) bar.firstChild.style.width = (media.currentTime / media.duration * 100) + '%'; });
        media.addEventListener('loadedmetadata', () => {
          if (!card.dataset.timed) { card.dataset.timed = '1'; sub.appendChild(document.createTextNode(' · ' + fmtTime(media.duration))); }
          if (!it.duration && isFinite(media.duration)) it.duration = media.duration;
        });
        media.addEventListener('ended', () => { if (auto && +card.dataset.i === current) next(); });
        media.addEventListener('error', () => { if (media.getAttribute('src')) sub.appendChild(document.createTextNode(" · this one won't play in this browser")); });
        bar.addEventListener('click', (e) => { e.stopPropagation(); const r = bar.getBoundingClientRect(); if (media.duration) media.currentTime = (e.clientX - r.left) / r.width * media.duration; });
      } else {
        media.addEventListener('error', () => { if (media.getAttribute('src')) sub.appendChild(document.createTextNode(" · this one won't open in this browser")); });
      }
      card.addEventListener('click', (e) => { if (e.target.closest('button')) return; toggle(card); });
      feed.appendChild(card); cards.push(card);
    });
    if (!list.length) feed.innerHTML = '<div class="empty">Nothing to show.</div>';
    feed.scrollTop = 0;
    cards.forEach((c) => io.observe(c));
  }

  function load(card, preload) {
    const m = card.firstChild, it = card.item;
    if (m.getAttribute('src')) return;
    m.src = srcOf(it);
    if (it.kind === 'video') m.preload = preload;
  }
  function unload(card) {
    const m = card.firstChild;
    if (!m.getAttribute('src')) return;
    if (card.item.kind === 'video') { m.pause(); m.removeAttribute('src'); m.load(); m.preload = 'none'; card.querySelector('.bar i').style.width = 0; }
    else m.removeAttribute('src');
    release(card.item);
  }
  function playCard(card) {
    const m = card.firstChild;
    card.classList.remove('is-paused');
    if (card.item.kind === 'video') { m.muted = muted; m.play().catch(() => {}); }
    armPhotoTimer();
  }
  function toggle(card) {
    const m = card.firstChild;
    if (card.item.kind === 'photo') {
      const p = !card.classList.contains('is-paused');
      card.classList.toggle('is-paused', p);
      m.style.animationPlayState = p ? 'paused' : 'running';
      if (p) clearTimeout(photoTimer); else armPhotoTimer();
      return;
    }
    if (m.paused) { m.play().catch(() => {}); card.classList.remove('is-paused'); }
    else { m.pause(); card.classList.add('is-paused'); }
  }
  // A photo on screen with auto on: a timed bar, then the next one.
  function armPhotoTimer() {
    clearTimeout(photoTimer);
    const card = cards[current];
    if (!card || card.item.kind !== 'photo' || view !== 'feed') return;
    const bar = card.querySelector('.bar i');
    bar.style.transition = 'none'; bar.style.width = '0';
    if (!auto || card.classList.contains('is-paused')) return;
    requestAnimationFrame(() => { bar.style.transition = `width ${PHOTO_SECONDS}s linear`; bar.style.width = '100%'; });
    photoTimer = setTimeout(() => { if (auto && cards[current] === card) next(); }, PHOTO_SECONDS * 1000);
  }

  // The card filling the screen plays; its neighbours get ready; anything further away lets go of its file.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const card = en.target, i = +card.dataset.i;
      if (en.intersectionRatio >= 0.6) {
        current = i;
        load(card, 'auto');
        if (view === 'feed') playCard(card);
        [i - 1, i + 1].forEach((j) => { if (cards[j]) load(cards[j], 'metadata'); });
      } else {
        const m = card.firstChild;
        if (card.item.kind === 'video' && !m.paused) m.pause();
        if (Math.abs(i - current) > 2) unload(card);
      }
    }
  }, { root: feed, threshold: [0.6] });

  function go(d) { const n = cards[Math.min(cards.length - 1, Math.max(0, (current < 0 ? 0 : current) + d))]; if (n) n.scrollIntoView({ behavior: 'smooth' }); }
  function next() { if (current >= cards.length - 1) feed.scrollTo({ top: 0, behavior: 'smooth' }); else go(1); }

  function paintStars(box, n) { box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', n > 0 && (+b.dataset.n) <= n)); }
  function saveRate(it) {
    rates[rateKey(it)] = { like: !!it.like, stars: it.stars || 0 };
    store.set('rates', rates);
    const card = cards.find((c) => c.item === it);
    if (card) {
      const h = card.querySelector('.heart');
      h.classList.toggle('on', !!it.like);
      if (it.like) { h.classList.remove('pop'); void h.offsetWidth; h.classList.add('pop'); }
      paintStars(card.querySelector('.stars'), it.stars || 0);
    }
  }
  function setLike(it, on) { it.like = on; saveRate(it); toast(on ? 'Liked' : 'Like removed'); }
  function setStars(it, n) { it.stars = n; saveRate(it); toast(n ? '★'.repeat(n) : 'Rating cleared'); }
  const currentItem = () => (cards[current] ? cards[current].item : null);

  // ---- Live TV ---------------------------------------------------------------------------------------------------
  const EPOCH = Date.UTC(2026, 0, 1);  // the day the channels "went on air"; the schedule is fixed from it
  const UNKNOWN = 10 * 60;             // a guess for a video whose length isn't known yet (seconds)
  const tv = $('tv'), tvPhoto = $('tvPhoto'), screen = $('screen'), stat = $('static');
  let channels = [], cur = store.get('chan', 0), nowItem = null, hudTimer = 0, tickTimer = 0, learning = false;

  const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const mins = (s) => { s = Math.max(0, Math.round(s)); if (s < 60) return `${s} s`; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
  const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dur = (it) => it.kind === 'photo' ? TV_PHOTO_SECONDS : (it.duration || UNKNOWN);

  // One channel per subfolder, plus Everything. Each runs in an order shuffled from its own name, so it is the same
  // tomorrow and on any device, and the clock decides what's on.
  function makeChannels() {
    const by = new Map();
    for (const it of items) { const k = it.channel || 'Loose files'; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const list = [{ name: 'Everything', items: order('Everything', items) }];
    if (by.size > 1) for (const name of [...by.keys()].sort((a, b) => a.localeCompare(b))) list.push({ name, items: order(name, by.get(name)) });
    list.forEach(retotal);
    return list;
  }
  function order(name, list) {
    const a = list.slice().sort((x, y) => x.rel.localeCompare(y.rel));
    const r = rng(hash(name));
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function retotal(c) { c.total = c.items.reduce((s, it) => s + dur(it), 0); }
  function onAir(c, t) {
    if (!c.items.length || !c.total) return null;
    let pos = ((t - EPOCH) / 1000) % c.total;
    if (pos < 0) pos += c.total;
    let acc = 0;
    for (let i = 0; i < c.items.length; i++) {
      const d = dur(c.items[i]);
      if (pos < acc + d) return { it: c.items[i], i, offset: pos - acc, started: t - (pos - acc) * 1000, ends: t + (acc + d - pos) * 1000 };
      acc += d;
    }
    return null;
  }

  function enterTv() {
    paintToggles();
    if (!channels.length) channels = makeChannels();
    nowItem = null;
    tune(Math.min(cur, channels.length - 1), false);
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 2000);
    learnNext();
  }
  function stopTv() {
    clearInterval(tickTimer);
    tv.pause(); tv.removeAttribute('src'); tv.load();
    tvPhoto.removeAttribute('src');
    if (nowItem) release(nowItem.it);
    nowItem = null;
    $('guide').classList.remove('on');
  }
  function tune(idx, announce = true) {
    if (!channels.length) return;
    cur = (idx + channels.length) % channels.length;
    store.set('chan', cur);
    const c = channels[cur];
    $('chanNum').textContent = String(cur + 1).padStart(2, '0');
    $('chanName').textContent = c.name;
    if (announce) snow();
    play(onAir(c, Date.now()), true);
    showHud();
    if ($('guide').classList.contains('on')) renderGuide();
  }
  function play(item, fresh) {
    if (!item) { tv.removeAttribute('src'); tv.load(); $('title').textContent = 'Nothing on this channel.'; return; }
    const same = nowItem && nowItem.it === item.it;
    if (!same && nowItem) release(nowItem.it);
    nowItem = item;
    if (item.it.kind === 'photo') {
      screen.classList.add('photo');
      tv.pause(); tv.removeAttribute('src');
      if (!same || fresh) tvPhoto.src = srcOf(item.it);
    } else {
      screen.classList.remove('photo');
      tvPhoto.removeAttribute('src');
      const seekTo = () => { if (tv.duration && item.offset < tv.duration - 1) tv.currentTime = item.offset; tv.play().catch(() => {}); };
      if (!same || fresh) {
        tv.src = srcOf(item.it);
        tv.muted = muted;
        tv.onloadedmetadata = () => { if (!item.it.duration && isFinite(tv.duration) && tv.duration > 0) learn(item.it, tv.duration); seekTo(); };
        tv.load();
      } else seekTo();
    }
    describe();
  }
  function describe() {
    if (!nowItem) return;
    const c = channels[cur], item = nowItem, t = Date.now();
    $('title').textContent = item.it.name;
    const ago = (t - item.started) / 1000;
    // A short clip starts and ends inside the same minute, so it only says how long is left.
    const when = dur(item.it) >= 90 ? `${clock(item.started)} to ${clock(item.ends)} · ` : '';
    $('sub').textContent = `${item.it.kind === 'photo' ? 'Photo · ' : ''}${when}${mins((item.ends - t) / 1000)} left` + (item.it.kind === 'video' && !item.it.duration ? ' (still learning its length)' : '');
    const nx = c.items[(item.i + 1) % c.items.length];
    $('next').textContent = c.items.length > 1 ? `Next: ${nx.name} at ${clock(item.ends)}` : '';
    document.querySelector('#prog i').style.width = (Math.min(1, ago / dur(item.it)) * 100) + '%';
  }
  // The schedule belongs to the clock: every couple of seconds the picture is checked against it.
  function tick() {
    if (view !== 'tv' || !channels.length) return;
    const item = onAir(channels[cur], Date.now());
    if (!item) return;
    if (!nowItem || item.it !== nowItem.it) play(item, true);
    else {
      nowItem = item;
      if (item.it.kind === 'video') {
        if (tv.readyState >= 1 && tv.duration && Math.abs(tv.currentTime - item.offset) > 4 && item.offset < tv.duration - 1) tv.currentTime = item.offset;
        if (tv.paused && document.visibilityState === 'visible') tv.play().catch(() => {});
      }
      describe();
    }
  }
  tv.addEventListener('ended', tick);
  tv.addEventListener('error', () => { if (nowItem && tv.getAttribute('src')) $('sub').textContent = "This one won't play in this browser. The channel moves on at " + clock(nowItem.ends); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  // Video lengths aren't in the file list: read each one's header quietly, one at a time, and firm up the schedule.
  function learn(it, d) { it.duration = d; channels.forEach(retotal); }
  function learnNext() {
    if (learning || view !== 'tv') return;
    const it = items.find((x) => x.kind === 'video' && !x.duration && !x._tried);
    if (!it) return;
    learning = true; it._tried = true;
    const probe = document.createElement('video');
    probe.preload = 'metadata'; probe.muted = true;
    const url = it.url || URL.createObjectURL(it.file);
    probe.src = url;
    const done = () => { probe.removeAttribute('src'); probe.load(); if (!it.url) URL.revokeObjectURL(url); learning = false; setTimeout(learnNext, 150); };
    probe.onloadedmetadata = () => { if (isFinite(probe.duration) && probe.duration > 0) learn(it, probe.duration); done(); };
    probe.onerror = done;
  }

  function snow() {
    const ctx = stat.getContext('2d');
    stat.width = 160; stat.height = 90;
    const img = ctx.createImageData(160, 90);
    for (let i = 0; i < img.data.length; i += 4) { const g = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    stat.classList.add('on');
    setTimeout(() => stat.classList.remove('on'), 170);
  }
  const HUD = ['chan', 'now', 'prog', 'tvRail', 'tvTop'];
  function showHud() {
    HUD.forEach((id) => $(id).classList.remove('hide'));
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => { if (!$('guide').classList.contains('on')) HUD.forEach((id) => $(id).classList.add('hide')); }, 3500);
  }
  function renderGuide() {
    const rows = $('rows');
    rows.innerHTML = '';
    const t = Date.now();
    channels.forEach((c, i) => {
      const it = onAir(c, t);
      const row = document.createElement('div');
      row.className = 'row' + (i === cur ? ' cur' : '');
      row.innerHTML = '<div class="num"></div><div><div class="nm"></div><div class="on"></div></div>';
      row.querySelector('.num').textContent = String(i + 1).padStart(2, '0');
      row.querySelector('.nm').innerHTML = '<span></span> <small></small>';
      row.querySelector('.nm span').textContent = c.name;
      row.querySelector('.nm small').textContent = `${c.items.length} item${c.items.length === 1 ? '' : 's'} · ${mins(c.total)} loop`;
      const on = row.querySelector('.on');
      if (it) {
        on.innerHTML = 'Now: <b></b> · <span class="left"></span> left · then <span class="then"></span>';
        on.querySelector('b').textContent = it.it.name;
        on.querySelector('.left').textContent = mins((it.ends - t) / 1000);
        on.querySelector('.then').textContent = c.items[(it.i + 1) % c.items.length].name;
      } else on.textContent = 'Nothing on';
      row.onclick = () => { $('guide').classList.remove('on'); tune(i); };
      rows.appendChild(row);
    });
  }
  function toggleGuide() { const g = $('guide'); g.classList.toggle('on'); if (g.classList.contains('on')) renderGuide(); showHud(); }
  $('zoneUp').onclick = () => tune(cur + 1);
  $('zoneDown').onclick = () => tune(cur - 1);
  $('screen').addEventListener('click', showHud);
  $('tvView').addEventListener('mousemove', showHud);
  let touchY = null;
  $('tvView').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  $('tvView').addEventListener('touchend', (e) => {
    if (touchY == null || $('guide').classList.contains('on')) return;
    const dy = e.changedTouches[0].clientY - touchY; touchY = null;
    if (dy < -60) tune(cur + 1); else if (dy > 60) tune(cur - 1); else showHud();
  }, { passive: true });

  // ---- keys ------------------------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '?' || (k === '/' && e.shiftKey)) { help(); return; }
    if (k === 'Escape') {
      if ($('help').classList.contains('on')) help(false);
      else if ($('coach').classList.contains('on')) { $('coach').classList.remove('on'); store.set('coached', true); }
      else if ($('guide').classList.contains('on')) $('guide').classList.remove('on');
      else if (view !== 'welcome') show('welcome');
      return;
    }
    if ($('coach').classList.contains('on')) { $('coach').classList.remove('on'); store.set('coached', true); }
    if (view === 'feed') {
      switch (k) {
        case 'ArrowDown': case 'j': case 'PageDown': e.preventDefault(); go(1); break;
        case 'ArrowUp': case 'k': case 'PageUp': e.preventDefault(); go(-1); break;
        case ' ': e.preventDefault(); if (cards[current]) toggle(cards[current]); break;
        case 'm': setMute(!muted); break;
        case 'f': setFill(!fill); break;
        case 'a': setAuto(!auto); break;
        case 's': setSort('shuffle'); break;
        case 'r': setSort(sortMode === 'rated' ? 'new' : 'rated'); break;
        case 'l': { const it = currentItem(); if (it) setLike(it, !it.like); break; }
        case '1': case '2': case '3': case '4': case '5': { const it = currentItem(); if (it) setStars(it, (it.stars || 0) === +k ? 0 : +k); break; }
        case 't': show('tv'); break;
        case 'ArrowRight': { const m = cards[current] && cards[current].firstChild; if (m && m.tagName === 'VIDEO') m.currentTime += 5; break; }
        case 'ArrowLeft': { const m = cards[current] && cards[current].firstChild; if (m && m.tagName === 'VIDEO') m.currentTime -= 5; break; }
      }
    } else if (view === 'tv') {
      switch (k) {
        case 'ArrowUp': case 'PageUp': case 'k': e.preventDefault(); tune(cur + 1); break;
        case 'ArrowDown': case 'PageDown': case 'j': e.preventDefault(); tune(cur - 1); break;
        case 'm': setMute(!muted); break;
        case 'f': setFill(!fill); break;
        case 'g': toggleGuide(); break;
        case 't': show('feed'); break;
        default: if (k >= '1' && k <= '9' && +k <= channels.length) tune(+k - 1);
      }
    }
  });

  setAuto(auto, true);
  paintToggles();
  if (!(window.SCROLLER_SAMPLES || []).length) $('trySamples').classList.add('hidden');
})();
