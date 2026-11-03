import { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { open } from "@tauri-apps/api/shell";
import { invoke } from "@tauri-apps/api/tauri";
import { exit } from "@tauri-apps/api/process";
import { version } from "../../package.json";
import type { BackendDebugEntry } from "../types/models";
import BackendDebugPanel from "./BackendDebugPanel";
import { applyTheme, getTheme, themes, type ThemeId } from "../themes";
import { deleteUser, EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, sendPasswordResetEmail, signOut, updatePassword } from "firebase/auth";
import { auth } from "../firebase";
import * as Dialog from "@radix-ui/react-dialog";

interface UpdateStatus {
    status: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "unavailable" | "error";
    current_version: string | null;
    latest_version: string | null;
    release_tag?: string | null;
    message: string;
    progress: number;
    can_install: boolean;
}
interface Props {
    onBack: () => void;
    logs: BackendDebugEntry[];
    isBackendReady: boolean;
    isUsingMockBackend: boolean;
    error: string | null;
    updateBlocked: boolean;
    focusUpdates?: boolean;
    updateCommand: (command: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export default function SettingsPage({ onBack, updateCommand, updateBlocked, focusUpdates, ...props }: Props) {
    const [update, setUpdate] = useState<UpdateStatus>({ status: "idle", current_version: version, latest_version: null, message: "", progress: 0, can_install: false });
    const [busy, setBusy] = useState(false);
    const [theme, setTheme] = useState<ThemeId>(getTheme);
    const [connectionError, setConnectionError] = useState("");
    const [accountMessage, setAccountMessage] = useState("");
    const [accountBusy, setAccountBusy] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showSignOutDialog, setShowSignOutDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deletePassword, setDeletePassword] = useState("");
    const [deleteError, setDeleteError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const user = auth.currentUser;
    const emailProvider = user?.providerData.some((provider) => provider.providerId === "password") ?? false;
    const googleProvider = user?.providerData.some((provider) => provider.providerId === "google.com") ?? false;

    async function deleteAccount(method: "password" | "google") {
        if (!user || deleting) return;
        if (updateBlocked) { setDeleteError("Save your transcripts and finish active work before deleting your account."); return; }
        setDeleting(true); setDeleteError("");
        try {
            if (method === "password") {
                if (!user.email || !deletePassword) { setDeleteError("Enter your current password."); return; }
                await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, deletePassword));
            } else if ("__TAURI__" in window) {
                const token = await invoke<string>("google_browser_sign_in");
                await reauthenticateWithCredential(user, GoogleAuthProvider.credential(token));
            } else {
                await reauthenticateWithPopup(user, new GoogleAuthProvider());
            }
            await deleteUser(user);
        } catch (error) {
            const code = (error as { code?: string })?.code;
            setDeleteError(code === "auth/wrong-password" || code === "auth/invalid-credential" ? "The password or Google account does not match this account." : code === "auth/popup-closed-by-user" ? "Google verification was cancelled. Your account was not deleted." : "Could not delete your account. Check your connection and try again.");
        } finally { setDeleting(false); }
    }

    async function resetAccountPassword() {
        if (!user?.email) return;
        setAccountBusy(true); setAccountMessage("");
        try { await sendPasswordResetEmail(auth, user.email); setAccountMessage("If an account exists for this email, a password reset link is on its way."); }
        catch { setAccountMessage("Could not send a reset email. Check your connection and try again."); }
        finally { setAccountBusy(false); }
    }
    async function changeAccountPassword(event: React.FormEvent) {
        event.preventDefault();
        if (!user || !user.email) return;
        if (newPassword.length < 6) { setAccountMessage("Choose a password with at least 6 characters."); return; }
        if (newPassword !== confirmPassword) { setAccountMessage("The new passwords do not match."); return; }
        setAccountBusy(true); setAccountMessage("");
        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
            setAccountMessage("Your password has been updated.");
        } catch (error) {
            setAccountMessage((error as { code?: string }).code === "auth/wrong-password" || (error as { code?: string }).code === "auth/invalid-credential" ? "Current password is incorrect." : "Could not update your password. Try signing in again or use password reset.");
        } finally { setAccountBusy(false); }
    }
    const isDesktop = "__TAURI__" in window && !props.isUsingMockBackend;

    useEffect(() => {
        if (focusUpdates) document.getElementById("settings-updates")?.scrollIntoView({ block: "start" });
    }, [focusUpdates]);

    useEffect(() => {
        if (!isDesktop || !props.isBackendReady) return;
        let cancelled = false;
        async function refresh() {
            try {
                const response = await updateCommand("update_status");
                if (!cancelled && response.update) { setUpdate(response.update as unknown as UpdateStatus); setConnectionError(""); }
            } catch {
                if (!cancelled) setConnectionError("Could not reach the update service. Trying again…");
            }
        }
        void refresh();
        const timer = window.setInterval(refresh, 1500);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [isDesktop, props.isBackendReady, updateCommand]);

    async function perform(command: string, params?: Record<string, unknown>) {
        setBusy(true); setConnectionError("");
        try {
            const response = await updateCommand(command, params);
            if (response.update) setUpdate(response.update as unknown as UpdateStatus);
            return true;
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : String(error));
            return false;
        } finally { setBusy(false); }
    }
    async function check() {
        setUpdate((previous) => ({ ...previous, status: "checking", message: "Checking GitHub…" }));
        await perform("update_check", { current_version: version });
    }
    async function install() {
        if (updateBlocked) return;
        try {
            const appPid = await invoke<number>("app_process_id");
            if (await perform("update_install", { app_pid: appPid })) await exit(0);
        } catch (error) { setConnectionError(`Could not restart: ${String(error)}`); }
    }
    const working = busy || ["checking", "downloading", "installing"].includes(update.status);
    return <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface-950 p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
            <button onClick={onBack} className="page-back"><ArrowLeft className="h-4 w-4" /> Back to transcription</button>
        <div className="w-full">
            <h2 className="text-3xl font-bold text-surface-100">Settings</h2>

            <section className="appearance-section settings-section" aria-labelledby="appearance-title">
                <div className="appearance-heading"><div><h3 id="appearance-title">Appearance</h3><p>Choose a theme for your workspace.</p></div></div>
                <div className="theme-grid" role="radiogroup" aria-label="Appearance theme">
                    {themes.map((item) => <label key={item.id} className={`theme-option${theme === item.id ? " is-selected" : ""}`}>
                        <input className="sr-only" type="radio" name="appearance-theme" value={item.id} checked={theme === item.id} onChange={() => { setTheme(item.id); applyTheme(item.id); }} />
                        <span className="theme-preview" style={{ background: item.colors[0], borderColor: item.colors[1] }}><span style={{ background: item.colors[1] }} /><span style={{ background: item.colors[2] }} /></span>
                        <span className="theme-option-copy"><strong>{item.name}</strong><span>{item.description}</span></span><span className="theme-radio" aria-hidden="true" />
                    </label>)}
                </div>
            </section>
            <section className="card p-5 settings-section" aria-labelledby="account-title">
                <h3 id="account-title" className="text-base font-semibold text-surface-100">Account</h3>

                <div className="mt-5 flex max-w-xl items-center gap-3 border-b border-surface-800 pb-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-850 text-sm font-semibold text-surface-200" aria-hidden="true">{(user?.email?.[0] || "A").toUpperCase()}</div>
                    <div className="min-w-0"><p className="break-all text-sm font-semibold text-surface-100">{user?.email ?? "No signed-in account"}</p>
                    <p className="mt-1 text-xs text-surface-400">Signed in with {[emailProvider && "Email and password", googleProvider && "Google"].filter(Boolean).join(" · ") || "Unknown provider"}</p></div>
                </div>
                {emailProvider && <form className="mt-5 grid gap-3 max-w-lg" onSubmit={changeAccountPassword}>
                    <h4 className="text-sm font-semibold text-surface-100">Change password</h4>
                    <label className="grid gap-1 text-xs text-surface-300">Current password<input className="rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                    <label className="grid gap-1 text-xs text-surface-300">New password<input className="rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm" type="password" autoComplete="new-password" minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                    <label className="grid gap-1 text-xs text-surface-300">Confirm new password<input className="rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm" type="password" autoComplete="new-password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
                    <div className="flex flex-wrap gap-3"><button className="btn-primary text-xs" disabled={accountBusy}>Update password</button><button type="button" className="btn-ghost text-xs" disabled={accountBusy || !user?.email} onClick={() => void resetAccountPassword()}>Send password reset email</button></div>
                </form>}
                {!emailProvider && googleProvider && <div className="mt-4 max-w-xl"><h4 className="text-sm font-semibold text-surface-100">Password</h4><p className="mt-1 text-xs leading-relaxed text-surface-400">Your password is managed by Google.</p><button type="button" className="btn-secondary mt-3 text-xs" disabled={accountBusy || !user?.email} onClick={() => void resetAccountPassword()}>Add or reset email password</button></div>}
                {accountMessage && <p role="status" className="mt-3 rounded-md bg-surface-900/50 px-3 py-2 text-xs text-surface-300">{accountMessage}</p>}
                <div className="mt-5 flex max-w-xl flex-wrap items-center gap-3 border-t border-surface-800 pt-4"><button className="btn-secondary text-xs" onClick={() => { if (updateBlocked) { setAccountMessage("Save your transcripts and finish active work before signing out."); return; } setShowSignOutDialog(true); }}>Sign out</button><button className="btn-ghost text-xs" onClick={() => { setDeleteError(""); setDeletePassword(""); setShowDeleteDialog(true); }}>Delete account</button></div>
            </section>
            <section id="settings-updates" className="card p-5 settings-section" aria-labelledby="settings-updates-title">
                <h3 id="settings-updates-title" className="text-base font-semibold text-surface-100">Updates</h3>
                <p className="text-xs text-surface-400 mt-2">Current version: {version}{update.latest_version && update.latest_version !== version ? ` · Latest: ${update.latest_version}` : ""}</p>
                <p className="text-xs text-surface-400 mt-1">Updates are verified before installation. The app will restart to finish.</p>
                {!isDesktop && <p className="text-xs text-surface-400 mt-2">Open the desktop app to check for updates.</p>}
                {isDesktop && update.status === "available" && !update.can_install && <p className="text-xs text-warning-400 mt-2">Automatic installation is available in the installed Apple silicon app in a writable location. Use the release page to update this build.</p>}
                <div className="flex flex-wrap items-center gap-3 mt-4">
                    <button className="btn-primary text-xs" onClick={check} disabled={!isDesktop || !props.isBackendReady || working || update.status === "ready"}>
                        <RefreshCw className={`w-4 h-4 ${update.status === "checking" ? "animate-spin" : ""}`} />{update.status === "checking" ? "Checking…" : "Check for updates"}
                    </button>
                    {update.status === "available" && update.can_install && <button className="btn-ghost text-xs" onClick={() => void perform("update_download")} disabled={working}><Download className="w-4 h-4" /> Download update</button>}
                    {update.status === "ready" && <button className="btn-primary text-xs" onClick={install} disabled={working || updateBlocked}><RotateCw className="w-4 h-4" /> Install and restart</button>}
                    {(update.status === "available" || update.status === "unavailable" || update.status === "error") && <button className="btn-ghost text-xs" onClick={() => void open(update.release_tag ? `https://github.com/arinaggarwal1/Wordvale/releases/tag/${encodeURIComponent(update.release_tag)}` : "https://github.com/arinaggarwal1/Wordvale/releases")}><ExternalLink className="w-4 h-4" /> Open release</button>}
                </div>
                {update.status === "ready" && updateBlocked && <p className="text-xs text-warning-400 mt-3">Finish active work and save all transcripts before installing.</p>}
                {update.status === "downloading" && <div className="mt-4"><div className="h-1.5 rounded-full bg-surface-800 overflow-hidden"><div className="h-full bg-accent-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, update.progress))}%` }} /></div><p className="text-xs text-surface-400 mt-1">{update.progress}%</p></div>}
                <p role="status" className="text-xs text-surface-300 mt-3">{connectionError || update.message}</p>
            </section>
            <div className="settings-section"><BackendDebugPanel {...props} /></div>
        </div>
        <Dialog.Root open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
                    <Dialog.Title className="text-base font-semibold text-surface-100">Sign out of Wordvale?</Dialog.Title>
                    <Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">Your local library stays on this Mac. Any unsaved transcripts in the queue will be lost.</Dialog.Description>
                    <div className="mt-6 flex justify-end gap-3">
                        <Dialog.Close asChild><button className="btn-ghost text-sm">Cancel</button></Dialog.Close>
                        <button className="rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-500" onClick={async () => { try { await signOut(auth); setShowSignOutDialog(false); } catch { setAccountMessage("Could not sign out. Please try again."); } }}>Sign out</button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
        <Dialog.Root open={showDeleteDialog} onOpenChange={(open) => { if (!deleting) { setShowDeleteDialog(open); if (!open) { setDeletePassword(""); setDeleteError(""); } } }}>
            <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none" onEscapeKeyDown={(event) => { if (deleting) event.preventDefault(); }} onPointerDownOutside={(event) => { if (deleting) event.preventDefault(); }}>
                    <Dialog.Title className="text-base font-semibold text-surface-100">Delete your account?</Dialog.Title>
                    <Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">This permanently deletes your Wordvale account and signs you out. Your recordings, transcripts, and local library remain on this Mac. Save any unsaved work before continuing.</Dialog.Description>
                    {emailProvider && <label className="mt-4 grid gap-2 text-xs text-surface-300">Current password<input type="password" autoComplete="current-password" className="input-field" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} disabled={deleting} /></label>}
                    {googleProvider && <p className="mt-4 text-xs text-surface-400">{emailProvider ? "Or verify with Google." : "You’ll verify your Google account before deletion."}</p>}
                    {deleteError && <p role="alert" className="mt-3 text-xs text-danger-500">{deleteError}</p>}
                    <div className="mt-6 flex flex-wrap justify-end gap-2"><Dialog.Close asChild><button className="btn-ghost text-xs" disabled={deleting}>Cancel</button></Dialog.Close>{emailProvider && <button className="rounded-lg bg-danger-600 px-4 py-2 text-xs font-semibold text-white hover:bg-danger-500 disabled:opacity-50" disabled={deleting || !deletePassword} onClick={() => void deleteAccount("password")}>{deleting ? "Deleting…" : "Delete account"}</button>}{googleProvider && <button className="rounded-lg bg-danger-600 px-4 py-2 text-xs font-semibold text-white hover:bg-danger-500 disabled:opacity-50" disabled={deleting} onClick={() => void deleteAccount("google")}>{deleting ? "Verifying…" : "Verify with Google and delete"}</button>}</div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
        </div>
    </main>;
}
