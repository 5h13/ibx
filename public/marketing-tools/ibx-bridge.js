// Build 122 — connects the owner's marketing tools to the app: the store logos come from the app's store settings
// (Admin → Businesses → Branding), sent as images the tools can put into PNG / GIF exports.
// A store with no logo in the app keeps the tool's own logo. Nothing else in the tools is changed.
(function () {
  var me = document.currentScript;
  var tool = me && me.getAttribute('data-tool');
  var appSrc = me && me.getAttribute('data-app');
  function brands() {
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, 5000); });
    var req = fetch('/api/marketing/brands', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.race([req, timeout]).then(function (d) { return (d && d.brands) || []; });
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
        var on = document.querySelector('.theme-button[aria-pressed="true"]');
        if (on && typeof applyTheme === 'function') applyTheme(on.dataset.theme);
      } catch (e) { /* keep the tool's own logo */ }
    });
  }
})();
