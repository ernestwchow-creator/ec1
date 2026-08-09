const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");
const fs = require("fs");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic();

const oxalateDb = JSON.parse(fs.readFileSync(path.join(__dirname, "oxalate-database.json"), "utf-8"));

const OXALIC_ACID_MW = 90.03;
const CALCIUM_MW = 40.08;
const MOLAR_RATIO_CA_TO_OX = CALCIUM_MW / OXALIC_ACID_MW;
const BINDING_SAFETY_FACTOR = 2.5;

function findFoodInDatabase(foodName) {
  const normalized = foodName.toLowerCase().trim();
  if (oxalateDb.foods[normalized]) {
    return { name: normalized, ...oxalateDb.foods[normalized] };
  }
  for (const [key, value] of Object.entries(oxalateDb.foods)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { name: key, ...value };
    }
  }
  return null;
}

function buildFoodResult(food) {
  const dbEntry = findFoodInDatabase(food.name);
  const w = food.weight_grams;

  const oxPer100 = dbEntry ? dbEntry.oxalate_mg_per_100g : (food.est_oxalate_mg_per_100g ?? null);
  const caPer100 = dbEntry ? dbEntry.calcium_mg_per_100g : (food.est_calcium_mg_per_100g ?? null);
  const carbsPer100 = dbEntry ? dbEntry.carbs_g_per_100g : (food.est_carbs_g_per_100g ?? null);
  const fiberPer100 = dbEntry ? dbEntry.fiber_g_per_100g : (food.est_fiber_g_per_100g ?? null);
  const fatPer100 = dbEntry ? dbEntry.fat_g_per_100g : (food.est_fat_g_per_100g ?? null);
  const proteinPer100 = dbEntry ? dbEntry.protein_g_per_100g : (food.est_protein_g_per_100g ?? null);
  const gi = dbEntry ? dbEntry.glycemic_index : (food.est_glycemic_index ?? null);

  const estOx = oxPer100 !== null ? (oxPer100 * w) / 100 : null;
  const rangeLow = dbEntry ? (dbEntry.range[0] * w) / 100 : null;
  const rangeHigh = dbEntry ? (dbEntry.range[1] * w) / 100 : null;
  const estCa = caPer100 !== null ? (caPer100 * w) / 100 : null;
  const totalCarbs = carbsPer100 !== null ? (carbsPer100 * w) / 100 : null;
  const fiber = fiberPer100 !== null ? (fiberPer100 * w) / 100 : null;
  const fat = fatPer100 !== null ? (fatPer100 * w) / 100 : null;
  const protein = proteinPer100 !== null ? (proteinPer100 * w) / 100 : null;
  const netCarbs = totalCarbs !== null && fiber !== null ? totalCarbs - fiber : null;
  const gl = gi !== null && netCarbs !== null ? Math.round((gi * netCarbs) / 100) : null;
  const aiEstimated = !dbEntry && (oxPer100 !== null || carbsPer100 !== null);

  return {
    name: food.name,
    weight_grams: w,
    confidence: food.confidence,
    alternatives: food.alternatives || [],
    enclosed: food.enclosed || false,
    enclosed_in: food.enclosed_in || null,
    in_database: !!dbEntry,
    ai_estimated: aiEstimated,
    database_name: dbEntry?.name || null,
    oxalate_per_100g: oxPer100,
    estimated_oxalate_mg: estOx !== null ? Math.round(estOx) : null,
    oxalate_range_mg: rangeLow !== null ? [Math.round(rangeLow), Math.round(rangeHigh)] : null,
    dietary_calcium_mg: estCa !== null ? Math.round(estCa) : null,
    total_carbs_g: totalCarbs !== null ? Math.round(totalCarbs * 10) / 10 : null,
    fiber_g: fiber !== null ? Math.round(fiber * 10) / 10 : null,
    fat_g: fat !== null ? Math.round(fat * 10) / 10 : null,
    protein_g: protein !== null ? Math.round(protein * 10) / 10 : null,
    net_carbs_g: netCarbs !== null ? Math.round(netCarbs * 10) / 10 : null,
    glycemic_index: gi,
    glycemic_load: gl,
    category: dbEntry?.category || "unknown",
    note: dbEntry?.note || null,
    est_oxalate_mg_per_100g: food.est_oxalate_mg_per_100g ?? null,
    est_calcium_mg_per_100g: food.est_calcium_mg_per_100g ?? null,
    est_carbs_g_per_100g: food.est_carbs_g_per_100g ?? null,
    est_fiber_g_per_100g: food.est_fiber_g_per_100g ?? null,
    est_fat_g_per_100g: food.est_fat_g_per_100g ?? null,
    est_protein_g_per_100g: food.est_protein_g_per_100g ?? null,
    est_glycemic_index: food.est_glycemic_index ?? null,
    source: food.source || null,
  };
}

const MIN_SUPPLEMENT_THRESHOLD_MG = 100;

function calculateCalciumRecommendation(totalOxalateMg, dietaryCalciumMg, tabletSizeMg) {
  const tabletSize = tabletSizeMg || 315;
  const stoichiometricCa = totalOxalateMg * MOLAR_RATIO_CA_TO_OX;
  const targetCa = stoichiometricCa * BINDING_SAFETY_FACTOR;
  const rawSupplement = Math.max(0, targetCa - dietaryCalciumMg);
  const supplementCa = rawSupplement < MIN_SUPPLEMENT_THRESHOLD_MG ? 0 : rawSupplement;
  const tablets = supplementCa > 0 ? Math.ceil(supplementCa / tabletSize) : 0;

  return {
    oxalate_mg: Math.round(totalOxalateMg),
    stoichiometric_calcium_mg: Math.round(stoichiometricCa),
    target_calcium_mg: Math.round(targetCa),
    dietary_calcium_mg: Math.round(dietaryCalciumMg),
    supplement_calcium_mg: Math.round(supplementCa),
    calcium_citrate_tablets: tablets,
    calcium_citrate_tablet_size_mg: tabletSize,
    below_threshold: rawSupplement > 0 && rawSupplement < MIN_SUPPLEMENT_THRESHOLD_MG,
  };
}

function calculateFpuSummary(totalFatG, totalProteinG, netCarbsG, maxGI) {
  const fpu = (totalFatG * 9 + totalProteinG * 4) / 100;
  const fpuRounded = Math.round(fpu * 10) / 10;
  const fpuCarbEquiv = Math.round(fpu * 10);

  let durationHours = 0;
  if (fpu >= 4) durationHours = 8;
  else if (fpu >= 3) durationHours = 5;
  else if (fpu >= 2) durationHours = 4;
  else if (fpu >= 1) durationHours = 3;

  let absorptionProfile, absorptionDetail;
  if (netCarbsG < 5 && fpu < 1) {
    absorptionProfile = "minimal";
    absorptionDetail = "Very low carb and fat/protein — minimal blood sugar impact expected";
  } else if (fpu >= 2 && netCarbsG < 15) {
    absorptionProfile = "extended";
    absorptionDetail = `High fat/protein meal (${fpuRounded} FPU) with low carbs — expect a delayed, extended blood sugar rise over ${durationHours}h`;
  } else if (fpu >= 1 && netCarbsG >= 10) {
    absorptionProfile = "dual";
    absorptionDetail = `Mixed meal (${fpuRounded} FPU + ${Math.round(netCarbsG)}g net carbs) — expect initial carb spike then extended rise over ${durationHours}h. Consider split/dual-wave bolus`;
  } else if (maxGI >= 70 && fpu < 1) {
    absorptionProfile = "fast";
    absorptionDetail = "High GI with little fat/protein to slow absorption — expect rapid blood sugar spike";
  } else {
    absorptionProfile = "gradual";
    absorptionDetail = "Moderate absorption rate — standard bolus timing should work";
  }

  return {
    total_fat_g: Math.round(totalFatG * 10) / 10,
    total_protein_g: Math.round(totalProteinG * 10) / 10,
    fpu: fpuRounded,
    fpu_carb_equiv_g: fpuCarbEquiv,
    fpu_duration_hours: durationHours,
    absorption_profile: absorptionProfile,
    absorption_detail: absorptionDetail,
  };
}

const FOOD_IDENTIFICATION_PROMPT = `You are a food identification expert. Analyze this photo and identify all visible food items.

For each food item, provide:
1. The food name (use common names, be specific — e.g., "spinach" not "greens", "tofu" not "white cubes")
2. The estimated weight in grams of the portion visible
3. Your confidence level
4. If confidence is NOT "high", provide 2-3 alternative identifications
5. Whether the food is "enclosed" (filling hidden inside)
6. Your best nutritional estimates per 100g of this food:
   - est_oxalate_mg_per_100g (use 0 for negligible-oxalate foods like plain meats, dairy, most grains)
   - est_calcium_mg_per_100g
   - est_carbs_g_per_100g (total carbohydrates)
   - est_fiber_g_per_100g
   - est_fat_g_per_100g
   - est_protein_g_per_100g
   - est_glycemic_index (0-100 scale; use 0 for non-carb foods like meats)

These estimates are used as a fallback when the food is not in our reference database, so always provide them.

WEIGHT ESTIMATION — This is critical. You MUST estimate weight from what you SEE in the photo, not from generic defaults:
1. LOOK AT THE ACTUAL PORTION in the photo. Judge its physical volume, thickness, and spread.
2. Use objects in the frame for scale: plates (~25-27cm / 10-11in diameter), bowls, forks (~19cm), knives (~22cm), spoons, hands, cups, napkins. Compare the food's size against these.
3. If no tableware or objects are visible, use the FOOD ITSELF for scale. Many foods have a known physical size:
   - Peas: ~8mm diameter, ~0.4g each. Chickpeas: ~12mm, ~1.5g each. Corn kernels: ~10mm, ~0.5g each.
   - Almonds: ~2cm long, ~1.2g each. Cashews: ~2.5cm, ~1.5g each. Walnuts (half): ~3cm, ~2.5g each.
   - Penne/rigatoni: ~4cm long. Spaghetti strand: ~2mm wide. A grain of rice: ~6mm long.
   - Cherry tomato: ~3cm, ~15g. Grape: ~2cm, ~5g. Strawberry: ~3-4cm, ~12g. Blueberry: ~1cm, ~1.5g.
   - Olive: ~2cm, ~4g. A single shrimp (medium): ~8cm, ~10g.
   Count or estimate the number of visible pieces, multiply by per-piece weight, and use that to gauge the total and the size of other foods nearby.
4. Estimate the 3D volume — how thick/deep is the food? A thin smear of sauce is 10-15g; a thick mound of rice filling half a plate could be 200g+.
5. Consider density: rice and grains are dense (~1g/ml packed), leafy greens are very light (a huge pile of lettuce may be only 40-60g), liquids ~1g/ml, bread is airy (~0.3g/ml), meat is dense (~1.1g/ml).
6. ONLY THEN sanity-check against these reference portions — do NOT default to these if the photo shows a clearly different amount:
   - Chicken breast: 120-170g. Egg: ~50g. Slice of bread: ~30g.
   - Cup of rice: ~185g. Medium potato: ~150g. Tablespoon of sauce: ~15g.
   - Side salad greens: 50-80g. Handful of nuts: ~30g.
   - Glass of liquid: ~240ml. Small cup: ~150ml. Mug: ~350ml.
7. If the portion in the photo is clearly SMALLER or LARGER than a standard serving, adjust accordingly. A few bites of rice left on a plate is 30-50g, not 185g.
8. Water, black coffee, plain tea: 0g carbs, 0 oxalate, 0 fat, 0 protein. Weight by visible container size.
9. TOTAL WEIGHT REALITY CHECK — After estimating each food, add up all the weights and ask: does this total make sense for what I see in the photo?
   - A snack plate or side dish: typically 100-300g total.
   - A typical home-cooked main meal on a plate: 300-600g total.
   - A large restaurant meal or full bowl of soup/stew: 400-800g total.
   - A single item like a sandwich or wrap: 200-350g total.
   - A drink alone: 150-350ml depending on glass/cup size.
   If the total seems too high or too low for what the photo shows, go back and adjust individual weights proportionally. The individual weights must add up to a plausible total for the visible meal.

IMPORTANT — Enclosed/wrapped foods: For items like empanadas, pies, dumplings, burritos, wraps, spring rolls, samosas, ravioli, calzones, stuffed peppers, sushi rolls, sandwiches, or any food where the filling is hidden:
- Set "enclosed" to true
- Break down into the wrapper/shell AND your best guess at the filling ingredients as separate items
- Base your filling guess on the type of food, visible clues (color, shape, leaking filling), and common regional preparations
- Set filling ingredients to "low" confidence with alternatives listing other common fillings for that type of food
- Estimate filling weight as roughly 60-70% of total weight, wrapper as 30-40%

Respond ONLY with a JSON object — no markdown fences, no explanation, no other text:
{
  "foods": [
    { "name": "food name", "weight_grams": 150, "confidence": "high", "alternatives": [], "enclosed": false, "est_oxalate_mg_per_100g": 5, "est_calcium_mg_per_100g": 20, "est_carbs_g_per_100g": 45, "est_fiber_g_per_100g": 2, "est_fat_g_per_100g": 12, "est_protein_g_per_100g": 8, "est_glycemic_index": 65 },
    { "name": "empanada shell", "weight_grams": 40, "confidence": "high", "alternatives": [], "enclosed": false, "est_oxalate_mg_per_100g": 1, "est_calcium_mg_per_100g": 15, "est_carbs_g_per_100g": 52, "est_fiber_g_per_100g": 2, "est_fat_g_per_100g": 18, "est_protein_g_per_100g": 7, "est_glycemic_index": 70 },
    { "name": "beef", "weight_grams": 70, "confidence": "low", "alternatives": ["chicken", "cheese", "beans"], "enclosed": true, "enclosed_in": "empanada", "est_oxalate_mg_per_100g": 0, "est_calcium_mg_per_100g": 12, "est_carbs_g_per_100g": 0, "est_fiber_g_per_100g": 0, "est_fat_g_per_100g": 15, "est_protein_g_per_100g": 26, "est_glycemic_index": 0 }
  ],
  "meal_description": "Brief description of the meal"
}

Confidence levels: "high" = clearly identifiable, "medium" = likely but uncertain, "low" = best guess.
For "high" confidence items, alternatives should be an empty array.
For "medium" or "low", always include plausible alternatives.
Use standard food names that would appear in a nutrition database. If you see a composite dish (e.g., salad), break it into individual ingredients where possible.`;

function extractJSON(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

app.post("/api/analyze", upload.single("photo"), async (req, res) => {
  try {
    let imageData, mediaType;

    if (req.file) {
      imageData = req.file.buffer.toString("base64");
      mediaType = req.file.mimetype;
    } else if (req.body.image) {
      const match = req.body.image.match(/^data:(.+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: "Invalid image data" });
      mediaType = match[1];
      imageData = match[2];
    } else {
      return res.status(400).json({ error: "No image provided" });
    }

    const apiMessages = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
          { type: "text", text: FOOD_IDENTIFICATION_PROMPT },
        ],
      },
    ];

    let identified = null;
    let lastError = null;

    for (const maxTokens of [4096, 8192]) {
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-5",
          max_tokens: maxTokens,
          messages: apiMessages,
        });

        const responseText = response.content[0].text;

        if (response.stop_reason === "max_tokens") {
          lastError = "Response truncated — retrying with more tokens";
          continue;
        }

        identified = extractJSON(responseText);
        if (identified && Array.isArray(identified.foods)) break;

        lastError = "Invalid response structure";
        identified = null;
      } catch (apiErr) {
        if (apiErr.status === 401) throw apiErr;
        lastError = apiErr.message;
      }
    }

    if (!identified || !Array.isArray(identified.foods)) {
      return res.status(500).json({ error: "Failed to parse food identification response", detail: lastError });
    }

    const foodResults = identified.foods.map((food) => buildFoodResult(food));

    let totalOxalate = 0;
    let totalDietaryCa = 0;
    let totalNetCarbs = 0;
    let totalCarbs = 0;
    let totalFiber = 0;
    let totalFat = 0;
    let totalProtein = 0;
    let maxGI = 0;

    for (const f of foodResults) {
      if (f.estimated_oxalate_mg !== null) totalOxalate += f.estimated_oxalate_mg;
      if (f.dietary_calcium_mg !== null) totalDietaryCa += f.dietary_calcium_mg;
      if (f.net_carbs_g !== null) totalNetCarbs += f.net_carbs_g;
      if (f.total_carbs_g !== null) totalCarbs += f.total_carbs_g;
      if (f.fiber_g !== null) totalFiber += f.fiber_g;
      if (f.fat_g !== null) totalFat += f.fat_g;
      if (f.protein_g !== null) totalProtein += f.protein_g;
      if (f.glycemic_index !== null && f.glycemic_index > maxGI) maxGI = f.glycemic_index;
    }

    const tabletSize = req.body.tablet_size_mg || 315;
    const calcium = calculateCalciumRecommendation(totalOxalate, totalDietaryCa, tabletSize);

    const riskLevel =
      totalOxalate > 200 ? "high" : totalOxalate > 100 ? "moderate" : totalOxalate > 25 ? "low" : "very low";

    const giLabel = maxGI >= 70 ? "high" : maxGI >= 56 ? "medium" : "low";
    const fpuSummary = calculateFpuSummary(totalFat, totalProtein, totalNetCarbs, maxGI);

    res.json({
      meal_description: identified.meal_description,
      foods: foodResults,
      total_oxalate_mg: Math.round(totalOxalate),
      risk_level: riskLevel,
      calcium_recommendation: calcium,
      carb_summary: {
        total_carbs_g: Math.round(totalCarbs * 10) / 10,
        total_fiber_g: Math.round(totalFiber * 10) / 10,
        net_carbs_g: Math.round(totalNetCarbs * 10) / 10,
        highest_gi: maxGI,
        gi_label: giLabel,
      },
      fpu_summary: fpuSummary,
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid API key. Check your Anthropic API key and try again." });
    }
    console.error("Analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/recalculate", (req, res) => {
  const { foods } = req.body;
  if (!Array.isArray(foods)) {
    return res.status(400).json({ error: "foods array required" });
  }

  const foodResults = foods.map((food) => buildFoodResult(food));

  let totalOxalate = 0;
  let totalDietaryCa = 0;
  let totalNetCarbs = 0;
  let totalCarbs = 0;
  let totalFiber = 0;
  let totalFat = 0;
  let totalProtein = 0;
  let maxGI = 0;

  for (const f of foodResults) {
    if (f.estimated_oxalate_mg !== null) totalOxalate += f.estimated_oxalate_mg;
    if (f.dietary_calcium_mg !== null) totalDietaryCa += f.dietary_calcium_mg;
    if (f.net_carbs_g !== null) totalNetCarbs += f.net_carbs_g;
    if (f.total_carbs_g !== null) totalCarbs += f.total_carbs_g;
    if (f.fiber_g !== null) totalFiber += f.fiber_g;
    if (f.fat_g !== null) totalFat += f.fat_g;
    if (f.protein_g !== null) totalProtein += f.protein_g;
    if (f.glycemic_index !== null && f.glycemic_index > maxGI) maxGI = f.glycemic_index;
  }

  const tabletSize = req.body.tablet_size_mg || 315;
  const calcium = calculateCalciumRecommendation(totalOxalate, totalDietaryCa, tabletSize);
  const riskLevel =
    totalOxalate > 200 ? "high" : totalOxalate > 100 ? "moderate" : totalOxalate > 25 ? "low" : "very low";
  const giLabel = maxGI >= 70 ? "high" : maxGI >= 56 ? "medium" : "low";
  const fpuSummary = calculateFpuSummary(totalFat, totalProtein, totalNetCarbs, maxGI);

  res.json({
    foods: foodResults,
    total_oxalate_mg: Math.round(totalOxalate),
    risk_level: riskLevel,
    calcium_recommendation: calcium,
    carb_summary: {
      total_carbs_g: Math.round(totalCarbs * 10) / 10,
      total_fiber_g: Math.round(totalFiber * 10) / 10,
      net_carbs_g: Math.round(totalNetCarbs * 10) / 10,
      highest_gi: maxGI,
      gi_label: giLabel,
    },
    fpu_summary: fpuSummary,
  });
});

const LABEL_SCAN_PROMPT = `You are a nutritional label reader. Analyze this photo of a food product's nutritional label / nutrition facts panel.

Extract the following values and normalize them to per 100g of the product. The label may show values per serving — use the serving size to convert to per-100g values.

If a value is not listed on the label, estimate it based on the product type and ingredients visible. For oxalate: most commercial products have negligible oxalate (use 0) unless the ingredients include high-oxalate items like spinach, cocoa, nuts, or soy.

Respond ONLY in this exact JSON format, no other text:
{
  "product_name": "the product name as shown on label",
  "serving_size_g": 100,
  "oxalate_mg_per_100g": 0,
  "calcium_mg_per_100g": 20,
  "carbs_g_per_100g": 45,
  "fiber_g_per_100g": 2,
  "fat_g_per_100g": 12,
  "protein_g_per_100g": 8,
  "glycemic_index": 65,
  "ingredients_summary": "brief list of main ingredients"
}

For glycemic_index: estimate based on the carb content and type of product. High sugar/refined starch = 70+, moderate = 56-69, low sugar/high fiber/protein = 55 or below. Use 0 for zero-carb products.`;

app.post("/api/scan-label", upload.single("label"), async (req, res) => {
  try {
    let imageData, mediaType;

    if (req.file) {
      imageData = req.file.buffer.toString("base64");
      mediaType = req.file.mimetype;
    } else if (req.body.image) {
      const match = req.body.image.match(/^data:(.+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: "Invalid image data" });
      mediaType = match[1];
      imageData = match[2];
    } else {
      return res.status(400).json({ error: "No image provided" });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
            { type: "text", text: LABEL_SCAN_PROMPT },
          ],
        },
      ],
    });

    const responseText = response.content[0].text;
    let parsed;
    try {
      parsed = extractJSON(responseText);
      if (!parsed) throw new Error("No JSON found");
    } catch {
      return res.status(500).json({ error: "Failed to parse label" });
    }

    res.json({
      product_name: parsed.product_name || "Unknown product",
      est_oxalate_mg_per_100g: parsed.oxalate_mg_per_100g ?? 0,
      est_calcium_mg_per_100g: parsed.calcium_mg_per_100g ?? 0,
      est_carbs_g_per_100g: parsed.carbs_g_per_100g ?? 0,
      est_fiber_g_per_100g: parsed.fiber_g_per_100g ?? 0,
      est_fat_g_per_100g: parsed.fat_g_per_100g ?? 0,
      est_protein_g_per_100g: parsed.protein_g_per_100g ?? 0,
      est_glycemic_index: parsed.glycemic_index ?? 0,
      ingredients_summary: parsed.ingredients_summary || "",
      source: "label",
    });
  } catch (err) {
    console.error("Label scan error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/database", (_req, res) => {
  const foods = Object.entries(oxalateDb.foods)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.oxalate_mg_per_100g - a.oxalate_mg_per_100g);
  res.json({ foods, metadata: oxalateDb.metadata });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Oxalate Estimator running on port ${PORT}`);
});
