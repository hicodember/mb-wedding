/* Live backend for the wedding app: Supabase database + storage.
   Loads after config.js and supabase-js. Exposes window.LIVE for the app. */
(function () {
  var C = window.CFG || {};
  if (!C.supabaseUrl || !C.supabaseAnonKey || !window.supabase) { window.LIVE = null; return; }

  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: false } });
  var MEDIA = 'media', WISHES = 'wishes';
  var MAX_VIDEO_SECONDS = 61, MAX_EDGE = 2400, THUMB_EDGE = 640;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function getDevice() {
    var id = null;
    try { id = localStorage.getItem('deviceId'); } catch (e) {}
    if (!id) { id = uuid(); try { localStorage.setItem('deviceId', id); } catch (e) {} }
    return id;
  }
  function guestName() { try { return localStorage.getItem('guestName') || ''; } catch (e) { return ''; } }
  function publicUrl(path) { return path ? sb.storage.from(MEDIA).getPublicUrl(path).data.publicUrl : ''; }

  var settings = { unlock_at: null, quiz_reveal_at: null, offset: 0 };
  function serverNow() { return Date.now() + settings.offset; }

  var LIVE = {
    sb: sb,
    device: getDevice(),
    ready: sb.rpc('public_settings').then(function (r) {
      if (r.error) throw r.error;
      var s = r.data || {};
      settings.unlock_at = s.unlock_at ? Date.parse(s.unlock_at) : null;
      settings.quiz_reveal_at = s.quiz_reveal_at ? Date.parse(s.quiz_reveal_at) : null;
      if (s.now) settings.offset = Date.parse(s.now) - Date.now();
      return settings;
    }).catch(function (e) { console.warn('settings', e); return settings; }),
    unlocked: function () { return settings.unlock_at !== null && serverNow() >= settings.unlock_at; },
    quizRevealed: function () { return settings.quiz_reveal_at !== null && serverNow() >= settings.quiz_reveal_at; },
    now: serverNow,
    publicUrl: publicUrl
  };

  // ---------- current moment of the day ----------
  LIVE.momentIndex = function () {
    var ms = C.moments || [], t = serverNow(), idx = 0;
    for (var i = 0; i < ms.length; i++) { if (ms[i].start && t >= Date.parse(ms[i].start)) idx = i; }
    return idx;
  };
  LIVE.momentName = function () { var ms = C.moments || []; return ms.length ? ms[LIVE.momentIndex()].name : ''; };

  // ---------- media helpers ----------
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  function toJpeg(source, w, h, edge, quality) {
    var s = Math.min(1, edge / Math.max(w, h)), cw = Math.round(w * s), ch = Math.round(h * s);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(source, 0, 0, cw, ch);
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', quality); });
  }
  async function preparePhoto(file) {
    try {
      var l = await loadImage(file);
      var full = await toJpeg(l.img, l.img.naturalWidth, l.img.naturalHeight, MAX_EDGE, 0.86);
      var thumb = await toJpeg(l.img, l.img.naturalWidth, l.img.naturalHeight, THUMB_EDGE, 0.78);
      URL.revokeObjectURL(l.url);
      return { full: full, thumb: thumb, type: 'image/jpeg', ext: 'jpg' };
    } catch (e) {
      return { full: file, thumb: null, type: file.type || 'image/jpeg', ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
    }
  }
  function videoInfo(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), v = document.createElement('video');
      var done = function (out) { URL.revokeObjectURL(url); res(out); };
      v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      v.onloadedmetadata = function () {
        var dur = v.duration;
        v.currentTime = Math.min(0.5, (dur || 1) / 2);
        v.onseeked = function () {
          toJpeg(v, v.videoWidth || 640, v.videoHeight || 360, THUMB_EDGE, 0.78).then(function (b) { done({ duration: dur, thumb: b }); }, function () { done({ duration: dur, thumb: null }); });
        };
        setTimeout(function () { done({ duration: dur, thumb: null }); }, 4000);
      };
      v.onerror = function () { done({ duration: 0, thumb: null }); };
      v.src = url;
    });
  }
  function extOf(file, fallback) { var m = /\.([a-z0-9]+)$/i.exec(file.name || ''); return m ? m[1].toLowerCase() : fallback; }
  function videoType(file) { return file.type || (extOf(file, 'mp4') === 'mov' ? 'video/quicktime' : 'video/mp4'); }

  // Resumable upload (good for videos on weak venue signal)
  function tusUpload(bucket, path, blob, type, onProgress) {
    return new Promise(function (res, rej) {
      if (!window.tus) { sb.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false }).then(function (r) { r.error ? rej(r.error) : res(); }); return; }
      var up = new tus.Upload(blob, {
        endpoint: C.supabaseUrl + '/storage/v1/upload/resumable',
        retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
        headers: { authorization: 'Bearer ' + C.supabaseAnonKey, apikey: C.supabaseAnonKey, 'x-upsert': 'false' },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: bucket, objectName: path, contentType: type, cacheControl: '31536000' },
        chunkSize: 6 * 1024 * 1024,
        onError: rej,
        onProgress: function (a, b) { onProgress && onProgress(a / b); },
        onSuccess: function () { res(); }
      });
      up.findPreviousUploads().then(function (prev) { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); });
    });
  }
  function simpleUpload(bucket, path, blob, type) {
    return sb.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false, cacheControl: '31536000' }).then(function (r) { if (r.error) throw r.error; });
  }

  // ---------- progress pill ----------
  var pill;
  function progress(text, frac) {
    if (!pill) {
      pill = document.createElement('div');
      pill.setAttribute('role', 'status');
      pill.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:80;background:#3B2A1E;color:#fff;border-radius:22px;padding:10px 16px;font:600 14px "Josefin Sans",sans-serif;box-shadow:0 10px 24px rgba(59,42,30,.3);min-width:220px;text-align:center;overflow:hidden';
      document.body.appendChild(pill);
    }
    if (text === null) { pill.style.display = 'none'; return; }
    pill.style.display = 'block';
    pill.innerHTML = '<div style="position:relative;z-index:1"></div><div style="position:absolute;left:0;top:0;bottom:0;background:#B4532A;opacity:.85;transition:width .3s ease;width:' + Math.round((frac || 0) * 100) + '%"></div>';
    pill.firstChild.textContent = text;
  }
  LIVE.progress = progress;

  // ---------- gallery uploads ----------
  LIVE.uploadFiles = async function (files, opts) {
    opts = opts || {};
    files = Array.prototype.slice.call(files || []);
    var done = 0, ok = [], skipped = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], label = files.length > 1 ? ' ' + (i + 1) + ' of ' + files.length : '';
      var isVideo = /^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name || '');
      try {
        var id = uuid(), day = new Date(serverNow()).toISOString().slice(0, 10), base = day + '/' + id;
        var row = { guest_name: guestName(), device_id: LIVE.device, moment: LIVE.momentName(), mission: (opts.mission === undefined ? null : opts.mission) };
        if (isVideo) {
          var info = await videoInfo(f);
          if (info.duration && info.duration > MAX_VIDEO_SECONDS) { skipped++; continue; }
          var ext = extOf(f, 'mp4'), type = videoType(f);
          progress('Uploading video' + label + '...', 0);
          await tusUpload(MEDIA, base + '.' + ext, f, type, function (p) { progress('Uploading video' + label + '... ' + Math.round(p * 100) + '%', p); });
          if (info.thumb) await simpleUpload(MEDIA, base + '_t.jpg', info.thumb, 'image/jpeg');
          row.path = base + '.' + ext; row.thumb_path = info.thumb ? base + '_t.jpg' : null; row.kind = 'video';
        } else {
          progress('Uploading photo' + label + '...', 0.1);
          var ph = await preparePhoto(f);
          await tusUpload(MEDIA, base + '.' + ph.ext, ph.full, ph.type, function (p) { progress('Uploading photo' + label + '... ' + Math.round(p * 100) + '%', p); });
          if (ph.thumb) await simpleUpload(MEDIA, base + '_t.jpg', ph.thumb, 'image/jpeg');
          row.path = base + '.' + ph.ext; row.thumb_path = ph.thumb ? base + '_t.jpg' : null; row.kind = 'photo';
        }
        var ins = await sb.from('uploads').insert(row);
        if (ins.error) throw ins.error;
        done++; ok.push(publicUrl(row.thumb_path || row.path));
      } catch (e) {
        console.error('upload failed', e);
      }
    }
    progress(null);
    return { done: done, failed: files.length - done - skipped, skipped: skipped, thumbs: ok };
  };

  LIVE.gallery = async function () {
    var r = await sb.from('uploads').select('id,path,thumb_path,kind,guest_name,moment,created_at').order('created_at', { ascending: false }).limit(1000);
    if (r.error) throw r.error;
    var h = await sb.rpc('heart_counts');
    var hearts = (h && h.data) || {};
    return (r.data || []).map(function (u) {
      return { id: u.id, kind: u.kind, url: publicUrl(u.path), thumb: publicUrl(u.thumb_path || u.path), who: u.guest_name || 'A guest', moment: u.moment, hearts: hearts[u.id] || 0, at: u.created_at };
    });
  };
  LIVE.heart = function (uploadId) { return sb.from('hearts').insert({ upload_id: uploadId, device_id: LIVE.device }); };

  // ---------- RSVP ----------
  LIVE.findInvitation = async function (q) {
    var r = await sb.rpc('find_invitation', { q: q });
    if (r.error) throw r.error;
    return r.data || [];
  };
  LIVE.submitRsvp = async function (partyId, answers, by, song, note) {
    var r = await sb.rpc('submit_rsvp', { p_party: partyId, p_answers: answers, p_by: by, p_song: song, p_note: note });
    if (r.error) throw r.error;
    return r.data;
  };

  // ---------- quiz ----------
  LIVE.answerQuiz = function (q, a) { return sb.rpc('answer_quiz', { p_device: LIVE.device, p_name: guestName(), p_q: q, p_answer: a }); };
  LIVE.leaderboard = async function () { var r = await sb.rpc('quiz_leaderboard'); return r.error ? null : r.data; };

  // ---------- video wishes ----------
  LIVE.uploadWish = async function (file, prompt, capsule, name) {
    var id = uuid(), ext = extOf(file, 'mp4'), type = videoType(file);
    var info = await videoInfo(file);
    if (info.duration && info.duration > MAX_VIDEO_SECONDS) return { tooLong: true };
    var path = new Date(serverNow()).toISOString().slice(0, 10) + '/' + id + '.' + ext;
    progress('Sending your video... 0%', 0);
    try {
      await tusUpload(WISHES, path, file, type, function (p) { progress('Sending your video... ' + Math.round(p * 100) + '%', p); });
      var ins = await sb.from('wishes').insert({ path: path, guest_name: name || guestName(), prompt: prompt || '', capsule: !!capsule });
      if (ins.error) throw ins.error;
    } finally { progress(null); }
    return { ok: true };
  };

  // ---------- honeymoon fund ----------
  LIVE.payUrl = function (method, amount, note) {
    var amt = String(amount);
    if (method === 'Venmo' && C.venmo) return 'https://venmo.com/' + encodeURIComponent(C.venmo.replace(/^@/, '')) + '?txn=pay&amount=' + encodeURIComponent(amt) + '&note=' + encodeURIComponent(note || 'Honeymoon fund');
    if (method === 'Cash App' && C.cashapp) return 'https://cash.app/' + encodeURIComponent(C.cashapp.charAt(0) === '$' ? C.cashapp : '$' + C.cashapp) + '/' + encodeURIComponent(amt);
    return '';
  };
  LIVE.recordGift = function (g) { return sb.from('gifts').insert({ guest_name: g.name || guestName(), amount: Number(g.amount), method: g.method, what: g.what || '', note: g.note || '' }); };

  // ---------- fill in the wedding details from config.js ----------
  LIVE.applyText = function (root) {
    var map = C.text || {}, keys = Object.keys(map).filter(function (k) { return map[k]; });
    if (!keys.length) return;
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null), n, nodes = [];
    while ((n = walker.nextNode())) { if (n.nodeValue.indexOf('[') >= 0) nodes.push(n); }
    nodes.forEach(function (node) { var v = node.nodeValue; keys.forEach(function (k) { v = v.split(k).join(map[k]); }); node.nodeValue = v; });
    (root || document).querySelectorAll('[placeholder]').forEach(function (el) { var v = el.getAttribute('placeholder'); keys.forEach(function (k) { v = v.split(k).join(map[k]); }); el.setAttribute('placeholder', v); });
  };
  LIVE.t = function (s) { var map = C.text || {}; Object.keys(map).forEach(function (k) { if (map[k]) s = String(s).split(k).join(map[k]); }); return s; };

  window.LIVE = LIVE;
})();
