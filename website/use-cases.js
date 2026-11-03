const caseTabs = [...document.querySelectorAll('.case-tabs [role="tab"]')];
function selectCase(tab, focus = false) {
  caseTabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden =
      !selected;
  });
  if (focus) tab.focus();
}
caseTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectCase(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % caseTabs.length;
    if (event.key === "ArrowLeft")
      next = (index - 1 + caseTabs.length) % caseTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = caseTabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectCase(caseTabs[next], true);
    }
  });
});
