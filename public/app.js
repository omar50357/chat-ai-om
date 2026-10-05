const $ = s => document.querySelector(s);
const SUG = ["اكتب لي رسالة رسمية", "اشرح لي الذكاء الصناعي ببساطة", "أعطني أفكار مشاريع صغيرة", "ترجم لي إلى الإنجليزية"];
let chats = [], current = null, busy = false, installEvt = null, gInit = false, KEY = "", pending = [], imageMode = false;
const MAX_IMGS = 3;
const persist = () => {
  for (let i = chats.length - 1; i >= -1; i--) {
    try { localStorage.setItem(KEY, JSON.stringify(chats)); return; } catch {}
    if (i < 0) return;
    chats[i].messages.forEach(m => { delete m.pics; });
  }
};

const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = t => t.split("```").map((p, i) => i % 2
  ? "<pre><code>" + esc(p.replace(/^\w*\n/, "")) + "</code></pre>"
  : esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")).join("");

async function api(path, opts = {}) {
  const r = await fetch("/api" + path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401 && path !== "/login") { showLogin(); throw new Error("401"); }
  return r;
}

function showLogin() {
  $("#appview").hidden = true; $("#login").hidden = false;
  if (!gInit) initGoogle();
}
async function initGoogle() {
  if (!window.google?.accounts) return setTimeout(initGoogle, 200);
  gInit = true;
  const { clientId } = await (await fetch("/api/config")).json();
  google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
  google.accounts.id.renderButton($("#gbtn"), { theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "ar" });
}
async function onCredential(resp) {
  $("#lerr").textContent = "";
  const r = await api("/login", { method: "POST", body: JSON.stringify({ credential: resp.credential }) });
  if (!r.ok) { $("#lerr").textContent = (await r.json()).error; return; }
  showApp(await r.json());
}
function showApp(u) {
  $("#login").hidden = true; $("#appview").hidden = false;
  $("#uname").textContent = u.name || u.email;
  if (u.picture) { $("#pic").src = u.picture; $("#pic").hidden = false; } else $("#pic").hidden = true;
  KEY = "chatai:" + u.uid;
  try { chats = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { chats = []; }
  newChat();
}

function renderList() {
  const l = $("#list"); l.innerHTML = "";
  chats.forEach(c => {
    const d = document.createElement("div");
    d.className = "item" + (current && current.id === c.id ? " on" : "");
    d.innerHTML = "<span></span><button title='حذف' aria-label='حذف المحادثة'>✕</button>";
    d.querySelector("span").textContent = c.title;
    d.onclick = () => openChat(c);
    d.querySelector("button").onclick = e => {
      e.stopPropagation();
      if (!confirm("حذف هذه المحادثة؟")) return;
      chats = chats.filter(x => x.id !== c.id); persist();
      if (current && current.id === c.id) newChat(); else renderList();
    };
    l.appendChild(d);
  });
}

function add(role, text, thumbs, pics) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  if (thumbs && thumbs.length) {
    const g = document.createElement("div"); g.className = "thumbs";
    thumbs.forEach(t => { const i = document.createElement("img"); i.src = t; i.alt = "صورة مرفقة"; g.appendChild(i); });
    d.appendChild(g);
  }
  if (role === "ai") { if (text && text !== GEN_ONLY) d.innerHTML = fmt(text); }
  else if (text && text !== IMG_ONLY) d.appendChild(document.createTextNode(text));
  if (pics && pics.length) pics.forEach(u => showPic(d, u));
  $("#chat").appendChild(d); $("#chat").scrollTop = 1e9; return d;
}
const IMG_ONLY = "📷 صورة", GEN_ONLY = "🎨 صورة";
function showPic(box, url) {
  const im = document.createElement("img"); im.className = "gen"; im.src = url; im.alt = "صورة مولّدة";
  const a = document.createElement("div"); a.className = "acts";
  const save = document.createElement("button"); save.type = "button"; save.textContent = "حفظ";
  save.onclick = () => { const l = document.createElement("a"); l.href = url; l.download = "chat-ai-om-" + Date.now() + (url.startsWith("data:image/png") ? ".png" : ".jpg"); document.body.appendChild(l); l.click(); l.remove(); };
  const ed = document.createElement("button"); ed.type = "button"; ed.textContent = "تعديل";
  ed.onclick = async () => {
    if (pending.length >= MAX_IMGS) return;
    try { const i2 = await loadImage(url); pending.push({ data: shrink(i2, 1280, 0.82).split(",")[1], thumb: shrink(i2, 96, 0.6) }); renderPending(); setImageMode(true); $("#in").focus(); } catch {}
  };
  a.append(save, ed); box.append(im, a);
}
function setImageMode(on) {
  imageMode = on; $("#imgmode").classList.toggle("on", on); $("#imgmode").setAttribute("aria-pressed", on);
  $("#in").placeholder = on ? "صف الصورة أو التعديل المطلوب..." : "اكتب رسالتك...";
}

// ---- الصور: تصغير قبل الإرسال ----
function loadImage(src) {
  return new Promise((ok, no) => {
    const own = typeof src !== "string", url = own ? URL.createObjectURL(src) : src, img = new Image();
    img.onload = () => { if (own) URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { if (own) URL.revokeObjectURL(url); no(new Error("bad")); };
    img.src = url;
  });
}
function shrink(img, max, q) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
async function addFiles(files) {
  $("#ierr").textContent = "";
  for (const f of files) {
    if (pending.length >= MAX_IMGS) { $("#ierr").textContent = "الحد الأقصى " + MAX_IMGS + " صور في الرسالة."; break; }
    if (!f.type.startsWith("image/")) continue;
    try {
      const img = await loadImage(f);
      pending.push({ data: shrink(img, 1280, 0.82).split(",")[1], thumb: shrink(img, 96, 0.6) });
    } catch { $("#ierr").textContent = "تعذّر قراءة إحدى الصور. جرّب صيغة JPG أو PNG."; }
  }
  renderPending();
}
function renderPending() {
  const box = $("#previews"); box.innerHTML = "";
  pending.forEach((p, i) => {
    const w = document.createElement("div"); w.className = "pv";
    const im = document.createElement("img"); im.src = p.thumb; im.alt = "";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "✕"; b.setAttribute("aria-label", "إزالة الصورة");
    b.onclick = () => { pending.splice(i, 1); renderPending(); };
    w.append(im, b); box.appendChild(w);
  });
  box.hidden = !pending.length;
}
function newChat() {
  current = null; closeSide();
  const e = document.createElement("div"); e.className = "empty";
  e.innerHTML = '<div class="logo big">AI</div><h2>مرحباً، أنا Chat AI OM</h2><div>اسألني أي شيء وسأساعدك.</div><div class="chips"></div>';
  SUG.forEach(s => { const b = document.createElement("button"); b.className = "chip"; b.textContent = s; b.onclick = () => send(s); e.querySelector(".chips").appendChild(b); });
  $("#chat").replaceChildren(e); renderList();
}
function openChat(c) {
  if (busy) return;
  current = c; closeSide(); $("#chat").innerHTML = "";
  c.messages.forEach(m => add(m.role === "user" ? "user" : "ai", m.content, m.thumbs, m.pics));
  renderList();
}

async function send(text) {
  text = text.trim();
  if (busy || (!text && !pending.length)) return;
  busy = true; $("#send").disabled = true;
  const imgs = pending; pending = []; renderPending();
  const label = text || IMG_ONLY;
  const gen = imageMode;
  if (!current) { current = { id: Date.now(), title: label.slice(0, 40), messages: [] }; $("#chat").innerHTML = ""; }
  const fresh = !chats.includes(current);
  const thumbs = imgs.map(p => p.thumb);
  current.messages.push({ role: "user", content: label, thumbs });
  add("user", label, thumbs); $("#in").value = ""; $("#in").style.height = "auto";
  const bubble = add("ai", gen ? "🎨 جارٍ تجهيز الصورة... قد يستغرق حتى دقيقة." : "...");
  try {
    if (gen) {
      const r = await api("/image", { method: "POST", body: JSON.stringify({ prompt: text, images: imgs.map(p => ({ data: p.data })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "تعذّر إنشاء الصورة (قد تكون الصورة كبيرة جداً).");
      bubble.innerHTML = j.text ? fmt(j.text) : "";
      const pics = [];
      for (const im of j.images) {
        const url = "data:" + im.mime + ";base64," + im.data;
        showPic(bubble, url);
        try { pics.push(shrink(await loadImage(url), 768, 0.75)); } catch {}
      }
      $("#chat").scrollTop = 1e9;
      current.messages.push({ role: "assistant", content: j.text || GEN_ONLY, pics });
      if (fresh) chats.unshift(current);
      persist();
      renderList(); busy = false; $("#send").disabled = false;
      return;
    }
    const payload = current.messages.map(m => ({ role: m.role, content: m.content }));
    if (imgs.length) payload[payload.length - 1].images = imgs.map(p => ({ mime: "image/jpeg", data: p.data }));
    const res = await api("/chat", { method: "POST", body: JSON.stringify({ messages: payload }) });
    if (!res.ok) throw new Error((await res.json()).error || "حدث خطأ");
    const rd = res.body.getReader(), dec = new TextDecoder(); let full = "";
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      full += dec.decode(value, { stream: true });
      bubble.innerHTML = fmt(full); $("#chat").scrollTop = 1e9;
    }
    current.messages.push({ role: "assistant", content: full });
    if (fresh) chats.unshift(current);
    persist();
  } catch (e) {
    current.messages.pop(); pending = imgs; renderPending();
    if (e.message !== "401") bubble.textContent = e.message === "Failed to fetch" ? "تعذّر الاتصال. تحقق من الإنترنت." : e.message;
  }
  renderList(); busy = false; $("#send").disabled = false;
}

const closeSide = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("open"); };
$("#f").onsubmit = e => { e.preventDefault(); send($("#in").value); };
$("#in").oninput = e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; };
$("#in").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); send($("#in").value); } };
$("#imgmode").onclick = () => setImageMode(!imageMode);
$("#attach").onclick = () => $("#file").click();
$("#file").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
$("#new").onclick = () => { if (!busy) newChat(); };
$("#menu").onclick = () => { $("#side").classList.add("open"); $("#scrim").classList.add("open"); };
$("#scrim").onclick = closeSide;
$("#logout").onclick = async () => { await fetch("/api/logout", { method: "POST" }); google.accounts?.id.disableAutoSelect(); showLogin(); };

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#install").hidden = false; });
$("#install").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#install").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

(async () => {
  const r = await fetch("/api/me", { credentials: "same-origin" });
  if (r.ok) showApp(await r.json()); else showLogin();
})();
