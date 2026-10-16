// Build 122 — connects the owner's marketing tools to the app: the store logos come from the app's store settings
// (Admin → Businesses → Branding), sent as images the tools can put into PNG / GIF exports.
// A store with no logo in the app keeps the tool's own logo.
// Build 123: the store is the one the user is acting as in the app; the tools' own store / theme pickers are hidden.
(function () {
  var me = document.currentScript;
  var tool = me && me.getAttribute('data-tool');
  var appSrc = me && me.getAttribute('data-app');
  function brands() {
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, 5000); });
    var req = fetch('/api/marketing/brands', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.race([req, timeout]).then(function (d) { window.__IBX_STORE = (d && d.current) || null; return (d && d.brands) || []; });
  }
  if (tool === 'banner-studio') {
    // the logos must be known before the studio starts
    brands().then(function (list) {
      var logos = {};
      list.forEach(function (b) { if (b.logo) logos[b.code] = b.logo; });
      window.__IBX_LOGOS = logos;
    }).finally(function () {
      var s = document.createElement('script'); s.src = appSrc; document.body.appendChild(s);
    });
  } else if (tool === 'specs-card') {
    brands().then(function (list) {
      try {
        list.forEach(function (b) { var k = String(b.code || '').toLowerCase(); if (b.logo && k in themeLogos) themeLogos[k] = b.logo; });
        var store = String(window.__IBX_STORE || '').toLowerCase();
        var mine = store && document.querySelector('.theme-button[data-theme="' + store + '"]');
        if (mine) {
          mine.click();                                   // the tool's own theme switch, for the store acting as
          var opts = document.getElementById('themeOptions'); if (opts) opts.style.display = 'none';
          var tg = document.getElementById('themeToggle'); if (tg) tg.style.display = 'none';   // no store choice in the tool
        } else {
          var on = document.querySelector('.theme-button[aria-pressed="true"]');
          if (on && typeof applyTheme === 'function') applyTheme(on.dataset.theme);
        }
      } catch (e) { /* keep the tool's own logo */ }
    });
  }
})();

// ------------------------------------------------------------------------------------------ Build 124 --
// "From catalog": search the app's catalog, then add the item's photos (up to 3) to the tool's own photo list —
// exactly as if uploaded, so rotate / zoom / reorder / remove still work — and / or fill the product texts.
// Uploading your own photos stays. Nothing is written back to the catalog; every filled text stays editable.
(function () {
  var me = document.querySelector('script[src$="ibx-bridge.js"]');
  var tool = me && me.getAttribute('data-tool');
  if (tool !== 'specs-card' && tool !== 'banner-studio') return;
  var css = document.createElement('style');
  css.textContent = [
    '.ibx-cat-btn{position:fixed;right:14px;bottom:14px;z-index:9998;border:0;border-radius:999px;padding:9px 15px;font:600 13px/1 Inter,system-ui,sans-serif;background:#0f766e;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}',
    '.ibx-cat-btn:hover{background:#115e59}',
    '.ibx-cat{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.45);display:flex;align-items:flex-start;justify-content:center;padding:40px 12px;font:13px/1.4 Inter,system-ui,sans-serif;color:#0f172a}',
    '.ibx-cat-box{width:min(560px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}',
    '.ibx-cat-head{display:flex;gap:8px;align-items:center;padding:12px;border-bottom:1px solid #e2e8f0}',
    '.ibx-cat-head input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font:inherit}',
    '.ibx-cat-x{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 10px;cursor:pointer}',
    '.ibx-cat-list{overflow:auto;padding:4px 0}',
    '.ibx-cat-row{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 14px;cursor:pointer;font:inherit;color:inherit}',
    '.ibx-cat-row:hover{background:#f1f5f9}.ibx-cat-row small{color:#64748b;display:block}',
    '.ibx-cat-pick{padding:12px 14px;overflow:auto}.ibx-cat-pick h3{margin:0 0 2px;font-size:15px}',
    '.ibx-cat-photos{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}.ibx-cat-photos img{width:96px;height:96px;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}',
    '.ibx-cat-pick label{display:flex;gap:8px;align-items:center;margin:6px 0}',
    '.ibx-cat-go{margin-top:10px;border:0;border-radius:8px;padding:9px 14px;background:#0f766e;color:#fff;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}',
    '.ibx-cat-go:disabled{opacity:.5}.ibx-cat-note{color:#64748b;font-size:12px;padding:8px 14px}.ibx-cat-msg{font-size:12px;margin-top:8px;color:#0f766e}'
  ].join('');
  document.head.appendChild(css);

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var get = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not reach the catalog.'); return j; }); }); };

  function putFiles(input, files) {   // hand files to the tool's own upload box, as if chosen there
    var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function photoInput() {
    if (tool === 'specs-card') return document.getElementById('photoInput');
    var all = [].slice.call(document.querySelectorAll('input[type=file]'));
    return all.filter(function (i) { return i.multiple; })[0] || all[0];
  }
  function specEntries(text) {   // the Specs Card's own "Label: Value" reading, line by line; other lines are skipped
    var ok = [], skipped = 0;
    String(text || '').split(/\r?\n|;/).map(function (l) { return l.trim(); }).filter(Boolean).forEach(function (l) {
      var r = typeof parseSpecIntake === 'function' ? parseSpecIntake(l) : { entries: [], errorLine: 1 };
      if (!r.errorLine && r.entries.length) ok.push(r.entries[0]); else skipped++;
    });
    return { ok: ok, skipped: skipped };
  }
  function fillSpecs(it) {
    var notes = [];
    var title = document.getElementById('modelName'); if (title && it.name) title.textContent = it.name;
    var feat = document.querySelector('#cardFooter [contenteditable]'); if (feat && it.description) feat.textContent = it.description;
    var sp = specEntries(it.specification);
    if (sp.ok.length && typeof createSpecRow === 'function') {
      var oldRows = [].slice.call(specList.querySelectorAll('.spec-row'));
      var newRows = sp.ok.map(function (e) { return createSpecRow(e.label, e.value); });
      deletedSpecRows.push({ type: 'replace', oldRows: oldRows.map(function (row, index) { return { row: row, index: index }; }), newRows: newRows });
      oldRows.forEach(function (r) { r.remove(); }); newRows.forEach(function (r) { specList.append(r); });
      var undo = document.getElementById('undoDeleteSpec'); if (undo) undo.disabled = false;   // the tool's Undo brings the old rows back
      var on = document.querySelector('.theme-button[aria-pressed="true"]'); if (on) applyTheme(on.dataset.theme);
      updateSpecLayout();
      notes.push(sp.ok.length + ' specification row' + (sp.ok.length === 1 ? '' : 's'));
    }
    if (sp.skipped) notes.push(sp.skipped + ' specification line' + (sp.skipped === 1 ? ' was' : 's were') + ' left out (not in "Label: Value" form)');
    if (!it.specification) notes.push('no specification in the catalog');
    return notes;
  }
  function fillBanner(it) {
    if (typeof window.__ibxFill !== 'function') return ['the studio is still starting — try again'];
    var up = function (s) { return String(s || '').toUpperCase(); };
    var details = [it.brand, it.generic].filter(Boolean).join(' · ');
    var firstSpec = String(it.specification || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)[0];
    var d = { rightLine1: up(it.name), rightLine2: up(details || it.category), rightLine3: up(it.code || firstSpec) };
    if (it.category) d.info1Category = up(it.category);
    if (it.description) { d.info1Feature = it.description; d.info2Feature = it.description; }
    window.__ibxFill(d);
    return ['product texts'];
  }

  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ibx-cat-btn'; btn.textContent = '＋ From catalog';
  btn.title = 'Add photos and product texts from the catalog';
  document.body.appendChild(btn);

  var wrap = null, timer = null;
  function close() { if (wrap) { wrap.remove(); wrap = null; } }
  function open() {
    close();
    wrap = document.createElement('div'); wrap.className = 'ibx-cat';
    wrap.innerHTML = '<div class="ibx-cat-box"><div class="ibx-cat-head"><input placeholder="Search the catalog — e.g. blower innova" autofocus><button type="button" class="ibx-cat-x">Close</button></div>' +
      '<div class="ibx-cat-list"><div class="ibx-cat-note">Type part of the name, code or brand.</div></div></div>';
    document.body.appendChild(wrap);
    var input = wrap.querySelector('input'), list = wrap.querySelector('.ibx-cat-list');
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('.ibx-cat-x').onclick = close;
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { list.innerHTML = '<div class="ibx-cat-note">Type part of the name, code or brand.</div>'; return; }
      timer = setTimeout(function () {
        list.innerHTML = '<div class="ibx-cat-note">Searching…</div>';
        get('/api/marketing/catalog/search?q=' + encodeURIComponent(q)).then(function (d) {
          if (!d.items.length) { list.innerHTML = '<div class="ibx-cat-note">No catalog item matches.</div>'; return; }
          list.innerHTML = d.items.map(function (it) {
            return '<button type="button" class="ibx-cat-row" data-id="' + esc(it.id) + '"><b>' + esc(it.name) + '</b><small>' + esc([it.code, it.brand, it.category].filter(Boolean).join(' · ')) + ' · ' + it.photos + ' photo' + (it.photos === 1 ? '' : 's') + '</small></button>';
          }).join('');
          [].forEach.call(list.querySelectorAll('.ibx-cat-row'), function (b) { b.onclick = function () { pick(b.getAttribute('data-id'), list); }; });
        }).catch(function (e) { list.innerHTML = '<div class="ibx-cat-note">' + esc(e.message) + '</div>'; });
      }, 250);
    });
    input.focus();
  }
  function pick(id, list) {
    list.innerHTML = '<div class="ibx-cat-note">Opening…</div>';
    get('/api/marketing/catalog/item?id=' + encodeURIComponent(id)).then(function (it) {
      list.innerHTML = '<div class="ibx-cat-pick"><h3>' + esc(it.name) + '</h3><small>' + esc([it.code, it.brand, it.category].filter(Boolean).join(' · ')) + '</small>' +
        '<div class="ibx-cat-photos">' + (it.photos.length ? it.photos.map(function (u) { return '<img src="' + esc(u) + '" alt="">'; }).join('') : '<span class="ibx-cat-note" style="padding:0">No photos in the catalog for this item.</span>') + '</div>' +
        '<label><input type="checkbox" class="ibx-p"' + (it.photos.length ? ' checked' : ' disabled') + '> Add ' + (it.photos.length || 'no') + ' photo' + (it.photos.length === 1 ? '' : 's') + '</label>' +
        '<label><input type="checkbox" class="ibx-t" checked> Fill the product texts' + (tool === 'specs-card' ? ' (title, key features, specifications)' : ' (product name, details, model, category, features)') + '</label>' +
        '<button type="button" class="ibx-cat-go">Add to the ' + (tool === 'specs-card' ? 'card' : 'banner') + '</button> <button type="button" class="ibx-cat-x ibx-back">Back to results</button><div class="ibx-cat-msg"></div></div>';
      list.querySelector('.ibx-back').onclick = function () { var i = wrap.querySelector('input'); i.dispatchEvent(new Event('input')); };
      var go = list.querySelector('.ibx-cat-go'), msg = list.querySelector('.ibx-cat-msg');
      go.onclick = function () {
        var wantP = list.querySelector('.ibx-p').checked, wantT = list.querySelector('.ibx-t').checked;
        if (!wantP && !wantT) { msg.textContent = 'Tick photos, texts or both.'; return; }
        go.disabled = true; msg.textContent = 'Adding…';
        var done = [];
        var photos = !wantP ? Promise.resolve() : Promise.all(it.photos.map(function (u, i) {
          return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('A photo could not be loaded.'); return r.blob(); })
            .then(function (b) { return new File([b], (it.code || 'item') + (i ? '_' + (i + 1) : '') + '.' + ((b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')), { type: b.type || 'image/jpeg' }); });
        })).then(function (files) { var inp = photoInput(); if (!inp) throw new Error('The tool\'s photo upload was not found.'); putFiles(inp, files); done.push(files.length + ' photo' + (files.length === 1 ? '' : 's')); });
        photos.then(function () {
          if (wantT) done = done.concat(tool === 'specs-card' ? fillSpecs(it) : fillBanner(it));
          msg.textContent = 'Added: ' + done.join('; ') + '.';
          setTimeout(close, 1400);
        }).catch(function (e) { msg.textContent = e.message; go.disabled = false; });
      };
    }).catch(function (e) { list.innerHTML = '<div class="ibx-cat-note">' + esc(e.message) + '</div>'; });
  }
  btn.onclick = open;
})();
