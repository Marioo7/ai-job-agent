# تشغيل المشروع أونلاين 24/7 مجانًا وبدون بطاقة بنكية

> آخر مراجعة للأسعار والسياسات: 14 أكتوبر 2026. الشركات بتغيّر خططها كتير، فراجع صفحة كل خدمة قبل ما تبدأ.

## 0) الخلاصة (الحل الموصى بيه)

| الجزء | فين | بطاقة؟ |
|---|---|---|
| الواجهة (React) | **Firebase Hosting** (خطة Spark) | لا |
| تسجيل الدخول + قاعدة البيانات + ملفات الـ CV | **Firebase Spark** (Auth + Firestore) | لا |
| الـ Backend + عامل تليجرام + الإرسال التلقائي | **Render – Free Web Service** (عملية واحدة) | لا |
| إبقاء Render صاحي | **UptimeRobot** (فحص كل 5 دقايق) | لا |
| الكود | **GitHub** (مستودع خاص) | لا |

اللي اتحقق منه في البحث:
- **Render Free:** من غير بطاقة. 750 ساعة تشغيل في الشهر لكل workspace (خدمة واحدة 24/7 بتاخد حوالي 720–744 ساعة، يعني تكفي خدمة واحدة بس). الخدمة **بتنام بعد 15 دقيقة من غير طلبات HTTP** وبتصحى في حوالي دقيقة. القرص مؤقت (بيتمسح مع كل إعادة تشغيل). Render نفسه بيقول إن الخطة المجانية مش للإنتاج.
- **Firebase Spark:** من غير بطاقة. Firestore: 1 جيجا تخزين و50 ألف قراءة و20 ألف كتابة في اليوم. **Cloud Storage بقى يطلب خطة مدفوعة من 3 فبراير 2026**، عشان كده الـ CV هنخزنه جوه Firestore (`STORAGE_MODE=firestore`).
- **UptimeRobot Free:** فحص كل 5 دقايق، لكن شروطه بتقول للاستخدام الشخصي غير التجاري. مشروعك شخصي، فماشي. وبديل: cron-job.org.
- **مستبعد لأنه بيطلب بطاقة/مش مجاني دلوقتي:** Oracle Cloud، Google Cloud، Koyeb (من فبراير 2026)، Northflank، Fly.io (مفيش خطة مجانية)، Railway (رصيد 1$ بس في الشهر).

### مهم تعرفه قبل ما تبدأ
1. **ده اتجرّب عندي محليًا بس** (72 اختبار + تشغيل النسخة المبنية بعامل مدمج). ما اتجرّبش على Render ولا على Firebase ولا على تليجرام الحقيقي من عنوان IP سحابي. لو ظهر خطأ في أول نشر، ابعتلي اللوج.
2. لو Render نام لأي سبب، العامل بيقف، **وأول ما يصحى بيقرأ كل القنوات من آخر رسالة معالجة** (بصفحات 100 رسالة)، فمفيش وظيفة بتضيع، بس ممكن تتأخر.
3. تليجرام ممكن يعتبر الدخول من IP سحابي غريب نشاط مش معتاد وقد يطلب إعادة تسجيل. مفيش ضمان. لو القلق كبير استخدم حساب تليجرام ثانوي.
4. ذاكرة 512 ميجا ومعالج 0.1: الـ build والتشغيل أبطأ، ورفع الـ CV قد ياخد ثواني.

## 1) Firebase (مجاني، من غير بطاقة)

1. https://console.firebase.google.com ← **Add project** (خلّي الخطة Spark، وما تضغطش Upgrade).
2. **Authentication ← Get started ← Sign-in method**: فعّل Email/Password (و/أو Google). من **Users ← Add user** اعمل مستخدمك. **انسخ الـ User UID** من نفس الجدول: ده هو `OWNER_UID`.
3. **Firestore Database ← Create database** (Production mode، أقرب منطقة ليك).
   ما تفعّلش Storage.
4. **Project settings ← General ← Your apps ← Web (</>)**: سجّل تطبيق ويب وانسخ القيم الأربعة (`apiKey`, `authDomain`, `projectId`, `appId`).
5. **Project settings ← Service accounts ← Generate new private key**: احفظ الملف خارج فولدر المشروع (مثلًا `C:/keys/firebase.json`).
6. انشر القواعد والـ indexes من جهازك:
   ```bash
   npm i -g firebase-tools && firebase login
   cp .firebaserc.example .firebaserc      # عدّل اسم المشروع جوه
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   الـ indexes بتاخد دقايق. لحد ما تخلص ممكن تظهر "requires an index".

## 2) المفتاح السري وحزمة الكود

```bash
npm run gen:key        # انسخ الناتج: ده SECRETS_ENCRYPTION_KEY (نفسه لازم يتحط في Render وفي جهازك)
```

ارفع الكود لـ GitHub (مستودع **خاص**):
```bash
cd ~/Downloads/ai-job-agent/ai-job-agent
git init -b main
git add .
git status            # تأكد إن ملف .env وملف الـ service account (JSON) مش في القائمة
git commit -m "job agent"
```
على github.com/new اعمل مستودع Private باسم `job-agent` (من غير README)، وبعدين:
```bash
git remote add origin https://github.com/USERNAME/job-agent.git
git push -u origin main
```

جهّز الـ JSON بتاع Firebase في سطر واحد (هتلزقه في Render):
```bash
node -e "console.log(JSON.stringify(require('C:/keys/firebase.json')))"
```

## 3) Render

1. https://render.com ← سجّل بحساب GitHub (من غير بطاقة).
2. **New + ← Blueprint** ← اختار مستودع `job-agent`. هيقرأ `render.yaml` وهيسألك عن القيم اللي `sync:false`:

| المتغير | القيمة |
|---|---|
| `FRONTEND_ORIGIN` | `https://PROJECT.web.app,https://PROJECT.firebaseapp.com` |
| `ALLOWED_EMAILS` | إيميلك اللي عملته في Firebase |
| `FIREBASE_PROJECT_ID` | Project ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | السطر الواحد اللي طلع من الأمر فوق |
| `SECRETS_ENCRYPTION_KEY` | المفتاح بتاع `gen:key` |
| `OWNER_UID` | الـ User UID من Firebase Authentication |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | من my.telegram.org ← API development tools |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | من Google Cloud (الخطوة 6). لو لسه، سيبهم فاضيين دلوقتي |
| `GOOGLE_OAUTH_REDIRECT_URI` | هتعرفه بعد أول نشر (الخطوة 6) |
| `AI_*` | سيبهم فاضيين (mock)، أو `AI_PROVIDER=gemini` + المفتاح + `AI_MODEL` |

3. اضغط Apply. أول build ممكن ياخد كام دقيقة. بعدها هتاخد رابط زي `https://job-agent-xxxx.onrender.com`.
4. جرّب: افتح `https://job-agent-xxxx.onrender.com/api/health` لازم يرد `{"ok":true}`.
5. في **Logs** لازم تلاقي `worker_embedded_in_backend`. وطالما تليجرام لسه ما اتربطش هتلاقي رسالة `No Telegram session` (طبيعي).

## 4) إبقاء الخدمة صاحية 24/7

1. https://uptimerobot.com ← حساب مجاني ← **Add New Monitor**.
2. Type: **HTTP(s)**، URL: `https://job-agent-xxxx.onrender.com/api/health`، Interval: **5 minutes**.
3. خلاص: لما الفحص بييجي كل 5 دقايق، Render مش بينام (بينام بعد 15 دقيقة من غير طلبات).

لو UptimeRobot رفض/وقف: استخدم cron-job.org (مجاني) بنفس الرابط كل 5 دقايق.

## 5) الواجهة على Firebase Hosting

في `frontend/.env` على جهازك:
```
VITE_DEMO_MODE=false
VITE_API_BASE_URL=https://job-agent-xxxx.onrender.com
VITE_FIREBASE_API_KEY=...   VITE_FIREBASE_AUTH_DOMAIN=...   VITE_FIREBASE_PROJECT_ID=...   VITE_FIREBASE_APP_ID=...
```
```bash
npm run build -w frontend
firebase deploy --only hosting
```
هتاخد `https://PROJECT.web.app`. ادخل بإيميلك وباسوردك.

(بدائل مجانية بدون بطاقة للواجهة: Cloudflare Pages أو Netlify أو Vercel Hobby. بس Firebase Hosting أبسط هنا.)

## 6) Gmail

1. console.cloud.google.com ← مشروع ← **Gmail API** ← Enable. ثم OAuth consent screen (External) وضيف إيميلك في **Test users**.
2. **Credentials ← OAuth client ID ← Web**: Authorized redirect URI = `https://job-agent-xxxx.onrender.com/api/integrations/gmail/callback`.
3. ارجع لـ Render ← Environment وحط `GOOGLE_OAUTH_CLIENT_ID` و`GOOGLE_OAUTH_CLIENT_SECRET` و`GOOGLE_OAUTH_REDIRECT_URI` (نفس الرابط فوق)، واحفظ (هيعيد التشغيل).
4. من الموقع: **Integrations & health ← Connect Gmail ← Test connection**.

(الربط بيفصل كل 7 أيام لو التطبيق في وضع Testing. شوف `docs/GMAIL.md`.)

## 7) تليجرام (مرة واحدة، من جهازك)

الدخول بيتم **من جهازك أنت** (تفاعلي)، والجلسة بتتخزن متشفرة في Firestore، وبعدين Render بيقراها.
اعمل ملف `.env` محلي فيه بس:
```
DB_MODE=firestore
AUTH_MODE=firebase
FIREBASE_PROJECT_ID=...
FIREBASE_SERVICE_ACCOUNT_PATH=C:/keys/firebase.json
SECRETS_ENCRYPTION_KEY=نفس المفتاح اللي في Render
OWNER_UID=...
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
TELEGRAM_MODE=real
```
```bash
npm run telegram:login -w worker        # رقمك + الكود + باسورد التحقق بخطوتين
npm run telegram:dialogs -w worker      # يطبعلك القنوات وأرقامها
```
ما تشغّلش `dev:worker` على جهازك بعد كده (نفس الجلسة مينفعش تشتغل من مكانين). بعد اللوجين Render هياخد الجلسة تلقائيًا في خلال 5 دقايق (أو اعمل Manual Deploy/Restart).
بعدها من الموقع: **Telegram sources ← Add source** ثم **Test connection**.

## 8) طريقة الإرسال: يدوي أو تلقائي

- **يدوي (الافتراضي):** `ALLOW_AUTO_APPLY=false`. تراجع في **Email approvals** وتضغط **Confirm and send**.
- **تلقائي:** في Render غيّر `ALLOW_AUTO_APPLY` إلى `true` (هيعيد التشغيل)، وبعدين في الموقع: **Preferences ← Sending mode ← Automatic**. القواعد: بيتبعت لو في إيميل تقديم واضح وصالح، ولو مفيش إيميل الوظيفة بتتحفظ بس، ومفيش تقديم مكرر، والتفاصيل في `docs/DEPLOY.md` (قسم 7).

## 9) حدود الخطة المجانية (تقديرية، راقبها)

- **Firestore:** العامل بيكتب نبضة كل 60 ثانية (حوالي 1,440 كتابة/يوم) + كتابات الوظائف، وبيقرأ بضع مستندات كل دقيقة. تقديري إجمالي: أقل من نص حدود اليوم (50 ألف قراءة / 20 ألف كتابة) لو عندك كام قناة وعشرات الوظائف يوميًا. شوف **Firestore ← Usage**. لو الحد خلص، العمليات بتفشل لحد ما يتصفّر العدّاد تاني يوم، ومفيش فلوس بتتسحب على Spark.
- **Render:** 750 ساعة لكل الـ workspace؛ ما تشغّلش خدمة مجانية تانية جنبها. لو الساعات خلصت الخدمة بتتوقف لحد أول الشهر الجاي.
- **الملفات:** الـ CV بيتخزن في Firestore (حد 5 ميجا للملف، بيتقسم 500KB للمستند).

## 10) بدائل لو Render مش مناسب

| الخيار | مجاني؟ بدون بطاقة؟ | ملاحظات |
|---|---|---|
| **جهازك أو لابتوب قديم أو تليفون أندرويد (Termux)** شغال طول الوقت | آه/آه | أضمن حل مجاني: شغّل `dev:backend` و`dev:worker` والواجهة على نفس الجهاز. محتاج كهربا وإنترنت ثابت. بدون استضافة. |
| **GitHub Actions** (cron كل 5 دقايق) | آه لو المستودع **عام** (غير محدود) / آه | أقل فاصل 5 دقايق، والتأخير 5–30 دقيقة شائع، وبيتوقف بعد 60 يوم من غير نشاط في المستودع، وكل تشغيل من IP مختلف (مخاطرة مع تليجرام). **مش مطبّق** في المشروع؛ اطلبه لو عايزه. |
| Oracle Cloud / Google Cloud | مجاني ظاهريًا | بيطلبوا بطاقة للتحقق. |
| VPS رخيص | لا | الأكثر ثباتًا، راجع `docs/DEPLOY.md`. |
