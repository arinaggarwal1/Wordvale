// Keep release metadata fresh without embedding a version or a GitHub token.
// Links always use GitHub's latest redirect, even if this lookup fails.
(() => {
  let pending = false;
  async function refreshRelease() {
    if (pending || document.hidden) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(
        "https://api.github.com/repos/arinaggarwal1/Wordvale/releases/latest",
        {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/vnd.github+json" },
        },
      );
      if (!response.ok) return;
      const release = await response.json();
      if (
        release.draft ||
        typeof release.tag_name !== "string" ||
        !release.tag_name.trim()
      )
        return;
      const version = release.tag_name.replace(/^v(?=\d)/, "");
      document.querySelectorAll("[data-release-version]").forEach((el) => {
        el.textContent = version;
        el.setAttribute("aria-label", `View latest release: ${version}`);
      });
      const stage = /alpha/i.test(version)
        ? "Alpha release"
        : /beta/i.test(version)
          ? "Beta release"
          : release.prerelease || /-rc[.\d-]/i.test(version)
            ? "Preview release"
            : "Latest release";
      document.querySelectorAll("[data-release-stage]").forEach((el) => {
        el.textContent = stage;
      });
    } catch {
      // The static latest-release links remain usable offline or when rate limited.
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  }
  refreshRelease();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshRelease();
  });
  setInterval(refreshRelease, 5 * 60 * 1000);
})();
