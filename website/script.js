const root = document.documentElement,
  reduced = matchMedia("(prefers-reduced-motion: reduce)");
const palettes = ["reading", "paper", "dusk", "midnight"];
function setTheme(theme) {
  if (!palettes.includes(theme)) return;
  root.dataset.theme = theme;
  document.querySelectorAll(".swatch").forEach((b) => {
    b.classList.toggle("selected", b.dataset.theme === theme);
    b.setAttribute("aria-pressed", String(b.dataset.theme === theme));
  });
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(
    root,
  )
    .getPropertyValue("--bg")
    .trim();
}
try {
  setTheme(localStorage.getItem("wordvale-site-theme"));
} catch {}
document.querySelectorAll(".swatch").forEach((b) =>
  b.addEventListener("click", () => {
    setTheme(b.dataset.theme);
    try {
      localStorage.setItem("wordvale-site-theme", b.dataset.theme);
    } catch {}
    document.querySelector("#announcement").textContent =
      b.dataset.theme + " theme selected";
  }),
);
const bars = document.querySelector(".sound-bars");
Array.from({ length: 25 }, (_, i) => {
  const el = document.createElement("i");
  el.style.setProperty(
    "--h",
    12 + Math.sin(i * 0.8) ** 2 * 60 + Math.sin(i * 0.3) ** 2 * 20 + "px",
  );
  el.style.setProperty("--o", 0.3 + Math.sin(i * 0.6) ** 2 * 0.7);
  el.style.setProperty("--d", i * -0.07 + "s");
  bars.append(el);
});
let state = "ready",
  start = 0,
  elapsed = 0,
  frame = 0;
const path = document.querySelector("#wave-path"),
  timer = document.querySelector("#timer"),
  button = document.querySelector("#record-button");
function format(s) {
  return (
    String(Math.floor(s / 60)).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
}
function draw(now) {
  const t = now / 1000,
    a = state === "recording" ? 1 : 0.18;
  const top = 37 + Math.sin(t * 2.3) * 13 * a,
    bottom = 120 + Math.cos(t * 2) * 12 * a,
    peak = 20 + Math.sin(t * 2.9 + 1) * 14 * a,
    low = 108 + Math.sin(t * 2.1 + 2) * 16 * a;
  path.setAttribute(
    "d",
    `M24 79 C51 79 31 ${top} 57 ${top} S68 ${bottom} 95 ${bottom} S102 ${peak} 128 ${peak} S138 ${low} 162 ${low} S173 66 204 66`,
  );
  if (state === "recording") {
    elapsed = Math.floor((now - start) / 1000);
    timer.textContent = format(elapsed);
    if (elapsed >= 24) showTranscript();
  }
  frame = requestAnimationFrame(draw);
}
function startAnimation() {
  if (!reduced.matches && !document.hidden && !frame)
    frame = requestAnimationFrame(draw);
}
function stopAnimation() {
  cancelAnimationFrame(frame);
  frame = 0;
}
function showTranscript() {
  state = "transcript";
  document.querySelector("#record-view").hidden = true;
  document.querySelector("#transcript-view").hidden = false;
  document.querySelector("#mini-status").textContent = "Complete";
  document.querySelector("#demo-heading").textContent =
    "Your words, ready to use";
  document
    .querySelectorAll("[data-side]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.side === "transcript"),
    );
  button.classList.remove("recording");
  document.querySelector("#announcement").textContent =
    "Demo transcript ready. You can export the sample as a text file.";
}
let reducedTimer;
button.addEventListener("click", () => {
  if (state === "recording") {
    clearInterval(reducedTimer);
    showTranscript();
    return;
  }
  state = "recording";
  start = performance.now();
  elapsed = 0;
  timer.textContent = "00:00";
  button.classList.add("recording");
  document.querySelector("#record-label").textContent = "Stop & transcribe";
  document.querySelector("#mini-status").textContent = "Recording demo";
  document.querySelector("#record-status").textContent =
    "A good conversation is taking shape.";
  if (reduced.matches)
    reducedTimer = setInterval(() => {
      elapsed++;
      timer.textContent = format(elapsed);
      if (elapsed >= 24) {
        clearInterval(reducedTimer);
        showTranscript();
      }
    }, 1000);
});
document.querySelector("#replay-demo").addEventListener("click", () => {
  state = "ready";
  elapsed = 0;
  timer.textContent = "00:00";
  document.querySelector("#transcript-view").hidden = true;
  document.querySelector("#record-view").hidden = false;
  document.querySelector("#mini-status").textContent = "Ready";
  document.querySelector("#demo-heading").textContent =
    "A thought worth keeping";
  document.querySelector("#record-label").textContent = "Try recording";
  document.querySelector("#record-status").textContent =
    "Space for your next good idea.";
  document
    .querySelectorAll("[data-side]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.side === "record"),
    );
});
document.querySelector("#export-demo").addEventListener("click", () => {
  const blob = new Blob(
      [
        "Wordvale — illustrative demo transcript\n\nDesign catch-up\n\n[00:00] What if we made a little more space for the conversation?\n\n[00:08] Less switching between tools. Just record, find the words, and keep going.\n",
      ],
      { type: "text/plain" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "wordvale-demo.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.querySelector("#announcement").textContent =
    "Sample transcript downloaded.";
});
document.addEventListener("visibilitychange", () =>
  document.hidden ? stopAnimation() : startAnimation(),
);
reduced.addEventListener("change", () =>
  reduced.matches ? stopAnimation() : startAnimation(),
);
startAnimation();
