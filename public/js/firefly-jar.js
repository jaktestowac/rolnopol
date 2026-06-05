const JAR = document.getElementById("jar");
const FETCH_INTERVAL = 8000; // ms
const WINDOW_SEC = 60; // look‑back window for the count endpoint
// Mocked base number of fireflies to ensure the jar is never empty
const MOCK_BASE_COUNT = 15;

async function fetchCount() {
  try {
    const resp = await fetch(`/api/v1/notifications/count?windowSec=${WINDOW_SEC}`);
    const data = await resp.json();
    // Assuming response format: { data: { count, windowSec } } or plain { count, windowSec }
    if (data && typeof data === "object") {
      if ("data" in data && typeof data.data.count === "number") return data.data.count;
      if ("count" in data && typeof data.count === "number") return data.count;
    }
  } catch (e) {
    // ignore errors – fallback to mock
  }
  // Return 0 if request fails; the render will add the mock base count.
  return 0;
}

function createFirefly(options = { color: "yellow" }) {
  const el = document.createElement("div");
  el.className = "firefly";
  // Store color for later selection
  el.setAttribute("data-color", options.color);
  // random start position
  el.style.left = Math.random() * 100 + "vw";
  el.style.top = Math.random() * 100 + "vh";
  // random drift direction via CSS custom properties
  const dx = (Math.random() - 0.5) * 200; // px
  const dy = (Math.random() - 0.5) * 200;
  el.style.setProperty("--dx", `${dx}px`);
  el.style.setProperty("--dy", `${dy}px`);
  // random size between 6px and 12px
  const size = Math.random() * 6 + 6; // 6‑12px
  el.style.setProperty("--size", `${size}px`);
  // random animation duration between 5s and 12s
  const duration = Math.random() * 7 + 5; // seconds
  el.style.setProperty("--duration", `${duration}s`);

  switch (options.color) {
    case "red":
      el.style.backgroundColor = "rgba(238, 77, 56, 0.8)";
      el.style.setProperty("--hue", `${Math.random() * 20 - 10}deg`);
      el.style.background = "rgba(245, 67, 67, 0.8)";
      el.style.boxShadow = "0 0 12px rgba(255, 121, 117, 0.9)";
      break;
    case "blue":
      el.style.backgroundColor = "rgba(100, 149, 237, 0.8)";
      el.style.setProperty("--hue", `${Math.random() * 40 - 20}deg`);
      el.style.background = "rgba(100, 149, 237, 0.8)";
      el.style.boxShadow = "0 0 12px rgba(135, 206, 250, 0.9)";
      break;
    case "yellow":
    default:
      el.style.backgroundColor = "rgba(255, 255, 150, 0.8)";
      el.style.setProperty("--hue", `${Math.random() * 40 - 20}deg`);
      el.style.background = "rgba(255, 255, 150, 0.8)";
      el.style.boxShadow = "0 0 12px rgba(255, 255, 200, 0.9)";
      break;
  }

  JAR.appendChild(el);
  // Keep firefly elements alive for continuous animation; removal is handled by syncFireflies when needed.
}

/**
 * Ensure the DOM contains exactly `desired` firefly elements.
 * Existing fireflies are left untouched (they keep their infinite animation),
 * new ones are added, and excess ones are removed.
 */
/**
 * Synchronize firefly elements for each color group.
 * `data` is an array of objects: { count, options: { color } }.
 * The function ensures that the number of fireflies of each color matches the desired count.
 */
function syncFireflies(data) {
  // Build a map of current counts per color
  const currentCounts = {};
  for (const d of data) {
    const color = d.options && d.options.color ? d.options.color : "yellow";
    currentCounts[color] = 0;
  }

  for (const child of JAR.children) {
    const color = child.getAttribute("data-color") || "yellow";
    if (color in currentCounts) currentCounts[color]++;
  }

  // Process each requested group
  for (const { count, options } of data) {
    const color = options && options.color ? options.color : "yellow";
    const current = currentCounts[color] || 0;
    if (current < count) {
      for (let i = 0; i < count - current; i++) {
        createFirefly(options);
      }
    } else if (current > count) {
      // Remove excess fireflies of this color from the end of the container
      let removed = 0;
      for (let i = JAR.children.length - 1; i >= 0 && removed < current - count; i--) {
        const child = JAR.children[i];
        if ((child.getAttribute("data-color") || "yellow") === color) {
          child.remove();
          removed++;
        }
      }
    }
    // Update the map for subsequent iterations (not strictly needed here)
    currentCounts[color] = count;
  }
}

async function render() {
  const count = await fetchCount();
  // Ensure there is always a base number of fireflies for visual effect
  const fireflyCount = Math.min(MOCK_BASE_COUNT, 100);
  const fireflyRedCount = count;
  // randomize blue count for visual interest (remove or set to 0 if not desired)
  const fireflyBlueCount = Math.floor(Math.random() * 3); // 0‑2 random blue fireflies

  // Instead of clearing the container, sync the number of elements.
  syncFireflies([
    { count: fireflyCount, options: { color: "yellow" } },
    { count: fireflyRedCount, options: { color: "red" } },
    { count: fireflyBlueCount, options: { color: "blue" } },
  ]);
}

render();
setInterval(render, FETCH_INTERVAL);
