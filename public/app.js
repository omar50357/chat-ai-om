const $ = s => document.querySelector(s);
const SUG = ["اكتب لي رسالة رسمية", "اشرح لي الذكاء الصناعي ببساطة", "أعطني أفكار مشاريع صغيرة", "ترجم لي إلى الإنجليزية"];
let chats = [], current = null, busy = false, installEvt = null, gInit = false, KEY = "";
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(chats)); } catch {} };

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

function add(role, text) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  if (role === "ai") d.innerHTML = fmt(text); else d.textContent = text;
  $("#chat").appendChild(d); $("#chat").scrollTop = 1e9; return d;
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
  c.messages.forEach(m => add(m.role === "user" ? "user" : "ai", m.content));
  renderList();
}

async function send(text) {
  text = text.trim();
  if (busy || !text) return;
  busy = true; $("#send").disabled = true;
  if (!current) { current = { id: Date.now(), title: text.slice(0, 40), messages: [] }; $("#chat").innerHTML = ""; }
  const fresh = !chats.includes(current);
  current.messages.push({ role: "user", content: text });
  add("user", text); $("#in").value = ""; $("#in").style.height = "auto";
  const bubble = add("ai", "...");
  try {
    const res = await api("/chat", { method: "POST", body: JSON.stringify({ messages: current.messages }) });
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
    current.messages.pop();
    if (e.message !== "401") bubble.textContent = e.message === "Failed to fetch" ? "تعذّر الاتصال. تحقق من الإنترنت." : e.message;
  }
  renderList(); busy = false; $("#send").disabled = false;
}

const closeSide = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("open"); };
$("#f").onsubmit = e => { e.preventDefault(); send($("#in").value); };
$("#in").oninput = e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; };
$("#in").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); send($("#in").value); } };
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
