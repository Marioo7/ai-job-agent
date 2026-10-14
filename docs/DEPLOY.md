# رفع المشروع على سيرفر (VPS) + اختيار طريقة الإرسال

> الخلاصة: الـ **frontend** بيترفع على Firebase Hosting، والـ **backend + worker** بيشتغلوا على سيرفر لينكس (VPS) بشكل دائم عن طريق pm2.

## 0) اللي هتحتاجه
1. **VPS** بنظام Ubuntu 22.04 أو 24.04 (1 GB رام يكفي). ده بيتكلف شهريًا والأسعار بتتغير حسب الشركة، فراجع السعر الحالي. ما فيش حاجة مجانية مضمونة 24 ساعة.
2. **دومين أو ساب دومين** يشاور على السيرفر، مثلًا `api.yourdomain.com`. لازم HTTPS، لأن الواجهة على https وGmail OAuth بيرفض http برا localhost. (فيه خدمات ساب دومين مجانية زي DuckDNS؛ راجع شروطها.)
3. المشروع شغال عندك محليًا (Firebase + Telegram + Gmail متوصلين).

## 1) على السيرفر: تجهيز (مرة واحدة)
```bash
ssh root@SERVER_IP
adduser deploy && usermod -aG sudo deploy        # حط باسورد
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx certbot python3-certbot-nginx ufw unzip
npm i -g pm2
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
exit
```
بعد كده ادخل بالمستخدم `deploy`: `ssh deploy@SERVER_IP`

## 2) ارفع الملفات (من جهازك، Git Bash)
```bash
cd ~/Downloads/ai-job-agent
tar --exclude=node_modules --exclude=dist --exclude=.git -czf /tmp/app.tar.gz ai-job-agent
scp /tmp/app.tar.gz deploy@SERVER_IP:/tmp/
```
(الأمر ده بيشمل ملف `.env` بتاعك، وده المقصود لأنك هتعدل عليه بعد شوية.)
على السيرفر:
```bash
sudo mkdir -p /opt/ai-job-agent /opt/secrets /var/lib/ai-job-agent/files
sudo chown -R deploy:deploy /opt/ai-job-agent /opt/secrets /var/lib/ai-job-agent
tar -xzf /tmp/app.tar.gz -C /opt/ai-job-agent --strip-components=1
chmod 700 /opt/secrets /var/lib/ai-job-agent/files
```
ارفع ملف الـ service account لـ Firebase (من جهازك):
```bash
scp C:/keys/firebase.json deploy@SERVER_IP:/opt/secrets/firebase.json
ssh deploy@SERVER_IP "chmod 600 /opt/secrets/firebase.json"
```

## 3) اضبط `.env` على السيرفر
```bash
cd /opt/ai-job-agent && nano .env
```
القيم اللي لازم تبقى كده في الإنتاج (الباقي يفضل زي ما هو عندك):
```
NODE_ENV=production
PORT=8080
TRUST_PROXY=1
FRONTEND_ORIGIN=https://YOUR-PROJECT.web.app
AUTH_MODE=firebase
ALLOWED_EMAILS=your@gmail.com
DB_MODE=firestore
STORAGE_MODE=local
STORAGE_DIR=/var/lib/ai-job-agent/files
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=/opt/secrets/firebase.json
SECRETS_ENCRYPTION_KEY=<نفس المفتاح اللي عندك بالظبط>
OWNER_UID=<من صفحة Integrations>
TELEGRAM_MODE=real
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
GMAIL_MODE=google
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://api.yourdomain.com/api/integrations/gmail/callback
AI_PROVIDER=gemini
AI_API_KEY=...
ALLOW_AUTO_APPLY=false
```
**مهم:** `SECRETS_ENCRYPTION_KEY` لازم يكون نفسه بالظبط، لأن جلسة تليجرام وتوكن Gmail متشفرين بيه في Firestore. ولو غيّرته هتحتاج تسجل دخول تاني. وفي الإنتاج التطبيق بيرفض يشتغل لو `ALLOWED_EMAILS` فاضي أو `AUTH_MODE` مش firebase.

## 4) Build وتشغيل
```bash
cd /opt/ai-job-agent
npm ci
npm run build -w backend && npm run build -w worker
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # هيطبعلك أمر sudo ... انسخه وشغّله، عشان يشتغل بعد إعادة تشغيل السيرفر
```
**قبل ما تشغّل الـ worker على السيرفر:** اقفل الـ worker على جهازك (`Ctrl+C`). نفس جلسة تليجرام ماينفعش تشتغل من مكانين في نفس الوقت (بيحصل خطأ `AUTH_KEY_DUPLICATED`).

تأكد:
```bash
pm2 status                       # الاتنين online
pm2 logs job-backend --lines 30
pm2 logs job-worker --lines 30   # لازم تلاقي telegram_connected
curl http://127.0.0.1:8080/api/health    # {"ok":true}
```

## 5) HTTPS عن طريق nginx
1. في إعدادات الدومين اعمل **A record**: `api` ← عنوان IP السيرفر. استنى شوية.
2. على السيرفر:
```bash
sudo nano /etc/nginx/sites-available/jobagent
```
```
server {
  server_name api.yourdomain.com;
  client_max_body_size 6m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/jobagent /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
curl https://api.yourdomain.com/api/health
```

## 6) ارفع الواجهة (من جهازك)
في `frontend/.env`:
```
VITE_DEMO_MODE=false
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_FIREBASE_...  (زي ما هي)
```
```bash
npm run build -w frontend
firebase deploy --only hosting
```
وبعدين:
- Firebase Console ← Authentication ← Settings ← **Authorized domains**: تأكد إن دومين الـ Hosting موجود.
- Google Cloud ← OAuth client ← أضف في **Authorized redirect URIs**: `https://api.yourdomain.com/api/integrations/gmail/callback`، ثم ادخل الموقع واضغط **Connect Gmail** من جديد.

## 7) اختار طريقة الإرسال
### أ) يدوي (الافتراضي والموصى بيه)
ما تعملش حاجة: `ALLOW_AUTO_APPLY=false`. السيرفر بيجمع الوظايف ويقيّمها، وإنت تدخل **Email approvals** وتراجع وتضغط **Confirm and send**.

### ب) تلقائي (اختياري)
1. على السيرفر في `.env`: `ALLOW_AUTO_APPLY=true` ثم `pm2 restart job-backend --update-env`.
2. في الموقع: **Preferences → Sending mode → Automatic**، واضبط:
   - **Minimum score** (ابدأ بـ 85 أو أعلى)،
   - **Maximum per day** (ابدأ بـ 3 إلى 5)،
   - علّم على الإقرار واضغط Save.

القواعد اللي بتتطبق في التلقائي (مش قابلة للتجاوز من الإعدادات):
- بيتعامل بس مع وظايف ظهرت **بعد** ما فعّلته (مش الأرشيف القديم).
- لازم الدرجة ≥ الحد، وتعدّي فلاترك، وما تكونش معلّمة "irrelevant".
- لازم **إيميل واحد واضح مكتوب في الإعلان نفسه**؛ لو في أكتر من إيميل أو مفيش، بيتخطّاها وتفضل لك يدويًا.
- النص قالب ثابت من بيانات الـ CV بدون صياغة ذكاء اصطناعي، ولو الاسم ناقص (`[Your name]`) ما بيبعتش.
- نفس الإيميل مرة واحدة كل 7 أيام، والحد اليومي، وبحد أقصى 3 في الدورة.
- **أول فشل في الإرسال بيوقّف الوضع التلقائي** (من غير إعادة محاولة)، وبتلاقي ده في سجل الأنشطة.
- شريط على Dashboard بيقولك إنه شغال وفيه زر **Pause**.

إيقافه: اختار Manual ثم Save، أو زر Pause، أو (إيقاف كامل) `ALLOW_AUTO_APPLY=false` ثم `pm2 restart job-backend --update-env`.

**نصيحتي:** اشتغل يدوي أسبوع الأول وشوف جودة المطابقة والمسودات، وبعدين فعّل التلقائي بحد أدنى عالي وحد يومي صغير. لو شغلت التلقائي فإنت المسؤول عن اللي بيتبعت من حسابك، وممكن إعلان يتفهم غلط أو إيميل مش تبع شركة حقيقية. راجع **Applications** يوميًا.

## 8) تحديث الكود بعدين
بعد ما تستبدل الملفات المعدلة على السيرفر (scp):
```bash
cd /opt/ai-job-agent && npm ci
npm run build -w backend && npm run build -w worker
pm2 restart all
```
(لو غيّرت في frontend: `npm run build -w frontend && firebase deploy --only hosting` من جهازك.)

## 9) صيانة
- **نسخ احتياطي:** فولدر `/var/lib/ai-job-agent/files` (ملفات الـ CV). باقي البيانات في Firestore.
- **المراقبة:** صفحة Dashboard فيها حالة الـ worker، ولو وقف بيظهر شريط أحمر. `pm2 logs` للتفاصيل.
- **الأمان:** ما تفتحش بورت 8080 للخارج (nginx بس)، وما تشاركش `.env` أو `/opt/secrets`.
