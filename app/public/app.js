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

// -- Food Memory --
const MEMORY_KEY = "oxacheck_food_memory";

function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY)) || {}; }
  catch { return {}; }
}

function saveMemory(mem) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
}

function rememberCorrection(originalName, correctedName, estimates) {
  const mem = loadMemory();
  const key = originalName.toLowerCase().trim();
  if (key === correctedName.toLowerCase().trim()) {
    delete mem[key];
  } else {
    mem[key] = { name: correctedName, estimates: estimates || null };
  }
  saveMemory(mem);
}

function recallCorrection(name) {
  const mem = loadMemory();
  const entry = mem[name.toLowerCase().trim()];
  if (!entry) return null;
  if (typeof entry === "string") return { name: entry, estimates: null };
  return entry;
}

function applyMemoryToResults(foods) {
  let changed = false;
  const updated = foods.map((f) => {
    const recalled = recallCorrection(f.name);
    if (recalled && recalled.name.toLowerCase() !== f.name.toLowerCase()) {
      changed = true;
      const result = { ...f, original_name: f.name, name: recalled.name, confidence: "high", auto_corrected: true };
      if (recalled.estimates) {
        Object.assign(result, recalled.estimates);
      }
      return result;
    }
    return f;
  });
  return { foods: updated, changed };
}

function rememberLabelData(foodName, labelData) {
  const mem = loadMemory();
  const key = foodName.toLowerCase().trim();
  mem[key] = {
    name: foodName,
    estimates: {
      est_oxalate_mg_per_100g: labelData.est_oxalate_mg_per_100g,
      est_calcium_mg_per_100g: labelData.est_calcium_mg_per_100g,
      est_carbs_g_per_100g: labelData.est_carbs_g_per_100g,
      est_fiber_g_per_100g: labelData.est_fiber_g_per_100g,
      est_fat_g_per_100g: labelData.est_fat_g_per_100g,
      est_protein_g_per_100g: labelData.est_protein_g_per_100g,
      est_glycemic_index: labelData.est_glycemic_index,
      source: "label",
    },
  };
  saveMemory(mem);
}

// -- Tablet Size --
const TABLET_KEY = "oxacheck_tablet_size";

function getTabletSize() {
  return parseInt(localStorage.getItem(TABLET_KEY)) || 315;
}

function setTabletSize(mg) {
  localStorage.setItem(TABLET_KEY, mg.toString());
}

// -- Settings Panel --
const settingsBtn = $("#settings-btn");
const settingsPanel = $("#settings-panel");
const tabletSelect = $("#tablet-size-input");
const tabletCustom = $("#tablet-size-custom");

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) {
    syncTogglesFromStorage();
    const saved = getTabletSize();
    const match = [...tabletSelect.options].find((o) => o.value === saved.toString());
    if (match) {
      tabletSelect.value = saved.toString();
      tabletCustom.classList.add("hidden");
    } else {
      tabletSelect.value = "custom";
      tabletCustom.value = saved;
      tabletCustom.classList.remove("hidden");
    }
  }
});

tabletSelect.addEventListener("change", () => {
  if (tabletSelect.value === "custom") {
    tabletCustom.classList.remove("hidden");
    tabletCustom.focus();
  } else {
    tabletCustom.classList.add("hidden");
    setTabletSize(parseInt(tabletSelect.value));
  }
});

tabletCustom.addEventListener("change", () => {
  const val = parseInt(tabletCustom.value);
  if (val >= 50 && val <= 1500) setTabletSize(val);
});

// -- Section Visibility --
const SECTIONS_KEY = "oxacheck_sections";
const SECTION_DEFAULTS = { oxalate: true, carbs: true, fpu: true };

function getSectionVisibility() {
  try {
    return { ...SECTION_DEFAULTS, ...JSON.parse(localStorage.getItem(SECTIONS_KEY)) };
  } catch { return { ...SECTION_DEFAULTS }; }
}

function setSectionVisibility(sections) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}

function applySectionVisibility() {
  const vis = getSectionVisibility();
  const toggle = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? "" : "none";
  };
  toggle("section-oxalate", vis.oxalate);
  toggle("section-carbs", vis.carbs);
  toggle("section-fpu", vis.fpu);
}

const toggleOxalate = $("#toggle-oxalate");
const toggleCarbs = $("#toggle-carbs");
const toggleFpu = $("#toggle-fpu");

function syncTogglesFromStorage() {
  const vis = getSectionVisibility();
  toggleOxalate.checked = vis.oxalate;
  toggleCarbs.checked = vis.carbs;
  toggleFpu.checked = vis.fpu;
}

[toggleOxalate, toggleCarbs, toggleFpu].forEach((cb, i) => {
  const key = ["oxalate", "carbs", "fpu"][i];
  cb.addEventListener("change", () => {
    const vis = getSectionVisibility();
    vis[key] = cb.checked;
    setSectionVisibility(vis);
    applySectionVisibility();
  });
});

syncTogglesFromStorage();

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
      let w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return; }
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale); h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = dataUrl;
  });
}

function handleFileSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => showCaptured(await resizeImage(reader.result, 1280));
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

// -- API helpers --
async function recalculateFromFoods(foods) {
  const foodList = foods.map((f) => ({
    name: f.name,
    weight_grams: f.weight_grams,
    confidence: f.confidence,
    alternatives: f.alternatives || [],
    enclosed: f.enclosed || false,
    enclosed_in: f.enclosed_in || null,
    est_oxalate_mg_per_100g: f.est_oxalate_mg_per_100g ?? null,
    est_calcium_mg_per_100g: f.est_calcium_mg_per_100g ?? null,
    est_carbs_g_per_100g: f.est_carbs_g_per_100g ?? null,
    est_fiber_g_per_100g: f.est_fiber_g_per_100g ?? null,
    est_fat_g_per_100g: f.est_fat_g_per_100g ?? null,
    est_protein_g_per_100g: f.est_protein_g_per_100g ?? null,
    est_glycemic_index: f.est_glycemic_index ?? null,
    source: f.source || null,
  }));

  const res = await fetch("/api/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foods: foodList, tablet_size_mg: getTabletSize() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

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
      body: JSON.stringify({ image: capturedImage, tablet_size_mg: getTabletSize() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

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

// -- Render Results --
function renderResults(data) {
  $("#results-section").classList.remove("hidden");
  $("#capture-section").classList.add("hidden");

  $("#meal-description").textContent = data.meal_description || "";

  const thumb = $("#results-photo-thumb");
  if (capturedImage) {
    thumb.src = capturedImage;
    thumb.style.display = "block";
  } else {
    thumb.style.display = "none";
  }

  const banner = $("#risk-banner");
  const ca = data.calcium_recommendation;
  const needsSupplement = ca.supplement_calcium_mg > 0;

  let bannerText, bannerStyle;
  if (data.risk_level === "high" || data.risk_level === "moderate") {
    if (needsSupplement) {
      bannerText = data.risk_level === "high"
        ? "High oxalate meal — calcium supplementation recommended"
        : "Moderate oxalate meal — consider calcium with this meal";
      bannerStyle = "risk-" + data.risk_level;
    } else {
      bannerText = (data.risk_level === "high" ? "High" : "Moderate") +
        " oxalate — but dietary calcium in this meal is sufficient";
      bannerStyle = "risk-low";
    }
  } else {
    bannerText = data.risk_level === "low"
      ? "Low oxalate meal — minimal concern"
      : "Very low oxalate — no supplementation needed";
    bannerStyle = "risk-" + data.risk_level.replace(" ", "");
  }
  banner.textContent = bannerText;
  banner.className = "risk-banner " + bannerStyle;
  $("#total-oxalate").textContent = data.total_oxalate_mg;
  $("#dietary-calcium").textContent = ca.dietary_calcium_mg;
  $("#supplement-calcium").textContent = ca.supplement_calcium_mg;

  if (ca.supplement_calcium_mg === 0 && ca.below_threshold) {
    $("#tablet-info").textContent = "too low to supplement";
  } else if (ca.calcium_citrate_tablets > 0) {
    $("#tablet-info").textContent = `mg / ${ca.calcium_citrate_tablets} × ${ca.calcium_citrate_tablet_size_mg}mg`;
  } else {
    $("#tablet-info").textContent = "no supplement needed";
  }

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
  giBanner.className = "gi-banner " + ({ high: "risk-high", medium: "risk-moderate", low: "risk-low" }[carbs.gi_label] || "");

  const fpu = data.fpu_summary;
  if (fpu) {
    $("#total-fat").textContent = fpu.total_fat_g;
    $("#total-protein").textContent = fpu.total_protein_g;
    $("#fpu-value").textContent = fpu.fpu;

    const fpuCard = $("#fpu-card");
    fpuCard.classList.remove("warn", "accent");
    if (fpu.fpu >= 2) fpuCard.classList.add("warn");
    else if (fpu.fpu >= 1) fpuCard.classList.add("accent");

    if (fpu.fpu_carb_equiv_g > 0) {
      $("#fpu-equiv").textContent = `≈ ${fpu.fpu_carb_equiv_g}g slow carbs` + (fpu.fpu_duration_hours ? ` / ${fpu.fpu_duration_hours}h` : "");
    } else {
      $("#fpu-equiv").textContent = "no delayed effect";
    }

    const absBanner = $("#absorption-banner");
    const absStyles = {
      fast: "risk-high",
      dual: "risk-moderate",
      extended: "risk-moderate",
      gradual: "risk-low",
      minimal: "risk-verylow",
    };
    absBanner.textContent = fpu.absorption_detail;
    absBanner.className = "absorption-banner " + (absStyles[fpu.absorption_profile] || "risk-low");
  }

  renderFoodList(data.foods);
  $("#add-food-btn").classList.remove("hidden");
  applySectionVisibility();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const SOURCE_LINKS = {
  vegetable: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  fruit: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  nut: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  grain: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  legume: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  meat: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  dairy: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  spice: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  beverage: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
  prepared: { label: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/" },
};
const OHF_URL = "https://ohf.org/";
const USYD_GI_URL = "https://glycemicindex.com/";

function sourceHtml(food) {
  if (!food.in_database) return "";
  const src = SOURCE_LINKS[food.category] || SOURCE_LINKS.vegetable;
  return `<div class="food-source">Sources: <a href="${OHF_URL}" target="_blank" rel="noopener">OHF</a> · <a href="${src.url}" target="_blank" rel="noopener">${esc(src.label)}</a>${food.glycemic_index ? ` · <a href="${USYD_GI_URL}" target="_blank" rel="noopener">GI Database</a>` : ""}</div>`;
}

function renderFoodList(foods) {
  const maxOx = Math.max(...foods.map((f) => f.estimated_oxalate_mg || 0), 1);
  const foodDetails = $("#food-details");

  foodDetails.innerHTML = foods.map((f, i) => {
    const pct = f.estimated_oxalate_mg ? Math.round((f.estimated_oxalate_mg / maxOx) * 100) : 0;
    const barColor =
      (f.estimated_oxalate_mg || 0) > 50 ? "var(--risk-high)"
      : (f.estimated_oxalate_mg || 0) > 20 ? "var(--risk-moderate)"
      : "var(--risk-low)";

    const confLabel = f.confidence !== "high" ? ` · ${f.confidence} confidence` : "";
    const enclosedLabel = f.enclosed ? ` · filling of ${esc(f.enclosed_in || "enclosed food")}` : "";
    const autoCorrected = f.auto_corrected
      ? `<div class="food-auto-corrected">Auto-corrected from "${esc(f.original_name)}" (remembered)</div>` : "";

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
      ${f.net_carbs_g !== null ? `<div class="food-carbs">Net carbs: ${f.net_carbs_g}g · GI: ${f.glycemic_index}${f.glycemic_load !== null ? " · GL: " + f.glycemic_load : ""}${f.fat_g !== null ? " · Fat: " + f.fat_g + "g" : ""}${f.protein_g !== null ? " · Protein: " + f.protein_g + "g" : ""}</div>` : ""}
      ${f.note ? `<div class="food-note">${esc(f.note)}</div>` : ""}
      ${sourceHtml(f)}
      ${f.source === "label" ? `<div class="food-label-source">Values from scanned nutritional label</div>` : ""}
      ${!f.in_database && f.ai_estimated && f.source !== "label" ? `<div class="food-ai-estimated"><a href="#" class="ai-info-link" onclick="event.stopPropagation();showAiInfo();return false;">AI estimated</a> — not in reference database</div>` : ""}
      ${!f.in_database && !f.ai_estimated && f.source !== "label" ? `<div class="food-unknown">Not in database — estimates unavailable</div>` : ""}
      ${autoCorrected}
      <div class="food-correction-hint">Tap to edit</div>
      ${f.in_database || f.ai_estimated || f.source === "label" ? `<div class="oxalate-bar"><div class="oxalate-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>` : ""}
    </div>`;
  }).join("");

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
const deleteBtn = $("#modal-delete");
const rememberCheck = $("#remember-check");
const weightInput = $("#weight-input");
const saveWeightBtn = $("#modal-save-weight");
const labelInput = $("#label-input");
const labelStatus = $("#label-status");

let correctionIndex = -1;
let addMode = false;
let currentUnit = "g";
let scannedLabel = null;

const OZ_PER_G = 1 / 28.3495;
const G_PER_OZ = 28.3495;
const CUP_WEIGHTS = {
  vegetable: 130, fruit: 150, nut: 140, grain: 150, legume: 170,
  meat: 140, dairy: 245, beverage: 240, spice: 7, prepared: 200, other: 150, unknown: 150,
};

function gramsToDisplay(g, unit, category) {
  if (unit === "oz") return Math.round(g * OZ_PER_G * 10) / 10;
  if (unit === "cups") return Math.round((g / (CUP_WEIGHTS[category] || 150)) * 100) / 100;
  return Math.round(g);
}

function displayToGrams(val, unit, category) {
  if (unit === "oz") return Math.round(val * G_PER_OZ);
  if (unit === "cups") return Math.round(val * (CUP_WEIGHTS[category] || 150));
  return Math.round(val);
}

function getWeightInGrams() {
  if (correctionIndex < 0 || !currentResults) {
    return displayToGrams(parseFloat(weightInput.value) || 100, currentUnit, "unknown");
  }
  const food = currentResults.foods[correctionIndex];
  return displayToGrams(parseFloat(weightInput.value) || 0, currentUnit, food.category);
}

function setUnitDisplay(unit, food) {
  currentUnit = unit;
  const unitLabel = $(".weight-unit");
  unitLabel.textContent = unit;
  document.querySelectorAll(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === unit));

  const displayed = gramsToDisplay(food.weight_grams, unit, food.category);
  weightInput.value = displayed;
  weightInput.step = unit === "g" ? "5" : unit === "oz" ? "0.5" : "0.25";

  const deltas = unit === "g" ? [[-25, "-25"], [-10, "-10"], [10, "+10"], [25, "+25"]]
    : unit === "oz" ? [[-1, "-1"], [-0.5, "-0.5"], [0.5, "+0.5"], [1, "+1"]]
    : [[-0.5, "-0.5"], [-0.25, "-¼"], [0.25, "+¼"], [0.5, "+0.5"]];
  document.querySelectorAll(".weight-adj").forEach((btn, i) => {
    btn.dataset.delta = deltas[i][0];
    btn.textContent = deltas[i][1];
  });
}

function openCorrectionModal(index) {
  if (!currentResults) return;
  const food = currentResults.foods[index];
  correctionIndex = index;

  if (food.enclosed) {
    modalPrompt.textContent = `Filling of ${food.enclosed_in || "enclosed food"}: "${food.name}" (~${food.weight_grams}g)`;
  } else {
    modalPrompt.textContent = `Identified as "${food.name}" (~${food.weight_grams}g)`;
  }

  setUnitDisplay("g", food);

  const alts = food.alternatives || [];
  const allOptions = [food.name, ...alts];

  modalAlts.innerHTML = allOptions.map((name, i) => `
    <button class="alt-btn" data-name="${esc(name)}">
      <span>${esc(name)}</span>
      ${i === 0 ? '<span class="alt-label">current</span>' : ""}
    </button>`).join("");

  modalAlts.querySelectorAll(".alt-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyCorrection(btn.dataset.name, getWeightInGrams()));
  });

  rememberCheck.checked = true;
  customInput.value = "";
  scannedLabel = null;
  labelStatus.classList.add("hidden");
  labelStatus.className = "label-status hidden";
  labelInput.value = "";
  deleteBtn.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  correctionIndex = -1;
  if (addMode) {
    addMode = false;
    saveWeightBtn.textContent = "Save Weight Only";
  }
}

async function applyCorrection(newName, newWeight) {
  if (correctionIndex < 0 || !currentResults) return;

  const food = currentResults.foods[correctionIndex];
  const originalName = food.original_name || food.name;
  const nameChanged = newName.toLowerCase() !== food.name.toLowerCase();

  const estimates = scannedLabel ? {
    est_oxalate_mg_per_100g: scannedLabel.est_oxalate_mg_per_100g,
    est_calcium_mg_per_100g: scannedLabel.est_calcium_mg_per_100g,
    est_carbs_g_per_100g: scannedLabel.est_carbs_g_per_100g,
    est_fiber_g_per_100g: scannedLabel.est_fiber_g_per_100g,
    est_fat_g_per_100g: scannedLabel.est_fat_g_per_100g,
    est_protein_g_per_100g: scannedLabel.est_protein_g_per_100g,
    est_glycemic_index: scannedLabel.est_glycemic_index,
    source: "label",
  } : {
    est_oxalate_mg_per_100g: food.est_oxalate_mg_per_100g,
    est_calcium_mg_per_100g: food.est_calcium_mg_per_100g,
    est_carbs_g_per_100g: food.est_carbs_g_per_100g,
    est_fiber_g_per_100g: food.est_fiber_g_per_100g,
    est_fat_g_per_100g: food.est_fat_g_per_100g,
    est_protein_g_per_100g: food.est_protein_g_per_100g,
    est_glycemic_index: food.est_glycemic_index,
  };

  if (rememberCheck.checked && (nameChanged || scannedLabel)) {
    rememberCorrection(originalName, newName, estimates);
  }

  const foodList = currentResults.foods.map((f, i) => ({
    name: i === correctionIndex ? newName : f.name,
    weight_grams: i === correctionIndex ? (newWeight || f.weight_grams) : f.weight_grams,
    confidence: i === correctionIndex ? "high" : f.confidence,
    alternatives: i === correctionIndex ? [] : (f.alternatives || []),
    enclosed: i === correctionIndex ? false : (f.enclosed || false),
    enclosed_in: i === correctionIndex ? null : (f.enclosed_in || null),
    est_oxalate_mg_per_100g: (i === correctionIndex ? estimates.est_oxalate_mg_per_100g : f.est_oxalate_mg_per_100g) ?? null,
    est_calcium_mg_per_100g: (i === correctionIndex ? estimates.est_calcium_mg_per_100g : f.est_calcium_mg_per_100g) ?? null,
    est_carbs_g_per_100g: (i === correctionIndex ? estimates.est_carbs_g_per_100g : f.est_carbs_g_per_100g) ?? null,
    est_fiber_g_per_100g: (i === correctionIndex ? estimates.est_fiber_g_per_100g : f.est_fiber_g_per_100g) ?? null,
    est_fat_g_per_100g: (i === correctionIndex ? estimates.est_fat_g_per_100g : f.est_fat_g_per_100g) ?? null,
    est_protein_g_per_100g: (i === correctionIndex ? estimates.est_protein_g_per_100g : f.est_protein_g_per_100g) ?? null,
    est_glycemic_index: (i === correctionIndex ? estimates.est_glycemic_index : f.est_glycemic_index) ?? null,
    source: i === correctionIndex ? (estimates.source || f.source) : (f.source || null),
  }));

  closeModal();

  try {
    const data = await recalculateFromFoods(foodList);
    currentResults.foods = data.foods;
    currentResults.total_oxalate_mg = data.total_oxalate_mg;
    currentResults.risk_level = data.risk_level;
    currentResults.calcium_recommendation = data.calcium_recommendation;
    currentResults.carb_summary = data.carb_summary;
    currentResults.fpu_summary = data.fpu_summary;
    currentResults.meal_description = data.foods.map(f => f.name).join(", ");
    renderResults(currentResults);
  } catch (err) {
    showError("Recalculation failed: " + err.message);
  }
}

function openAddFoodModal() {
  if (!currentResults) return;
  addMode = true;
  correctionIndex = -1;

  modalPrompt.textContent = "Add a food that was missed in the photo";
  weightInput.value = 100;
  currentUnit = "g";
  $(".weight-unit").textContent = "g";
  document.querySelectorAll(".unit-btn").forEach(b => b.classList.toggle("active", b.dataset.unit === "g"));
  weightInput.step = "5";
  const deltas = [[-25, "-25"], [-10, "-10"], [10, "+10"], [25, "+25"]];
  document.querySelectorAll(".weight-adj").forEach((btn, i) => {
    btn.dataset.delta = deltas[i][0];
    btn.textContent = deltas[i][1];
  });

  modalAlts.innerHTML = "";
  rememberCheck.checked = false;
  customInput.value = "";
  scannedLabel = null;
  labelStatus.classList.add("hidden");
  labelStatus.className = "label-status hidden";
  labelInput.value = "";
  saveWeightBtn.textContent = "Add Food";
  deleteBtn.classList.add("hidden");
  modal.classList.remove("hidden");
  customInput.focus();
}

async function addFood(name, weightGrams) {
  if (!currentResults) return;

  const estimates = scannedLabel ? {
    est_oxalate_mg_per_100g: scannedLabel.est_oxalate_mg_per_100g,
    est_calcium_mg_per_100g: scannedLabel.est_calcium_mg_per_100g,
    est_carbs_g_per_100g: scannedLabel.est_carbs_g_per_100g,
    est_fiber_g_per_100g: scannedLabel.est_fiber_g_per_100g,
    est_fat_g_per_100g: scannedLabel.est_fat_g_per_100g,
    est_protein_g_per_100g: scannedLabel.est_protein_g_per_100g,
    est_glycemic_index: scannedLabel.est_glycemic_index,
    source: "label",
  } : {};

  const foodList = currentResults.foods.map(f => ({
    name: f.name,
    weight_grams: f.weight_grams,
    confidence: f.confidence,
    alternatives: f.alternatives || [],
    enclosed: f.enclosed || false,
    enclosed_in: f.enclosed_in || null,
    est_oxalate_mg_per_100g: f.est_oxalate_mg_per_100g ?? null,
    est_calcium_mg_per_100g: f.est_calcium_mg_per_100g ?? null,
    est_carbs_g_per_100g: f.est_carbs_g_per_100g ?? null,
    est_fiber_g_per_100g: f.est_fiber_g_per_100g ?? null,
    est_fat_g_per_100g: f.est_fat_g_per_100g ?? null,
    est_protein_g_per_100g: f.est_protein_g_per_100g ?? null,
    est_glycemic_index: f.est_glycemic_index ?? null,
    source: f.source || null,
  }));

  foodList.push({
    name,
    weight_grams: weightGrams,
    confidence: "high",
    alternatives: [],
    enclosed: false,
    enclosed_in: null,
    est_oxalate_mg_per_100g: estimates.est_oxalate_mg_per_100g ?? null,
    est_calcium_mg_per_100g: estimates.est_calcium_mg_per_100g ?? null,
    est_carbs_g_per_100g: estimates.est_carbs_g_per_100g ?? null,
    est_fiber_g_per_100g: estimates.est_fiber_g_per_100g ?? null,
    est_fat_g_per_100g: estimates.est_fat_g_per_100g ?? null,
    est_protein_g_per_100g: estimates.est_protein_g_per_100g ?? null,
    est_glycemic_index: estimates.est_glycemic_index ?? null,
    source: estimates.source || null,
  });

  closeModal();

  try {
    const data = await recalculateFromFoods(foodList);
    currentResults.foods = data.foods;
    currentResults.total_oxalate_mg = data.total_oxalate_mg;
    currentResults.risk_level = data.risk_level;
    currentResults.calcium_recommendation = data.calcium_recommendation;
    currentResults.carb_summary = data.carb_summary;
    currentResults.fpu_summary = data.fpu_summary;
    currentResults.meal_description = data.foods.map(f => f.name).join(", ");
    renderResults(currentResults);
  } catch (err) {
    showError("Failed to add food: " + err.message);
  }
}

// Weight adjustment buttons
document.querySelectorAll(".weight-adj").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const delta = parseFloat(btn.dataset.delta);
    const cur = parseFloat(weightInput.value) || 0;
    const min = currentUnit === "g" ? 5 : currentUnit === "oz" ? 0.5 : 0.25;
    weightInput.value = Math.max(min, Math.round((cur + delta) * 100) / 100);
  });
});

// Unit selector buttons
document.querySelectorAll(".unit-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (addMode) {
      const g = getWeightInGrams();
      setUnitDisplay(btn.dataset.unit, { weight_grams: g, category: "unknown" });
      return;
    }
    if (correctionIndex < 0 || !currentResults) return;
    const food = currentResults.foods[correctionIndex];
    const currentGrams = getWeightInGrams();
    food.weight_grams = currentGrams;
    setUnitDisplay(btn.dataset.unit, food);
  });
});

saveWeightBtn.addEventListener("click", () => {
  if (addMode) {
    const name = customInput.value.trim();
    if (!name) { showError("Enter a food name"); return; }
    addFood(name, getWeightInGrams());
    return;
  }
  if (correctionIndex < 0 || !currentResults) return;
  const food = currentResults.foods[correctionIndex];
  applyCorrection(food.name, getWeightInGrams());
});

async function deleteFood(index) {
  if (!currentResults || index < 0 || index >= currentResults.foods.length) return;

  const remaining = currentResults.foods.filter((_, i) => i !== index);
  closeModal();

  if (remaining.length === 0) {
    resetCapture();
    return;
  }

  try {
    const data = await recalculateFromFoods(remaining);
    currentResults.foods = data.foods;
    currentResults.total_oxalate_mg = data.total_oxalate_mg;
    currentResults.risk_level = data.risk_level;
    currentResults.calcium_recommendation = data.calcium_recommendation;
    currentResults.carb_summary = data.carb_summary;
    currentResults.fpu_summary = data.fpu_summary;
    currentResults.meal_description = data.foods.map(f => f.name).join(", ");
    renderResults(currentResults);
  } catch (err) {
    showError("Recalculation failed: " + err.message);
  }
}

deleteBtn.addEventListener("click", () => {
  if (correctionIndex < 0 || !currentResults) return;
  deleteFood(correctionIndex);
});

modalBackdrop.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);
customBtn.addEventListener("click", () => {
  const val = customInput.value.trim();
  if (!val) return;
  if (addMode) { addFood(val, getWeightInGrams()); return; }
  applyCorrection(val, getWeightInGrams());
});
customInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = customInput.value.trim();
    if (!val) return;
    if (addMode) { addFood(val, getWeightInGrams()); return; }
    applyCorrection(val, getWeightInGrams());
  }
});

// -- Label Scanning --
labelInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  labelStatus.classList.remove("hidden", "scanned", "scan-error");
  labelStatus.classList.add("scanning");
  labelStatus.textContent = "Reading nutritional label...";

  try {
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve) => {
      reader.onload = async () => resolve(await resizeImage(reader.result, 1280));
      reader.readAsDataURL(file);
    });

    const res = await fetch("/api/scan-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    scannedLabel = data;
    labelStatus.classList.remove("scanning");
    labelStatus.classList.add("scanned");

    const nc = Math.round((data.est_carbs_g_per_100g - data.est_fiber_g_per_100g) * 10) / 10;
    labelStatus.innerHTML = `<strong>${esc(data.product_name)}</strong>` +
      `<div class="label-values">` +
      `Ox: ${data.est_oxalate_mg_per_100g} mg · Ca: ${data.est_calcium_mg_per_100g} mg · ` +
      `Carbs: ${data.est_carbs_g_per_100g}g · Fiber: ${data.est_fiber_g_per_100g}g · ` +
      `Fat: ${data.est_fat_g_per_100g}g · Protein: ${data.est_protein_g_per_100g}g · ` +
      `Net: ${nc}g · GI: ${data.est_glycemic_index}` +
      `${data.ingredients_summary ? `<br>Ingredients: ${esc(data.ingredients_summary)}` : ""}` +
      `</div>`;

    if (!customInput.value.trim()) {
      customInput.value = data.product_name;
    }
  } catch (err) {
    labelStatus.classList.remove("scanning");
    labelStatus.classList.add("scan-error");
    labelStatus.textContent = "Failed to read label: " + err.message;
    scannedLabel = null;
  }

  labelInput.value = "";
});

// -- AI Info Modal --
const aiInfoModal = $("#ai-info-modal");
function showAiInfo() {
  aiInfoModal.classList.remove("hidden");
}
aiInfoModal.querySelector(".modal-backdrop").addEventListener("click", () => aiInfoModal.classList.add("hidden"));
$("#ai-info-close").addEventListener("click", () => aiInfoModal.classList.add("hidden"));

// -- Memory Management --
const clearMemBtn = $("#clear-memory-btn");
if (clearMemBtn) {
  clearMemBtn.addEventListener("click", () => {
    localStorage.removeItem(MEMORY_KEY);
    updateMemoryCount();
    showToast("Food memory cleared");
  });
}

// -- Add Missing Food --
$("#add-food-btn").addEventListener("click", openAddFoodModal);

// -- Re-estimate --
$("#reestimate-btn").addEventListener("click", async () => {
  if (!capturedImage) return;

  $("#results-section").classList.add("hidden");
  $("#loading-section").classList.remove("hidden");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: capturedImage, tablet_size_mg: getTabletSize() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

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
    showError("Re-estimate failed: " + err.message);
    $("#results-section").classList.remove("hidden");
  } finally {
    $("#loading-section").classList.add("hidden");
  }
});

// -- New Analysis --
$("#new-analysis-btn").addEventListener("click", resetCapture);

// -- Toasts --
function showError(msg) { showToast(msg, true); }

function showToast(msg, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " toast-error" : " toast-info");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("visible"), 10);
  setTimeout(() => { el.classList.remove("visible"); setTimeout(() => el.remove(), 300); }, 3000);
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
          <td>${f.fat_g_per_100g != null ? f.fat_g_per_100g : "—"}</td>
          <td>${f.protein_g_per_100g != null ? f.protein_g_per_100g : "—"}</td>
          <td>${f.glycemic_index || "—"}</td>
        </tr>`;
      }).join("");
    };

    renderRows(data.foods);

    $("#search-foods").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      renderRows(data.foods.filter((f) => f.name.includes(q) || f.category.includes(q)));
    });
  } catch {}
}

function updateMemoryCount() {
  const mem = loadMemory();
  const count = Object.keys(mem).length;
  const el = $("#memory-count");
  if (el) el.textContent = count > 0 ? `${count} correction${count !== 1 ? "s" : ""} remembered` : "No corrections saved";
}

// -- Toast styles --
const toastStyle = document.createElement("style");
toastStyle.textContent = `
.toast {
  position: fixed;
  bottom: calc(20px + var(--safe-bottom, 0px));
  left: 16px; right: 16px;
  max-width: 480px; margin: 0 auto;
  padding: 14px 16px;
  border-radius: 10px; font-size: 14px; font-weight: 500;
  text-align: center; z-index: 1000;
  opacity: 0; transform: translateY(20px);
  transition: opacity 0.3s, transform 0.3s;
}
.toast-error { background: var(--risk-high); color: white; }
.toast-info { background: var(--primary); color: white; }
.toast.visible { opacity: 1; transform: translateY(0); }`;
document.head.appendChild(toastStyle);

// -- Photo Overlay --
const photoOverlay = $("#photo-overlay");
const overlayPhoto = $("#overlay-photo");

$("#results-photo-thumb").addEventListener("click", () => {
  if (!capturedImage) return;
  overlayPhoto.src = capturedImage;
  photoOverlay.classList.remove("hidden");
});

$("#overlay-close").addEventListener("click", () => photoOverlay.classList.add("hidden"));
photoOverlay.addEventListener("click", (e) => {
  if (e.target === photoOverlay) photoOverlay.classList.add("hidden");
});

// -- Init --
loadReference();
updateMemoryCount();

// Restore tablet size in select
const savedTablet = getTabletSize();
const matchOpt = [...tabletSelect.options].find((o) => o.value === savedTablet.toString());
if (matchOpt) {
  tabletSelect.value = savedTablet.toString();
} else {
  tabletSelect.value = "custom";
  tabletCustom.value = savedTablet;
  tabletCustom.classList.remove("hidden");
}
