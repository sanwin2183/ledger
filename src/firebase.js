// ============================================================
// Firebase configuration for 99xBet Partner Ledger
// Project: xbet-tracker
// ============================================================

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyATRVfpMLIXU1N9gCMo8Xjpp-DGO29jxQo",
  authDomain: "xbet-tracker.firebaseapp.com",
  projectId: "xbet-tracker",
  storageBucket: "xbet-tracker.firebasestorage.app",
  messagingSenderId: "748414251011",
  appId: "1:748414251011:web:c9595ab85d0e10019b5e36",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
