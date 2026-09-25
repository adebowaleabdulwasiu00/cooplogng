import { initializeApp } from 'firebase/app'
import { getFirestore, collection, query, where, getDocs, limit, doc, getDoc, addDoc, updateDoc, setDoc, deleteDoc, orderBy, startAfter, Timestamp, serverTimestamp, writeBatch, runTransaction, arrayUnion, arrayRemove } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every((value) => typeof value === 'string' && value.trim() !== '')
}

let dbInstance = null
let authInstance = null
let googleProviderInstance = null

export function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error('Firebase web configuration is missing. Add your values to .env.local.')
  }

  if (!dbInstance) {
    const app = initializeApp(firebaseConfig)
    dbInstance = getFirestore(app)
    authInstance = getAuth(app)
    googleProviderInstance = new GoogleAuthProvider()
  }

  return dbInstance
}

export function getFirebaseAuth() {
  if (!authInstance) getDb() // ensure initialization
  return { auth: authInstance, googleProvider: googleProviderInstance }
}

export { collection, query, where, getDocs, limit, doc, getDoc, addDoc, updateDoc, setDoc, deleteDoc, orderBy, startAfter, Timestamp, serverTimestamp, writeBatch, runTransaction, arrayUnion, arrayRemove, signInWithPopup, signInWithRedirect, getRedirectResult, signOut }
