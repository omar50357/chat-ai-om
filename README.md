# Chat AI OM (نسخة مجانية)

تطبيق دردشة بالذكاء الصناعي (Gemini) مع تسجيل الدخول بحساب Google، ويُثبَّت على الهاتف من الرابط (PWA). كل الخدمات المستخدمة لها خطة مجانية.

## ما تحتاجه (كله مجاني)
1. **مفتاح Gemini:** ادخل aistudio.google.com/app/apikey وأنشئ مفتاحاً (لا يتطلب بطاقة دفع).
2. **Client ID من Google Cloud:**
   - console.cloud.google.com ← أنشئ مشروعاً.
   - APIs & Services ← OAuth consent screen: أكمل البيانات الأساسية.
   - Credentials ← Create credentials ← OAuth client ID ← Web application.
   - في Authorized JavaScript origins أضف رابط موقعك بعد النشر (و `http://localhost:3000` للتجربة).
3. **حساب GitHub** و **حساب Render** (الخطة Free).

## النشر على Render (مجاناً)
1. ارفع هذا المجلد إلى مستودع GitHub.
2. في Render: New ← Web Service ← اختر المستودع ← Instance Type: **Free**.
3. Build Command: `npm install` — Start Command: `npm start`.
4. من Environment أضف: `GOOGLE_CLIENT_ID` و `GEMINI_API_KEY` و `SESSION_SECRET` (أي نص طويل) و `NODE_ENV=production`.
5. بعد النشر انسخ الرابط وأضفه في Google إلى Authorized JavaScript origins.
6. افتح الرابط في Chrome: يظهر زر "تثبيت التطبيق". في آيفون: مشاركة ← إضافة إلى الشاشة الرئيسية.

## التشغيل على جهازك
```
npm install
cp .env.example .env     # املأ القيم
npm start
```

## حدود النسخة المجانية
- المحادثات تُحفظ داخل متصفح كل مستخدم على جهازه، فلا تنتقل بين الأجهزة وتضيع إذا مُسحت بيانات المتصفح.
- خدمة Render المجانية تتوقف بعد 15 دقيقة بلا زيارات، فأول فتح بعد ذلك يتأخر قليلاً.
- حصة Gemini المجانية محدودة بعدد الطلبات وقد تتغير. عند تجاوزها تظهر رسالة للمستخدم. ويمكنك خفض `HOURLY_LIMIT`.
- راجع شروط Google بخصوص خصوصية المحتوى المرسل عبر الخطة المجانية.
- لا ترفع ملف `.env` إلى GitHub.
