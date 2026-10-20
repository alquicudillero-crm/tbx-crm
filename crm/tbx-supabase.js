/*
 * TRAVEL BIKEX CRM — conexión con Supabase.
 *
 * El CRM se escribió para el almacenamiento de Claude (window.claude.use("db" | "assets" | "downloads")).
 * Este archivo ofrece esas mismas tres piezas sobre Supabase, así el CRM funciona igual en tu dominio:
 *   - db:        documentos JSON en la tabla tbx_docs (path, collection, data), en tiempo real.
 *   - assets:    archivos privados en el bucket "tbx-files" (pasaportes, firmas, tickets, tracks).
 *   - downloads: descarga normal del navegador.
 * Además pone la pantalla de inicio de sesión y el importador de la migración (crm/?importar).
 */
(function () {
  "use strict";
  const CFG = window.TBX_CONFIG || {};
  const TABLE = "tbx_docs", BUCKET = "tbx-files";
  const configured = CFG.supabaseUrl && CFG.supabaseAnonKey && !/TU_PROYECTO|PEGA_AQUI/.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
  let sb = null;
  let resolveReady; const ready = new Promise(r => (resolveReady = r));

  /* ---------- small UI helpers (login, importer) ---------- */
  const css = `
  .tbx-auth{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#0b0b0b;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));font-family:"Public Sans",system-ui,sans-serif}
  .tbx-auth .box{width:min(380px,100%);background:#161714;border:1px solid #2c2e29;border-radius:16px;padding:26px;display:grid;gap:14px;color:#f1f2ee}
  .tbx-auth img{height:56px;width:auto;justify-self:start}
  .tbx-auth h1{margin:0;font:800 22px/1.1 "Barlow Condensed",Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase}
  .tbx-auth label{display:grid;gap:5px;font-size:13px;color:#a3a89d;font-weight:600}
  .tbx-auth input{font:inherit;font-size:15px;padding:10px 12px;border-radius:10px;border:1px solid #33362f;background:#0f100e;color:#f1f2ee}
  .tbx-auth input:focus{outline:2px solid #b5c036;outline-offset:1px}
  .tbx-auth button{font:inherit;font-weight:800;font-size:15px;padding:11px;border:0;border-radius:10px;background:linear-gradient(90deg,#7ea538,#b5c036);color:#0b0b0b;cursor:pointer}
  .tbx-auth button:disabled{opacity:.6;cursor:progress}
  .tbx-auth .msg{font-size:13.5px;color:#ff9a8f;min-height:1em}
  .tbx-auth .ok{color:#b5c036}
  .tbx-auth .small{font-size:12.5px;color:#a3a89d}
  .tbx-logout{margin-left:12px;font:600 12px "Public Sans",system-ui,sans-serif;color:#fff;background:transparent;border:1px solid #444;border-radius:99px;padding:4px 10px;cursor:pointer}
  .tbx-logout:hover{border-color:#b5c036}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const logoSrc = () => { const i = document.querySelector(".brand-logo"); return i ? i.src : ""; };
  function overlay(html) {
    let el = document.querySelector(".tbx-auth");
    if (!el) { el = document.createElement("div"); el.className = "tbx-auth"; document.body.appendChild(el); }
    el.innerHTML = `<div class="box">${logoSrc() ? `<img src="${logoSrc()}" alt="Travel Bikex">` : ""}${html}</div>`;
    return el;
  }
  const closeOverlay = () => { const el = document.querySelector(".tbx-auth"); if (el) el.remove(); };

  function showLogin(msg) {
    const el = overlay(`<h1>Acceso equipo</h1>
      <form id="tbxLogin" style="display:grid;gap:12px">
        <label>Email<input id="tbxEmail" type="email" autocomplete="username" required></label>
        <label>Contraseña<input id="tbxPass" type="password" autocomplete="current-password" required></label>
        <button type="submit" id="tbxGo">Entrar</button>
        <div class="msg" id="tbxMsg">${msg || ""}</div>
      </form>
      <button type="button" id="tbxForgot" style="background:transparent;color:#a3a89d;font-weight:600;font-size:13px;padding:0;justify-self:start;text-decoration:underline">He olvidado la contraseña</button>`);
    el.querySelector("#tbxEmail").focus();
    el.querySelector("#tbxLogin").addEventListener("submit", async ev => {
      ev.preventDefault();
      const b = el.querySelector("#tbxGo"); b.disabled = true; b.textContent = "Entrando…";
      const { data, error } = await sb.auth.signInWithPassword({ email: el.querySelector("#tbxEmail").value.trim(), password: el.querySelector("#tbxPass").value });
      if (error) { b.disabled = false; b.textContent = "Entrar"; el.querySelector("#tbxMsg").textContent = "Email o contraseña incorrectos."; return; }
      start(data.session);
    });
    el.querySelector("#tbxForgot").addEventListener("click", async () => {
      const email = el.querySelector("#tbxEmail").value.trim(); const m = el.querySelector("#tbxMsg");
      if (!email) { m.textContent = "Escribe tu email y vuelve a pulsar."; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      m.className = error ? "msg" : "msg ok"; m.textContent = error ? "No se pudo enviar el email." : "Te hemos enviado un email para cambiar la contraseña.";
    });
  }

  function showNewPassword() {
    const el = overlay(`<h1>Nueva contraseña</h1>
      <form id="tbxNew" style="display:grid;gap:12px"><label>Nueva contraseña (mínimo 8 caracteres)<input id="tbxP1" type="password" minlength="8" autocomplete="new-password" required></label>
      <button type="submit">Guardar y entrar</button><div class="msg" id="tbxMsg"></div></form>`);
    el.querySelector("#tbxNew").addEventListener("submit", async ev => {
      ev.preventDefault();
      const { data, error } = await sb.auth.updateUser({ password: el.querySelector("#tbxP1").value });
      if (error) { el.querySelector("#tbxMsg").textContent = "No se pudo guardar: " + error.message; return; }
      const s = await sb.auth.getSession(); start(s.data.session);
    });
  }

  let started = false;
  async function start(session) {
    if (started || !session) return;
    // Only people listed in tbx_team may use the CRM (the database rules enforce it too).
    const { data, error } = await sb.from("tbx_team").select("email").limit(1);
    if (error || !data || !data.length) {
      overlay(`<h1>Sin acceso</h1><p class="small">Tu usuario (${escapeHtml(session.user.email)}) no está en el equipo de Travel Bikex. Pide al administrador que te añada a la tabla <b>tbx_team</b> en Supabase.</p><button type="button" id="tbxOut">Salir</button>`)
        .querySelector("#tbxOut").addEventListener("click", () => sb.auth.signOut());
      return;
    }
    started = true;
    closeOverlay();
    const top = document.querySelector(".top");
    if (top && !top.querySelector(".tbx-logout")) {
      const b = document.createElement("button"); b.className = "tbx-logout"; b.textContent = "Salir"; b.title = session.user.email;
      b.addEventListener("click", () => sb.auth.signOut()); top.appendChild(b);
    }
    subscribeRealtime();
    resolveReady();
    if (/[?&]importar\b/.test(location.search)) showImporter();
  }
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- db: documents with Firestore-like paths over one table ---------- */
  const split = path => { const i = path.lastIndexOf("/"); return { col: path.slice(0, i), id: path.slice(i + 1) }; };
  const cache = new Map();      // collection -> Map(id -> data)
  const loaded = new Map();     // collection -> Promise
  const listeners = new Map();  // collection -> Set(fn)
  const docListeners = new Map(); // path -> Set(fn)
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const dbErr = (e, code) => { console.warn(e); const x = new Error((e && e.message) || "db"); x.code = code || "unavailable"; return x; };

  function snapOf(col) {
    const m = cache.get(col) || new Map();
    const docs = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, d]) => ({ id, exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function emit(col) {
    (listeners.get(col) || []).forEach(fn => { try { fn(snapOf(col)); } catch (e) { console.error(e); } });
    const m = cache.get(col) || new Map();
    docListeners.forEach((set, path) => {
      const { col: c, id } = split(path); if (c !== col) return;
      const d = m.get(id); set.forEach(fn => { try { fn({ id, exists: d !== undefined, data: () => d, metadata: {} }); } catch (e) { console.error(e); } });
    });
  }
  function load(col) {
    if (!loaded.has(col)) {
      loaded.set(col, (async () => {
        const out = new Map(); let from = 0;
        for (;;) {
          const { data, error } = await sb.from(TABLE).select("path,data").eq("collection", col).range(from, from + 999);
          if (error) throw dbErr(error);
          data.forEach(r => out.set(split(r.path).id, r.data));
          if (data.length < 1000) break; from += 1000;
        }
        cache.set(col, out);
      })().catch(e => { loaded.delete(col); throw e; }));
    }
    return loaded.get(col);
  }
  function applyLocal(path, data) { // optimistic: the change shows at once, realtime confirms it
    const { col, id } = split(path);
    if (!cache.has(col)) return;
    const m = cache.get(col);
    if (data === undefined) m.delete(id); else m.set(id, data);
    emit(col);
  }
  function subscribeRealtime() {
    sb.channel("tbx-docs").on("postgres_changes", { event: "*", schema: "public", table: TABLE }, p => {
      const row = p.eventType === "DELETE" ? p.old : p.new;
      if (!row || !row.path) { cache.forEach((_, col) => { loaded.delete(col); load(col).then(() => emit(col)); }); return; }
      applyLocal(row.path, p.eventType === "DELETE" ? undefined : row.data);
    }).subscribe();
  }
  async function readDoc(path) {
    const { col, id } = split(path);
    if (cache.has(col)) return cache.get(col).get(id);
    const { data, error } = await sb.from(TABLE).select("data").eq("path", path).maybeSingle();
    if (error) throw dbErr(error);
    return data ? data.data : undefined;
  }
  async function writeDoc(path, data) {
    const { col } = split(path);
    applyLocal(path, clone(data));
    const { error } = await sb.from(TABLE).upsert({ path, collection: col, data, updated_at: new Date().toISOString() });
    if (error) { loaded.delete(col); load(col).then(() => emit(col)); throw dbErr(error, /row-level|permission/i.test(error.message) ? "invalid_argument" : "unavailable"); }
  }
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  function deepMerge(a, b) {
    const out = isObj(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) {
      if (isObj(v) && v.__delete__ === true) { delete out[k]; continue; }
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
    }
    return out;
  }
  const newId = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(20)); r.forEach(x => (s += a[x % a.length])); return s; };

  function docRef(path) {
    const { id } = split(path);
    return {
      id, path,
      async get() { const d = await readDoc(path); return { id, exists: d !== undefined, data: () => d, metadata: {} }; },
      async set(data) { await writeDoc(path, clone(data)); },
      async update(patch) {
        const cur = await readDoc(path);
        if (cur === undefined) { const e = new Error("El documento no existe"); e.code = "invalid_argument"; throw e; }
        await writeDoc(path, deepMerge(cur, patch));
      },
      async delete() {
        applyLocal(path, undefined);
        const { error } = await sb.from(TABLE).delete().eq("path", path);
        if (error) throw dbErr(error);
      },
      onSnapshot(next, onErr) {
        const { col } = split(path);
        if (!docListeners.has(path)) docListeners.set(path, new Set());
        docListeners.get(path).add(next);
        load(col).then(() => emit(col), e => onErr && onErr(e));
        return () => docListeners.get(path).delete(next);
      },
      collection(sub) { return colRef(path + "/" + sub); },
      async acquire() { return { acquired: true }; }
    };
  }
  function colRef(col) {
    const q = {
      path: col,
      doc(id) { return docRef(col + "/" + (id || newId())); },
      async add(data) { const r = docRef(col + "/" + newId()); await r.set(data); return r; },
      async get() { await load(col); return snapOf(col); },
      onSnapshot(next, onErr) {
        if (!listeners.has(col)) listeners.set(col, new Set());
        listeners.get(col).add(next);
        load(col).then(() => next(snapOf(col)), e => onErr && onErr(e));
        return () => listeners.get(col).delete(next);
      },
      where() { return q; }, orderBy() { return q; }, limit() { return q; }
    };
    return q;
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- assets: private files, opened through short-lived signed links ---------- */
  const assets = {
    async upload(blob, opts) {
      const id = newId() + newId().slice(0, 12);
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType: type, upsert: false });
      if (error) { const e = new Error(error.message); e.code = /size|large/i.test(error.message) ? "too_large" : "upstream_error"; throw e; }
      return { id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: type };
    },
    async delete(ref) { const id = String(ref).replace(/^.*\/_blob\//, ""); const { error } = await sb.storage.from(BUCKET).remove([id]); return { deleted: !error }; },
    async list() { return { assets: [], usage: {} }; }
  };
  const signed = new Map();
  async function signedUrl(id) {
    const c = signed.get(id); if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(id, 3600);
    if (error) throw error;
    signed.set(id, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }); return data.signedUrl;
  }
  const blobId = u => { const m = /\/_blob\/([A-Za-z0-9._-]+)/.exec(String(u || "")); return m ? m[1] : null; };
  // the CRM fetches files as "/_blob/<id>" (PDF bundle, tracks): serve them from Storage
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const id = typeof input === "string" ? blobId(input) : null;
    if (id && sb) {
      const { data, error } = await sb.storage.from(BUCKET).download(id);
      if (error) return new Response("", { status: 404 });
      return new Response(data, { status: 200, headers: { "Content-Type": data.type || "application/octet-stream" } });
    }
    return nativeFetch(input, init);
  };
  // <a href="/_blob/<id>"> opens the private file in a new tab
  document.addEventListener("click", ev => {
    const a = ev.target.closest && ev.target.closest("a[href]"); if (!a) return;
    const id = blobId(a.getAttribute("href")); if (!id || !sb) return;
    ev.preventDefault();
    const w = window.open("", "_blank");
    signedUrl(id).then(u => { if (w) w.location = u; else location.href = u; }, () => { if (w) w.close(); alertBar("No se pudo abrir el archivo."); });
  }, true);
  // <img src="/_blob/<id>"> (ticket photos) gets a signed link
  function fixImgs(root) {
    (root.querySelectorAll ? root.querySelectorAll('img[src*="/_blob/"]') : []).forEach(img => {
      const id = blobId(img.getAttribute("src")); if (!id || img.dataset.tbx === id) return;
      img.dataset.tbx = id; img.removeAttribute("src");
      signedUrl(id).then(u => (img.src = u), () => {});
    });
  }
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === "IMG") fixImgs(n.parentNode || document); else fixImgs(n); }))).observe(document.documentElement, { childList: true, subtree: true });
  function alertBar(t) { const el = document.getElementById("toast"); if (el) { el.textContent = t; el.hidden = false; setTimeout(() => (el.hidden = true), 3500); } }

  /* ---------- downloads: plain browser download ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const u = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      return { status: "saved" };
    }
  };

  /* ---------- importer for the migration package (crm/?importar) ---------- */
  function showImporter() {
    const el = overlay(`<h1>Importar migración</h1>
      <p class="small">Elige la carpeta <b>tbx-migracion</b> (la que contiene <b>datos.json</b> y la carpeta <b>archivos</b>). Se suben todos los viajes y archivos a Supabase. Puedes repetirlo sin duplicar nada.</p>
      <input type="file" id="tbxDir" webkitdirectory directory multiple style="color:#f1f2ee">
      <div class="msg ok" id="tbxProg"></div>
      <button type="button" id="tbxClose">Ir al CRM</button>`);
    el.querySelector("#tbxClose").addEventListener("click", () => { history.replaceState(null, "", location.pathname); location.reload(); });
    el.querySelector("#tbxDir").addEventListener("change", async ev => {
      const files = [...ev.target.files]; const prog = el.querySelector("#tbxProg");
      const dj = files.find(f => /(^|\/)datos\.json$/.test(f.webkitRelativePath || f.name));
      if (!dj) { prog.className = "msg"; prog.textContent = "No encuentro datos.json en esa carpeta."; return; }
      try {
        const { docs } = JSON.parse(await dj.text());
        prog.textContent = `Subiendo ${docs.length} registros…`;
        const rows = docs.map(d => ({ path: d.path, collection: split(d.path).col, data: d.data, updated_at: new Date().toISOString() }));
        for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 200)); if (error) throw error; }
        const arch = files.filter(f => /(^|\/)archivos\/[^/]+$/.test(f.webkitRelativePath || ""));
        const types = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain" };
        let n = 0, fail = 0;
        for (const f of arch) {
          const id = f.name.replace(/\.[^.]+$/, ""), ext = (f.name.split(".").pop() || "").toLowerCase();
          const { error } = await sb.storage.from(BUCKET).upload(id, f, { contentType: types[ext] || "application/octet-stream", upsert: true });
          if (error) fail++; n++;
          prog.textContent = `Registros listos. Archivos: ${n} / ${arch.length}${fail ? ` (${fail} con error)` : ""}`;
        }
        prog.className = fail ? "msg" : "msg ok";
        prog.textContent = fail ? `Terminado con ${fail} archivos con error. Vuelve a elegir la carpeta para reintentarlo.` : `Listo: ${docs.length} registros y ${arch.length} archivos importados.`;
      } catch (e) { prog.className = "msg"; prog.textContent = "Error al importar: " + (e.message || e); }
    });
  }

  /* ---------- the window.claude shim the CRM expects ---------- */
  window.claude = {
    use: async name => {
      if (!configured) return null;
      await ready;
      return name === "db" ? db : name === "assets" ? assets : name === "downloads" ? downloads : null;
    }
  };

  function boot() {
    if (!configured) {
      overlay(`<h1>Falta configurar</h1><p class="small">Abre <b>crm/config.js</b> y pega la URL y la clave pública (anon key) de tu proyecto de Supabase.</p>`);
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      overlay(`<h1>Sin conexión</h1><p class="small">No se pudo cargar la conexión con la base de datos. Comprueba tu internet y recarga la página.</p>`);
      return;
    }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") showNewPassword();
      else if (event === "SIGNED_OUT") location.reload();
      else if (session && event === "SIGNED_IN" && !started && !/type=recovery/.test(location.hash)) start(session);
    });
    sb.auth.getSession().then(({ data }) => {
      if (/type=recovery/.test(location.hash)) return; // handled by PASSWORD_RECOVERY
      if (data.session) start(data.session); else showLogin();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
