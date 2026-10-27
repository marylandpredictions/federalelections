(function () {
  // One nationwide target: midnight Eastern, November 3 (05:00 UTC after DST ends).
  // Date.now uses the visitor's clock; no locale-dependent timestamp parsing.
  const target = Date.parse("2026-11-03T00:00:00-05:00");
  function update() {
    const remaining = Math.max(0, target - Date.now());
    const minutes = Math.floor(remaining / 60000);
    for (const [id, value] of [
      ["days", Math.floor(minutes / 1440)],
      ["hours", Math.floor(minutes / 60) % 24],
      ["minutes", minutes % 60],
    ])
      document.getElementById(`countdown-${id}`).textContent = String(
        value,
      ).padStart(2, "0");
    if (!remaining) {
      document.getElementById("countdown-title").textContent =
        "Election Day 2026";
      document.getElementById("countdown-digits").hidden = true;
      document.getElementById("countdown-message").textContent =
        "Live results • Follow election coverage";
    }
  }
  update();
  setInterval(update, 15000);
})();
