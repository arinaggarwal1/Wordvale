import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Public Firebase client configuration; the key is restricted to Firebase Auth APIs.
// https://firebase.google.com/docs/projects/api-keys
export const auth = getAuth(initializeApp({
    apiKey: "AIzaSyDaRU6FS8GEH0wvE9r3L0XyF-UjW34peDk",
    authDomain: "wordvale-auth-20261103.firebaseapp.com",
    projectId: "wordvale-auth-20261103",
    appId: "1:195423666593:web:a68875e6b05bf8b4550be0",
}));
