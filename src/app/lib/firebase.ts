import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'

// The Firebase web API key is not a secret. Access is enforced by Firestore
// security rules (see biometrics/firestore.rules) and by domain allow-listing
// in the Firebase console. We still prefer env vars so the project can be
// swapped per environment.
//
// Defaults below match the existing iOS project `statskey` (see
// biometrics/StatsKey/GoogleService-Info.plist). The auth domain is the
// standard Firebase-hosted domain for that project.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBsNYhgdcfwl4sSk7Eg5NAzGhNt8pQCOcs',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'statskey.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'statskey',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'statskey.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1081412767986',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

export const firebaseApp: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

export const auth: Auth = getAuth(firebaseApp)
export const db: Firestore = getFirestore(firebaseApp)
export const functions: Functions = getFunctions(firebaseApp)
