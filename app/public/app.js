const $ = (sel) => document.querySelector(sel);

const state = {
  stream: null,
  capturedImage: null,
  apiKey: localStorage.getItem("oxacheck_api_key") || "",
};

// Settings
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

// Camera
const video = $("#camera-preview");
const canvas = $("#photo-canvas");
const photoPreview = $("#photo-preview");
const takePhotoBtn = $("#take-photo-btn");
const uploadInput = $("#upload-input");
const uploadLabel = $("#upload-label");
const retakeBtn = $("#retake-btn");
const analyzeBtn = $("#analyze-btn");

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    video.srcObject = state.stream;
    video.style.display = "block";
    photoPreview.style.display = "none";
  } catch {
    video.style.display = "none";
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

function showCaptured(dataUrl) {
  state.capturedImage = dataUrl;
  stopCamera();
  video.style.display = "none";
  photoPreview.src = dataUrl;
  photoPreview.style.display = "block";
  takePhotoBtn.classList.add("hidden");
  uploadLabel.classList.add("hidden");
  retakeBtn.classList.remove("hidden");
  analyzeBtn.classList.remove("hidden");
}

function resetCapture() {
  state.capturedImage = null;
  photoPreview.style.display = "none";
  retakeBtn.classList.add("hidden");
  analyzeBtn.classList.add("hidden");
  takePhotoBtn.classList.remove("hidden");
  uploadLabel.classList.remove("hidden");
  $("#results-section").classList.add("hidden");
  startCamera();
}

takePhotoBtn.addEventListener("click", () => {
  if (!video.srcObject) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  showCaptured(canvas.toDataURL("image/jpeg", 0.85));
});

uploadInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => showCaptured(reader.result);
  reader.readAsDataURL(file);
  uploadInput.value = "";
});

retakeBtn.addEventListener("click", resetCapture);

// Analysis
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
    alert("Analysis failed: " + err.message);
    $("#capture-section").classList.remove("hidden");
  } finally {
    $("#loading-section").classList.add("hidden");
  }
});

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
          <span class="food-name">${f.name}</span>
          <span class="food-oxalate">${f.estimated_oxalate_mg !== null ? f.estimated_oxalate_mg + " mg" : "?"}</span>
        </div>
        <div class="food-meta">
          ~${f.weight_grams}g serving
          ${f.oxalate_range_mg ? ` · Range: ${f.oxalate_range_mg[0]}–${f.oxalate_range_mg[1]} mg` : ""}
          ${f.confidence !== "high" ? ` · ${f.confidence} confidence` : ""}
        </div>
        ${f.note ? `<div class="food-note">${f.note}</div>` : ""}
        ${!f.in_database ? `<div class="food-unknown">Not in database — oxalate estimate unavailable</div>` : ""}
        ${
          f.in_database
            ? `<div class="oxalate-bar"><div class="oxalate-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

// New analysis
$("#new-analysis-btn").addEventListener("click", resetCapture);

// Reference database
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
          <td>${f.name}</td>
          <td>${f.oxalate_mg_per_100g}</td>
          <td>${f.category}</td>
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

// Init
if (!state.apiKey) {
  settingsPanel.classList.remove("hidden");
}
startCamera();
loadReference();
