const $ = (sel) => document.querySelector(sel);

const state = {
  capturedImage: null,
  apiKey: localStorage.getItem("oxacheck_api_key") || "",
};

// -- Service Worker Registration --
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

// -- iOS Install Banner --
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

if (isIOS && !isStandalone && !sessionStorage.getItem("install_dismissed")) {
  const banner = $("#install-banner");
  banner.classList.remove("hidden");
  $("#install-dismiss").addEventListener("click", () => {
    banner.classList.add("hidden");
    sessionStorage.setItem("install_dismissed", "1");
  });
}

// -- Settings --
const settingsBtn = $("#settings-btn");
const settingsPanel = $("#settings-panel");
const apiKeyInput = $("#api-key-input");
const saveKeyBtn = $("#save-key-btn");

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) {
    apiKeyInput.value = state.apiKey;
    apiKeyInput.focus();
  }
});

saveKeyBtn.addEventListener("click", () => {
  state.apiKey = apiKeyInput.value.trim();
  localStorage.setItem("oxacheck_api_key", state.apiKey);
  settingsPanel.classList.add("hidden");
});

// -- Photo Capture --
const photoArea = $("#photo-area");
const photoPreview = $("#photo-preview");
const placeholder = $("#placeholder-icon");
const cameraInput = $("#camera-input");
const galleryInput = $("#gallery-input");
const cameraBtn = $("#camera-btn");
const galleryBtn = $("#gallery-btn");
const analyzeBtn = $("#analyze-btn");
const retakeBtn = $("#retake-btn");

function resizeImage(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w <= maxDim && h <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = dataUrl;
  });
}

function handleFileSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const resized = await resizeImage(reader.result, 1280);
    showCaptured(resized);
  };
  reader.readAsDataURL(file);
}

function showCaptured(dataUrl) {
  state.capturedImage = dataUrl;
  photoPreview.src = dataUrl;
  photoPreview.style.display = "block";
  placeholder.style.display = "none";
  photoArea.classList.add("has-photo");

  cameraBtn.classList.add("hidden");
  galleryBtn.classList.add("hidden");
  analyzeBtn.classList.remove("hidden");
  retakeBtn.classList.remove("hidden");
}

function resetCapture() {
  state.capturedImage = null;
  photoPreview.style.display = "none";
  photoPreview.src = "";
  placeholder.style.display = "flex";
  photoArea.classList.remove("has-photo");

  cameraBtn.classList.remove("hidden");
  galleryBtn.classList.remove("hidden");
  analyzeBtn.classList.add("hidden");
  retakeBtn.classList.add("hidden");

  $("#results-section").classList.add("hidden");
  $("#capture-section").classList.remove("hidden");

  cameraInput.value = "";
  galleryInput.value = "";
}

cameraInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
galleryInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
retakeBtn.addEventListener("click", resetCapture);

// -- Analysis --
analyzeBtn.addEventListener("click", async () => {
  if (!state.capturedImage) return;

  if (!state.apiKey) {
    settingsPanel.classList.remove("hidden");
    apiKeyInput.focus();
    return;
  }

  $("#capture-section").classList.add("hidden");
  $("#loading-section").classList.remove("hidden");
  $("#results-section").classList.add("hidden");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": state.apiKey },
      body: JSON.stringify({ image: state.capturedImage }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    renderResults(data);
  } catch (err) {
    showError(err.message);
    $("#capture-section").classList.remove("hidden");
  } finally {
    $("#loading-section").classList.add("hidden");
  }
});

function showError(msg) {
  const el = document.createElement("div");
  el.className = "error-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("visible"), 10);
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function renderResults(data) {
  $("#results-section").classList.remove("hidden");
  $("#capture-section").classList.add("hidden");

  $("#meal-description").textContent = data.meal_description || "";

  const banner = $("#risk-banner");
  const riskMessages = {
    high: "High oxalate meal — calcium supplementation recommended",
    moderate: "Moderate oxalate meal — consider calcium with this meal",
    low: "Low oxalate meal — minimal concern",
    "very low": "Very low oxalate — no supplementation needed",
  };
  banner.textContent = riskMessages[data.risk_level] || "";
  banner.className = "risk-banner risk-" + data.risk_level.replace(" ", "");

  $("#total-oxalate").textContent = data.total_oxalate_mg;
  $("#calcium-needed").textContent = data.calcium_recommendation.recommended_calcium_mg;
  $("#tablet-count").textContent = data.calcium_recommendation.calcium_citrate_tablets;

  const maxOx = Math.max(...data.foods.map((f) => f.estimated_oxalate_mg || 0), 1);

  const foodDetails = $("#food-details");
  foodDetails.innerHTML = data.foods
    .map((f) => {
      const pct = f.estimated_oxalate_mg ? Math.round((f.estimated_oxalate_mg / maxOx) * 100) : 0;
      const barColor =
        (f.estimated_oxalate_mg || 0) > 50
          ? "var(--risk-high)"
          : (f.estimated_oxalate_mg || 0) > 20
            ? "var(--risk-moderate)"
            : "var(--risk-low)";

      return `
      <div class="food-item">
        <div class="food-item-header">
          <span class="food-name">${esc(f.name)}</span>
          <span class="food-oxalate">${f.estimated_oxalate_mg !== null ? f.estimated_oxalate_mg + " mg" : "?"}</span>
        </div>
        <div class="food-meta">
          ~${f.weight_grams}g serving
          ${f.oxalate_range_mg ? ` · Range: ${f.oxalate_range_mg[0]}–${f.oxalate_range_mg[1]} mg` : ""}
          ${f.confidence !== "high" ? ` · ${f.confidence} confidence` : ""}
        </div>
        ${f.note ? `<div class="food-note">${esc(f.note)}</div>` : ""}
        ${!f.in_database ? `<div class="food-unknown">Not in database — oxalate estimate unavailable</div>` : ""}
        ${
          f.in_database
            ? `<div class="oxalate-bar"><div class="oxalate-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`
            : ""
        }
      </div>`;
    })
    .join("");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// -- New Analysis --
$("#new-analysis-btn").addEventListener("click", resetCapture);

// -- Reference Database --
async function loadReference() {
  try {
    const res = await fetch("/api/database");
    const data = await res.json();

    const tbody = $("#food-table tbody");
    const renderRows = (foods) => {
      tbody.innerHTML = foods
        .map(
          (f) => `
        <tr>
          <td>${esc(f.name)}</td>
          <td>${f.oxalate_mg_per_100g}</td>
          <td>${esc(f.category)}</td>
        </tr>`
        )
        .join("");
    };

    renderRows(data.foods);

    $("#search-foods").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      renderRows(data.foods.filter((f) => f.name.includes(q) || f.category.includes(q)));
    });
  } catch {
    // database will load when server is available
  }
}

// -- Error toast styles (injected once) --
const toastStyle = document.createElement("style");
toastStyle.textContent = `
.error-toast {
  position: fixed;
  bottom: calc(20px + var(--safe-bottom, 0px));
  left: 16px;
  right: 16px;
  max-width: 480px;
  margin: 0 auto;
  padding: 14px 16px;
  background: var(--risk-high);
  color: white;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  z-index: 1000;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.3s, transform 0.3s;
}
.error-toast.visible {
  opacity: 1;
  transform: translateY(0);
}`;
document.head.appendChild(toastStyle);

// -- Init --
if (!state.apiKey) {
  settingsPanel.classList.remove("hidden");
}
loadReference();
