# 99xBet Partner Ledger — Firebase Edition

Real-time shared ledger for 99xBet partners. All amounts in **Myanmar Kyat (MMK)**.

When one partner adds an entry, **everyone else sees it instantly** on their device. When the passcode changes, it changes for everyone.

---

## ⚡ Setup (do this once, ~10 minutes)

### Step 1: Create a Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project**
3. Name it `99xbet-tracker`
4. Disable Google Analytics (not needed)
5. Click **Create project**

### Step 2: Register the web app

1. On your project home, click the **`</>`** (Web) icon
2. Nickname: `99xbet-web`
3. Do **NOT** check "Also set up Firebase Hosting"
4. Click **Register app**
5. **Copy the `firebaseConfig` object shown** — you'll need these values

### Step 3: Enable Firestore Database

1. Sidebar → **Build → Firestore Database**
2. Click **Create database**
3. Choose **Production mode**
4. Pick region: **`asia-southeast1`** (Singapore — closest to Myanmar)
5. Click **Enable**

### Step 4: Set Firestore security rules

1. In Firestore, click the **Rules** tab
2. Replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

3. Click **Publish**

> ⚠️ **Security note:** These rules let anyone with your Firebase config read/write your data. The passcode in the app is the only gate. This is fine for a small trusted partner team. If you need stronger security, switch to Firebase Authentication (ask Claude to upgrade).

### Step 5: Add your config to the code

1. Open `src/firebase.js`
2. Replace each `PASTE_YOUR_..._HERE` with the values from Step 2

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "99xbet-tracker.firebaseapp.com",
  projectId: "99xbet-tracker",
  storageBucket: "99xbet-tracker.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123",
};
```

---

## 🚀 Deploy to GitHub Pages

### Step 1: Create the GitHub repo

1. Go to https://github.com/new
2. Name: `99xbet-tracker` (or whatever you like)
3. Make it **Private** if you want
4. Don't initialize with README
5. **Create repository**

### Step 2: Update the base path

Open `vite.config.js` and change the `base` to match your repo name:

```js
base: '/99xbet-tracker/',  // change to '/YOUR-REPO-NAME/' if different
```

### Step 3: Push to GitHub

In a terminal, from this folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

### Step 4: Enable GitHub Pages

1. On your repo: **Settings → Pages**
2. Source: **GitHub Actions**

### Step 5: Wait ~2 minutes

Watch the **Actions** tab. Once green, your site is live at:

```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

### Step 6: Authorize the domain in Firebase

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **Add domain**
3. Add `YOUR-USERNAME.github.io`

(Even though we're not using Firebase Auth, this is good practice.)

---

## 👥 Sharing with Partners

Just send them the URL and the passcode (`99xbet2026` by default). Anyone with both can:
- Add daily entries
- See live updates from other partners
- View the dashboard and full history

To change the passcode, log in → **Settings → Change Passcode**. The new one applies to everyone.

---

## 🛠 Local Development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## 🏗 Build

```bash
npm run build
```

## 💰 Cost

Firebase free tier handles **50,000 reads / 20,000 writes per day** for free, which is far more than a small partner team will ever use. You don't need a paid plan.

## 🔐 Default Passcode

`99xbet2026` — change it in **Settings** after first login.
