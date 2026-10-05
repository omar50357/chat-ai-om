import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

const {
  GOOGLE_CLIENT_ID, GEMINI_API_KEY, SESSION_SECRET,
  MODEL = "gemini-2.5-flash", IMAGE_MODEL = "gemini-3.1-flash-image-preview", IMAGE_HOURLY_LIMIT = "20", HOURLY_LIMIT = "30", PORT = "3000", NODE_ENV,
} = process.env;

for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID, GEMINI_API_KEY, SESSION_SECRET })) {
  if (!v) { console.error(`المتغير ${k} غير موجود. راجع ملف .env`); process.exit(1); }
}

const SYSTEM = "أنت Chat AI OM، مساعد ذكاء صناعي عام يساعد في كل شيء: الإجابة عن الأسئلة، الكتابة، الترجمة، البرمجة، الحساب، الأفكار، والتعلم. أجب بنفس لغة المستخدم (العربية افتراضياً) بوضوح واختصار، واستخدم كتل الكود عند الحاجة.";
const google = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// حد الاستخدام لكل مستخدم في الساعة (يحمي حصتك المجانية)
const hits = new Map();
function limited(uid) {
  const now = Date.now(), arr = (hits.get(uid) || []).filter(t => now - t < 3600e3);
  if (arr.length >= Number(HOURLY_LIMIT)) { hits.set(uid, arr); return true; }
  arr.push(now); hits.set(uid, arr); return false;
}

const imgHits = new Map();
function imgLimited(uid) {
  const now = Date.now(), arr = (imgHits.get(uid) || []).filter(t => now - t < 3600e3);
  if (arr.length >= Number(IMAGE_HOURLY_LIMIT)) { imgHits.set(uid, arr); return true; }
  arr.push(now); imgHits.set(uid, arr); return false;
}

function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.session || "", SESSION_SECRET); next(); }
  catch { res.status(401).json({ error: "سجّل الدخول أولاً" }); }
}

app.get("/api/config", (_, res) => res.json({ clientId: GOOGLE_CLIENT_ID }));

app.post("/api/login", async (req, res) => {
  try {
    const ticket = await google.verifyIdToken({ idToken: String(req.body.credential || ""), audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email_verified) throw new Error("unverified");
    const user = { uid: p.sub, name: p.name || p.email, email: p.email, picture: p.picture || "" };
    res.cookie("session", jwt.sign(user, SESSION_SECRET, { expiresIn: "30d" }),
      { httpOnly: true, sameSite: "lax", secure: NODE_ENV === "production", maxAge: 30 * 864e5 });
    res.json(user);
  } catch { res.status(401).json({ error: "فشل تسجيل الدخول بحساب Google" }); }
});

app.post("/api/logout", (_, res) => { res.clearCookie("session"); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => {
  const { uid, name, email, picture } = req.user; res.json({ uid, name, email, picture });
});

app.post("/api/chat", auth, async (req, res) => {
  const raw = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-30);
  let contents = raw.map((m, i) => {
    const parts = [], text = String(m?.content || "").slice(0, 8000);
    if (text) parts.push({ text });
    if (m?.role === "user" && i === raw.length - 1 && Array.isArray(m.images)) {
      for (const im of m.images.slice(0, 3)) {
        if (im && typeof im.data === "string" && im.data.length < 2_500_000 && /^[A-Za-z0-9+/=]+$/.test(im.data))
          parts.push({ inline_data: { mime_type: "image/jpeg", data: im.data } });
      }
    }
    return { role: m?.role === "user" ? "user" : "model", parts };
  }).filter(m => m.parts.length);
  while (contents.length && contents[0].role !== "user") contents.shift();
  if (!contents.length || contents.at(-1).role !== "user") return res.status(400).json({ error: "الرسالة فارغة" });
  if (limited(req.user.uid)) return res.status(429).json({ error: "وصلت إلى حد الاستخدام في الساعة. حاول لاحقاً." });

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:streamGenerateContent?alt=sse`, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents }),
    });
    if (!r.ok) {
      console.error("Gemini error", r.status, (await r.text()).slice(0, 300));
      return res.status(r.status === 429 ? 429 : 502).json({
        error: r.status === 429 ? "تجاوزت الحصة المجانية مؤقتاً. حاول بعد قليل." : "تعذّر الاتصال بالذكاء الصناعي.",
      });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const dec = new TextDecoder(); let buf = "", wrote = false;
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
          if (t) { res.write(t); wrote = true; }
        } catch {}
      }
    }
    if (!wrote) res.write("لم أستطع الإجابة على هذا الطلب. جرّب صياغة أخرى.");
    res.end();
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e?.message || e);
    if (!res.headersSent) res.status(502).json({ error: "تعذّر الاتصال بالذكاء الصناعي." });
    else res.end();
  }
});

// إنشاء الصور وتعديلها
app.post("/api/image", auth, async (req, res) => {
  const prompt = String(req.body.prompt || "").trim().slice(0, 4000);
  const parts = [];
  if (prompt) parts.push({ text: prompt });
  for (const im of (Array.isArray(req.body.images) ? req.body.images : []).slice(0, 3)) {
    if (im && typeof im.data === "string" && im.data.length < 2_500_000 && /^[A-Za-z0-9+/=]+$/.test(im.data))
      parts.push({ inline_data: { mime_type: "image/jpeg", data: im.data } });
  }
  if (!parts.some(p => p.text)) return res.status(400).json({ error: "اكتب وصفاً للصورة أو ما تريد تعديله." });
  if (imgLimited(req.user.uid)) return res.status(429).json({ error: "وصلت إلى حد الصور في الساعة. حاول لاحقاً." });

  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 110000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGE_MODEL)}:generateContent`, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    });
    if (!r.ok) {
      console.error("Gemini image error", r.status, (await r.text()).slice(0, 400));
      const msg = r.status === 429 ? "تجاوزت حصة الصور المجانية مؤقتاً. حاول لاحقاً."
        : [400, 403, 404].includes(r.status) ? "نموذج الصور غير متاح في خطتك المجانية حالياً."
        : "تعذّر إنشاء الصورة.";
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const j = await r.json();
    const out = (j.candidates?.[0]?.content?.parts || []);
    const images = out.map(p => p.inlineData || p.inline_data).filter(Boolean)
      .map(d => ({ mime: d.mimeType || d.mime_type || "image/png", data: d.data }));
    const text = out.map(p => p.text || "").join("").trim();
    if (!images.length) return res.status(422).json({ error: text || "لم يتم إنشاء صورة. جرّب وصفاً آخر." });
    res.json({ text, images });
  } catch (e) {
    console.error(e?.message || e);
    res.status(502).json({ error: e.name === "AbortError" ? "استغرق إنشاء الصورة وقتاً طويلاً. حاول مرة أخرى." : "تعذّر إنشاء الصورة." });
  } finally { clearTimeout(timer); }
});

app.listen(Number(PORT), () => console.log(`Chat AI OM يعمل على المنفذ ${PORT}`));
