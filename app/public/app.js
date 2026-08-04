const $ = (sel) => document.querySelector(sel);

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

// -- Food Memory (corrections stored in localStorage) --
const MEMORY_KEY = "oxacheck_food_memory";

function loadMemory() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY)) || {};
  } catch { return {}; }
}

function saveMemory(mem) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
}

function rememberCorrection(originalName, correctedName) {
  const mem = loadMemory();
  const key = originalName.toLowerCase().trim();
  if (key === correctedName.toLowerCase().trim()) {
    delete mem[key];
  } else {
    mem[key] = correctedName;
  }
  saveMemory(mem);
}

function recallCorrection(name) {
  const mem = loadMemory();
  return mem[name.toLowerCase().trim()] || null;
}

function applyMemoryToResults(foods) {
  let changed = false;
  const updated = foods.map((f) => {
    const remembered = recallCorrection(f.name);
    if (remembered && remembered.toLowerCase() !== f.name.toLowerCase()) {
      changed = true;
      return {
        ...f,
        original_name: f.name,
        name: remembered,
        confidence: "high",
        auto_corrected: true,
      };
    }
    return f;
  });
  return { foods: updated, changed };
}

// -- State --
let capturedImage = null;
let currentResults = null;

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
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return; }
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
  capturedImage = dataUrl;
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
  capturedImage = null;
  currentResults = null;
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
  if (!capturedImage) return;

  $("#capture-section").classList.add("hidden");
  $("#loading-section").classList.remove("hidden");
  $("#results-section").classList.add("hidden");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: capturedImage }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Apply remembered corrections
    const { foods: correctedFoods, changed } = applyMemoryToResults(data.foods);
    if (changed) {
      const recalc = await recalculateFromFoods(correctedFoods);
      currentResults = { ...data, ...recalc };
      currentResults.meal_description = data.meal_description;
    } else {
      currentResults = data;
    }

    renderResults(currentResults);
  } catch (err) {
    showError(err.message);
    $("#capture-section").classList.remove("hidden");
  } finally {
    $("#loading-section").classList.add("hidden");
  }
});

async function recalculateFromFoods(foods) {
  const foodList = foods.map((f) => ({
    name: f.name,
    weight_grams: f.weight_grams,
    confidence: f.confidence,
    alternatives: f.alternatives || [],
    enclosed: f.enclosed || false,
    enclosed_in: f.enclosed_in || null,
  }));

  const res = await fetch("/api/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foods: foodList }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// -- Render Results --
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

  // Oxalate & Calcium cards
  const ca = data.calcium_recommendation;
  $("#total-oxalate").textContent = data.total_oxalate_mg;
  $("#dietary-calcium").textContent = ca.dietary_calcium_mg;
  $("#supplement-calcium").textContent = ca.supplement_calcium_mg;
  $("#tablet-info").textContent = ca.calcium_citrate_tablets > 0
    ? `mg / ${ca.calcium_citrate_tablets} tablet${ca.calcium_citrate_tablets !== 1 ? "s" : ""}`
    : "no supplement needed";

  // Carb cards
  const carbs = data.carb_summary;
  $("#total-carbs").textContent = carbs.total_carbs_g;
  $("#total-fiber").textContent = carbs.total_fiber_g;
  $("#net-carbs").textContent = carbs.net_carbs_g;

  const ncCard = $("#net-carbs-card");
  ncCard.classList.remove("warn", "accent");
  if (carbs.net_carbs_g > 30) ncCard.classList.add("warn");

  const giBanner = $("#gi-banner");
  const giMessages = {
    high: "Contains high GI foods (70+) — may cause rapid blood sugar rise",
    medium: "Contains medium GI foods (56-69) — moderate blood sugar impact",
    low: "All low GI foods (55 or below) — gentle blood sugar impact",
  };
  giBanner.textContent = giMessages[carbs.gi_label] || "";
  const giClass = { high: "risk-high", medium: "risk-moderate", low: "risk-low" }[carbs.gi_label] || "";
  giBanner.className = "gi-banner " + giClass;

  renderFoodList(data.foods);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFoodList(foods) {
  const maxOx = Math.max(...foods.map((f) => f.estimated_oxalate_mg || 0), 1);
  const foodDetails = $("#food-details");

  foodDetails.innerHTML = foods
    .map((f, i) => {
      const pct = f.estimated_oxalate_mg ? Math.round((f.estimated_oxalate_mg / maxOx) * 100) : 0;
      const barColor =
        (f.estimated_oxalate_mg || 0) > 50 ? "var(--risk-high)"
        : (f.estimated_oxalate_mg || 0) > 20 ? "var(--risk-moderate)"
        : "var(--risk-low)";

      const hasAlts = f.alternatives && f.alternatives.length > 0;
      const confLabel = f.confidence !== "high" ? ` · ${f.confidence} confidence` : "";
      const enclosedLabel = f.enclosed ? ` · filling of ${esc(f.enclosed_in || "enclosed food")}` : "";
      const autoCorrected = f.auto_corrected
        ? `<div class="food-auto-corrected">Auto-corrected from "${esc(f.original_name)}" (remembered)</div>`
        : "";

      return `
      <div class="food-item${f.enclosed ? " food-enclosed" : ""}" data-index="${i}">
        <div class="food-item-header">
          <span class="food-name">${esc(f.name)}</span>
          <span class="food-oxalate">${f.estimated_oxalate_mg !== null ? f.estimated_oxalate_mg + " mg ox" : "?"}</span>
        </div>
        <div class="food-meta">
          ~${f.weight_grams}g
          ${f.dietary_calcium_mg !== null ? ` · ${f.dietary_calcium_mg} mg Ca` : ""}
          ${f.oxalate_range_mg ? ` · Ox range: ${f.oxalate_range_mg[0]}–${f.oxalate_range_mg[1]} mg` : ""}
          ${confLabel}${enclosedLabel}
        </div>
        ${f.net_carbs_g !== null ? `<div class="food-carbs">Net carbs: ${f.net_carbs_g}g · GI: ${f.glycemic_index}${f.glycemic_load !== null ? " · GL: " + f.glycemic_load : ""}</div>` : ""}
        ${f.note ? `<div class="food-note">${esc(f.note)}</div>` : ""}
        ${!f.in_database ? `<div class="food-unknown">Not in database — estimates unavailable</div>` : ""}
        ${autoCorrected}
        ${f.enclosed ? `<div class="food-correction-hint">Tap to change filling</div>` : hasAlts || f.confidence !== "high" ? `<div class="food-correction-hint">Tap to correct</div>` : `<div class="food-correction-hint">Tap to change</div>`}
        ${f.in_database ? `<div class="oxalate-bar"><div class="oxalate-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>` : ""}
      </div>`;
    })
    .join("");

  foodDetails.querySelectorAll(".food-item").forEach((el) => {
    el.addEventListener("click", () => openCorrectionModal(parseInt(el.dataset.index)));
  });
}

// -- Food Correction Modal --
const modal = $("#correction-modal");
const modalBackdrop = modal.querySelector(".modal-backdrop");
const modalAlts = $("#modal-alternatives");
const modalPrompt = $("#modal-prompt");
const customInput = $("#custom-food-input");
const customBtn = $("#custom-food-btn");
const cancelBtn = $("#modal-cancel");
const rememberCheck = $("#remember-check");

let correctionIndex = -1;

function openCorrectionModal(index) {
  if (!currentResults) return;
  const food = currentResults.foods[index];
  correctionIndex = index;

  if (food.enclosed) {
    modalPrompt.textContent = `Guessed filling of ${food.enclosed_in || "enclosed food"}: "${food.name}" (~${food.weight_grams}g). What is actually inside?`;
  } else {
    modalPrompt.textContent = `Identified as "${food.name}" (~${food.weight_grams}g). Select the correct food:`;
  }

  const alts = food.alternatives || [];
  const allOptions = [food.name, ...alts];

  modalAlts.innerHTML = allOptions
    .map((name, i) => `
      <button class="alt-btn" data-name="${esc(name)}">
        <span>${esc(name)}</span>
        ${i === 0 ? '<span class="alt-label">current</span>' : ""}
      </button>`)
    .join("");

  modalAlts.querySelectorAll(".alt-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyCorrection(btn.dataset.name));
  });

  rememberCheck.checked = true;
  customInput.value = "";
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  correctionIndex = -1;
}

async function applyCorrection(newName) {
  if (correctionIndex < 0 || !currentResults) return;

  const originalName = currentResults.foods[correctionIndex].name;

  if (rememberCheck.checked && newName.toLowerCase() !== originalName.toLowerCase()) {
    const keyName = currentResults.foods[correctionIndex].original_name || originalName;
    rememberCorrection(keyName, newName);
  }

  const foodList = currentResults.foods.map((f, i) => ({
    name: i === correctionIndex ? newName : f.name,
    weight_grams: f.weight_grams,
    confidence: i === correctionIndex ? "high" : f.confidence,
    alternatives: i === correctionIndex ? [] : (f.alternatives || []),
    enclosed: i === correctionIndex ? false : (f.enclosed || false),
    enclosed_in: i === correctionIndex ? null : (f.enclosed_in || null),
  }));

  closeModal();

  try {
    const data = await recalculateFromFoods(foodList);
    currentResults.foods = data.foods;
    currentResults.total_oxalate_mg = data.total_oxalate_mg;
    currentResults.risk_level = data.risk_level;
    currentResults.calcium_recommendation = data.calcium_recommendation;
    currentResults.carb_summary = data.carb_summary;
    renderResults(currentResults);
  } catch (err) {
    showError("Recalculation failed: " + err.message);
  }
}

modalBackdrop.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);
customBtn.addEventListener("click", () => {
  const val = customInput.value.trim();
  if (val) applyCorrection(val);
});
customInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = customInput.value.trim();
    if (val) applyCorrection(val);
  }
});

// -- Memory Management --
const clearMemBtn = $("#clear-memory-btn");
if (clearMemBtn) {
  clearMemBtn.addEventListener("click", () => {
    localStorage.removeItem(MEMORY_KEY);
    showError("Food memory cleared");
  });
}

// -- New Analysis --
$("#new-analysis-btn").addEventListener("click", resetCapture);

// -- Error Toast --
function showError(msg) {
  const el = document.createElement("div");
  el.className = "error-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("visible"), 10);
  setTimeout(() => { el.classList.remove("visible"); setTimeout(() => el.remove(), 300); }, 4000);
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// -- Reference Database --
async function loadReference() {
  try {
    const res = await fetch("/api/database");
    const data = await res.json();
    const tbody = $("#food-table tbody");

    const renderRows = (foods) => {
      tbody.innerHTML = foods.map((f) => {
        const nc = f.carbs_g_per_100g != null ? Math.round((f.carbs_g_per_100g - (f.fiber_g_per_100g || 0)) * 10) / 10 : "—";
        return `<tr>
          <td>${esc(f.name)}</td>
          <td>${f.oxalate_mg_per_100g}</td>
          <td>${f.calcium_mg_per_100g || 0}</td>
          <td>${nc}</td>
          <td>${f.glycemic_index || "—"}</td>
        </tr>`;
      }).join("");
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

// -- Render memory count --
function updateMemoryCount() {
  const mem = loadMemory();
  const count = Object.keys(mem).length;
  const el = $("#memory-count");
  if (el) el.textContent = count > 0 ? `${count} correction${count !== 1 ? "s" : ""} remembered` : "No corrections saved";
}

// -- Error toast styles --
const toastStyle = document.createElement("style");
toastStyle.textContent = `
.error-toast {
  position: fixed;
  bottom: calc(20px + var(--safe-bottom, 0px));
  left: 16px; right: 16px;
  max-width: 480px; margin: 0 auto;
  padding: 14px 16px;
  background: var(--risk-high); color: white;
  border-radius: 10px; font-size: 14px; font-weight: 500;
  text-align: center; z-index: 1000;
  opacity: 0; transform: translateY(20px);
  transition: opacity 0.3s, transform 0.3s;
}
.error-toast.visible { opacity: 1; transform: translateY(0); }`;
document.head.appendChild(toastStyle);

// -- Init --
loadReference();
updateMemoryCount();
