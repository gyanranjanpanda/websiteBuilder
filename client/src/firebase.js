import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "websitebuilder-cb5ac.firebaseapp.com",
  projectId: "websitebuilder-cb5ac",
  storageBucket: "websitebuilder-cb5ac.firebasestorage.app",
  messagingSenderId: "19827447455",
  appId: "1:19827447455:web:29ecb9753ea93cb219b4aa",
  measurementId: "G-KYBZ05GLH6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { auth, provider };
