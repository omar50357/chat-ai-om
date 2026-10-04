import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

const {
  GOOGLE_CLIENT_ID, GEMINI_API_KEY, SESSION_SECRET,
  MODEL = "gemini-2.5-flash", HOURLY_LIMIT = "30", PORT = "3000", NODE_ENV,
} = process.env;

for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID, GEMINI_API_KEY, SESSION_SECRET })) {
  if (!v) { console.error(`المتغير ${k} غير موجود. راجع ملف .env`); process.exit(1); }
}

const SYSTEM = "أنت Chat AI OM، مساعد ذكاء صناعي عام يساعد في كل شيء: الإجابة عن الأسئلة، الكتابة، الترجمة، البرمجة، الحساب، الأفكار، والتعلم. أجب بنفس لغة المستخدم (العربية افتراضياً) بوضوح واختصار، واستخدم كتل الكود عند الحاجة.";
const google = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// حد الاستخدام لكل مستخدم في الساعة (يحمي حصتك المجانية)
const hits = new Map();
function limited(uid) {
  const now = Date.now(), arr = (hits.get(uid) || []).filter(t => now - t < 3600e3);
  if (arr.length >= Number(HOURLY_LIMIT)) { hits.set(uid, arr); return true; }
  arr.push(now); hits.set(uid, arr); return false;
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
  let contents = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-30)
    .map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: String(m.content || "").slice(0, 8000) }] }))
    .filter(m => m.parts[0].text);
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

app.listen(Number(PORT), () => console.log(`Chat AI OM يعمل على المنفذ ${PORT}`));
