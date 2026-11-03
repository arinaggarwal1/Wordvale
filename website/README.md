# Wordvale website

A standalone static product website. No build step or dependencies; all fonts and assets are self-hosted. The desktop app is independent of this directory.

Preview from the repository root:

```sh
python3 -m http.server 4173 --directory website
```

Open http://localhost:4173. Deploy the contents of `website/` to any static host. Production is hosted on Vercel at https://wordvale-seven.vercel.app.

Deploy updates from the repository root:

```sh
vercel deploy website --prod --scope arin-aggarwals-projects
```

The local Vercel project link is ignored by Git.

The recorder is an illustrative interactive demo: it never requests microphone permissions or records visitor audio. It supports a recording-to-transcript flow, sample TXT export, and replay. The four theme previews persist locally. Download buttons point to the latest GitHub release's Apple silicon DMG. Feature content follows the current app; alpha status remains visible.

Release labels are fetched from GitHub’s latest-release API on load, when returning to the page, and every five minutes while visible. Version links and download buttons use GitHub’s `/releases/latest` redirect, so they remain current even if the API is unavailable or rate limited. No token is required or embedded.
