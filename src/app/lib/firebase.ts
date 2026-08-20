import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
  type AppCheck,
} from 'firebase/app-check'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth'
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore'
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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyD7b9XKxV0Z7qdcdgMEVuE-fTTIoYsLCpc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'statskey.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'statskey',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'statskey.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1081412767986',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:1081412767986:web:15dbdf5870c78be674c06b',
}

export const firebaseApp: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

export const appCheck: AppCheck | null = getConfiguredAppCheck(firebaseApp)
export const auth: Auth = getConfiguredAuth(firebaseApp)
export const db: Firestore = getConfiguredFirestore(firebaseApp)
export const functions: Functions = getFunctions(firebaseApp)

function getConfiguredAppCheck(app: FirebaseApp): AppCheck | null {
  if (typeof window === 'undefined') return null
  const hostname = window.location.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  ) {
    // Local preview origins cannot satisfy the production reCAPTCHA
    // Enterprise key. Keep App Check enabled on every deployed web origin.
    return null
  }
  const desktopBridge = (window as { statsKeyDesktop?: unknown })
    .statsKeyDesktop
  if (desktopBridge != null && typeof desktopBridge === 'object') {
    // reCAPTCHA Enterprise is a web-origin attestation mechanism and cannot
    // validate the desktop shell's ephemeral localhost origin. Sending no App
    // Check token is preferable to attaching a known-invalid token to Auth and
    // callable requests. Desktop-sensitive operations retain Firebase Auth,
    // server authorization, rate limits, and the privileged preload boundary.
    return null
  }
  try {
    const siteKey =
      import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY ??
      '6LdJD3YtAAAAAOFCat_cVqBoWU5G1IL7qDeFUNEp'
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch {
    // Vite hot reload can revisit this module after App Check is already
    // installed on the Firebase app. The existing installation remains active.
    return null
  }
}

function getConfiguredAuth(app: FirebaseApp): Auth {
  try {
    // Firebase Auth defaults to IndexedDB first. Safari/WebKit can close that
    // database during pagehide and leave sign-in throwing "Database is
    // closing/hidden". Local Storage avoids that broken lifecycle while still
    // preserving sessions; session and memory persistence remain safe
    // fallbacks when storage is unavailable.
    return initializeAuth(app, {
      persistence: [
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
      // `initializeAuth` does not install popup/redirect dependencies unless
      // they are supplied explicitly. Without this resolver both
      // `getRedirectResult` and provider popups throw auth/argument-error.
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  } catch {
    // Hot reload or another module may have initialized Auth first.
    return getAuth(app)
  }
}

function getConfiguredFirestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true })
  } catch {
    return getFirestore(app)
  }
}
