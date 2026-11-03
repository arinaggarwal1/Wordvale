export const themes = [
    { id: "reading", name: "Reading Room", description: "Warm paper and sage", colors: ["#faf8f3", "#e5e8df", "#426c59"] },
    { id: "paper", name: "Paper", description: "Soft neutral and slate", colors: ["#faf9f6", "#e9ecec", "#426987"] },
    { id: "graphite", name: "Graphite", description: "Deep green charcoal", colors: ["#17211f", "#273432", "#a8d7b7"] },
    { id: "midnight", name: "Midnight", description: "Quiet ink blue", colors: ["#172433", "#28394b", "#a8d0ed"] },
    { id: "dusk", name: "Dusk", description: "Muted plum at night", colors: ["#251e29", "#392f3d", "#d4b4df"] },
    { id: "light", name: "Light", description: "Neutral light with plum", colors: ["#f5f5f5", "#e5e5e5", "#705681"] },
    { id: "dark", name: "Dark", description: "Neutral charcoal with deep plum", colors: ["#191919", "#292929", "#5b456f"] },
    { id: "amber", name: "Amber", description: "Charcoal with warm gold", colors: ["#181818", "#292929", "#ffcc3d"] },
] as const;
export type ThemeId = typeof themes[number]["id"];
const storageKey = "wordvale.theme";
export function getTheme(): ThemeId {
    try {
        const saved = localStorage.getItem(storageKey) ?? localStorage.getItem("whisper" + "desk.theme");
        return themes.find((theme) => theme.id === saved)?.id ?? "reading";
    } catch { return "reading"; }
}
export function applyTheme(theme: ThemeId): void {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(storageKey, theme); } catch { /* Theme still applies for this session. */ }
}
