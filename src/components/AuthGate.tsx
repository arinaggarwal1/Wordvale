import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, getAdditionalUserInfo, onAuthStateChanged, sendEmailVerification, reload, signOut, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithCredential, type User } from "firebase/auth";
import { AudioWaveform } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { auth } from "../firebase";
import { applyTheme, getTheme, themes, type ThemeId } from "../themes";
import "./auth.css";

function message(error: unknown): string {
    const code = (error as { code?: string }).code;
    switch (code) {
        case "auth/invalid-credential": return "Email or password is incorrect.";
        case "auth/email-already-in-use": return "An account already exists for this email.";
        case "auth/weak-password": return "Choose a password with at least 6 characters.";
        case "auth/invalid-email": return "Enter a valid email address.";
        case "auth/network-request-failed": return "Couldn't connect. Check your internet connection and try again.";
        case "auth/popup-closed-by-user": return "Google sign-in was closed before it finished.";
        case "auth/too-many-requests": return "Too many attempts. Please try again later.";
        default: return "Something went wrong. Please try again.";
    }
}

export default function AuthGate({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null | undefined>(undefined);
    const [mode, setMode] = useState<"login" | "signup">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [verificationNotice, setVerificationNotice] = useState("");
    const [verificationBusy, setVerificationBusy] = useState(false);
    const [verified, setVerified] = useState(false);
    const [choosingTheme, setChoosingTheme] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState<ThemeId>(getTheme);
    useEffect(() => onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setVerified(Boolean(nextUser?.emailVerified)); }), []);
    const run = async (action: () => Promise<unknown>) => {
        setBusy(true); setNotice("");
        try { await action(); } catch (error) { setNotice(message(error)); } finally { setBusy(false); }
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        void run(async () => { if (mode === "login") return signInWithEmailAndPassword(auth, email.trim(), password); const result = await createUserWithEmailAndPassword(auth, email.trim(), password); setChoosingTheme(true); try { await sendEmailVerification(result.user); } catch { setVerificationNotice("Could not send the verification email. Please try again below."); } return result; });
    };
    if (user === undefined) return <div className="auth-loading">Opening Wordvale…</div>;
    if (user && busy) return <div className="auth-loading">Opening Wordvale…</div>;
    if (user && !verified && user.providerData.some(provider => provider.providerId === "password")) return <main className="auth-page"><section className="auth-intro"><div className="auth-brand"><AudioWaveform size={24}/><span>wordvale</span></div><div className="auth-visual"><div className="auth-visual-caption">Check your inbox.</div></div></section><section className="auth-content"><div className="auth-form"><h2>Verify your email</h2><p className="verify-description">We sent a verification link to <strong>{user.email}</strong>. Open it, then return here.</p>{verificationNotice && <p className="auth-notice" role="status">{verificationNotice}</p>}<button className="auth-submit" disabled={verificationBusy} onClick={async () => { setVerificationBusy(true); setVerificationNotice(""); try { await reload(user); if (user.emailVerified) setVerified(true); else setVerificationNotice("Your email isn’t verified yet. Open the link in your inbox, then try again."); } catch { setVerificationNotice("Could not check verification. Check your connection and try again."); } finally { setVerificationBusy(false); } }}>I’ve verified my email</button><div className="verify-actions"><button disabled={verificationBusy} onClick={async () => { setVerificationBusy(true); try { await sendEmailVerification(user); setVerificationNotice("Verification email sent. Check your inbox and spam folder."); } catch { setVerificationNotice("Could not send the email. Please wait a moment and try again."); } finally { setVerificationBusy(false); } }}>Resend email</button><button disabled={verificationBusy} onClick={() => void signOut(auth)}>Use another account</button></div></div></section></main>;
    if (user && choosingTheme) return <main className="theme-onboarding"><div className="theme-onboarding-inner"><div className="theme-onboarding-header"><div className="theme-onboarding-brand"><AudioWaveform size={20} /> wordvale</div><span>Appearance</span></div><div className="theme-onboarding-body"><div className="theme-onboarding-copy"><h1>Make it yours.</h1><p>Choose a theme to get started. You can change it anytime in Settings.</p><fieldset className="theme-choices"><legend>Choose a theme</legend><div className="theme-choice-grid">{themes.map(theme => <label key={theme.id} className={`theme-choice${selectedTheme === theme.id ? " selected" : ""}`}><input type="radio" name="onboarding-theme" checked={selectedTheme === theme.id} onChange={() => { setSelectedTheme(theme.id); applyTheme(theme.id); }} /><span className="theme-choice-colors" aria-hidden="true">{theme.colors.map(color => <span key={color} style={{background: color}} />)}</span><span>{theme.name}</span></label>)}</div></fieldset><button className="theme-continue" onClick={() => setChoosingTheme(false)}>Continue to Wordvale <span aria-hidden="true">→</span></button></div><div className="theme-preview-window" aria-hidden="true"><div className="theme-preview-top"><span /><span /><span /></div><div className="theme-preview-layout"><div className="theme-preview-nav"><AudioWaveform size={20}/><i /><i /><i /></div><div className="theme-preview-main"><div className="theme-preview-line short"/><div className="theme-preview-line"/><div className="theme-preview-recording"><AudioWaveform size={36}/><span /></div><div className="theme-preview-line"/><div className="theme-preview-line short"/></div></div></div></div></div></main>;
    if (user) return <>{children}</>;
    return <main className="auth-page"><section className="auth-intro"><div className="auth-brand"><AudioWaveform size={24}/><span>wordvale</span></div><div className="auth-visual"><div className="auth-visual-caption">A space for your words</div><div className="auth-recording-card" aria-hidden="true"><div className="auth-recording-top"><span></span><span></span><span></span></div><div className="auth-waveform">{[20,32,48,28,60,38,70,44,58,30,50,24,38,18,32,16].map((height, index) => <i key={index} style={{height}} />)}</div><div className="auth-recording-lines"><span/><span/><span/></div></div></div></section><section className="auth-content"><div className="auth-form"><h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2><button className="auth-google" disabled={busy} onClick={() => void run(async () => { if ("__TAURI__" in window) { const token = await invoke<string>("google_browser_sign_in"); const result = await signInWithCredential(auth, GoogleAuthProvider.credential(token)); if (getAdditionalUserInfo(result)?.isNewUser) setChoosingTheme(true); return result; } const result = await signInWithPopup(auth, new GoogleAuthProvider()); if (getAdditionalUserInfo(result)?.isNewUser) setChoosingTheme(true); return result; })}><span className="google-mark">G</span> Continue with Google</button><div className="auth-divider"><span>or continue with email</span></div><form onSubmit={submit}><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required/><div className="auth-label-row"><label htmlFor="auth-password">Password</label>{mode === "login" && <button type="button" onClick={() => { if (!email.trim()) { setNotice("Enter your email address first."); return; } void run(async () => { await sendPasswordResetEmail(auth, email.trim()); setNotice("If an account exists for that email, a reset link is on its way."); }); }}>Forgot password?</button>}</div><input id="auth-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} value={password} onChange={e => setPassword(e.target.value)} required/>{notice && <p className="auth-notice" role="status">{notice}</p>}<button className="auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form><p className="auth-switch">{mode === "login" ? "New to Wordvale?" : "Already have an account?"} <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setNotice(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></p></div></section></main>;
}
