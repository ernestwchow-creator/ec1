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
  const oxPer100 = dbEntry ? dbEntry.oxalate_mg_per_100g : null;
  const estOx = oxPer100 !== null ? (oxPer100 * w) / 100 : null;
  const rangeLow = dbEntry ? (dbEntry.range[0] * w) / 100 : null;
  const rangeHigh = dbEntry ? (dbEntry.range[1] * w) / 100 : null;
  const estCa = dbEntry ? (dbEntry.calcium_mg_per_100g * w) / 100 : null;
  const totalCarbs = dbEntry ? (dbEntry.carbs_g_per_100g * w) / 100 : null;
  const fiber = dbEntry ? (dbEntry.fiber_g_per_100g * w) / 100 : null;
  const netCarbs = totalCarbs !== null && fiber !== null ? totalCarbs - fiber : null;
  const gi = dbEntry ? dbEntry.glycemic_index : null;
  const gl = gi !== null && netCarbs !== null ? Math.round((gi * netCarbs) / 100) : null;

  return {
    name: food.name,
    weight_grams: w,
    confidence: food.confidence,
    alternatives: food.alternatives || [],
    in_database: !!dbEntry,
    database_name: dbEntry?.name || null,
    oxalate_per_100g: oxPer100,
    estimated_oxalate_mg: estOx !== null ? Math.round(estOx) : null,
    oxalate_range_mg: rangeLow !== null ? [Math.round(rangeLow), Math.round(rangeHigh)] : null,
    dietary_calcium_mg: estCa !== null ? Math.round(estCa) : null,
    total_carbs_g: totalCarbs !== null ? Math.round(totalCarbs * 10) / 10 : null,
    fiber_g: fiber !== null ? Math.round(fiber * 10) / 10 : null,
    net_carbs_g: netCarbs !== null ? Math.round(netCarbs * 10) / 10 : null,
    glycemic_index: gi,
    glycemic_load: gl,
    category: dbEntry?.category || "unknown",
    note: dbEntry?.note || null,
  };
}

function calculateCalciumRecommendation(totalOxalateMg, dietaryCalciumMg) {
  const stoichiometricCa = totalOxalateMg * MOLAR_RATIO_CA_TO_OX;
  const targetCa = stoichiometricCa * BINDING_SAFETY_FACTOR;
  const supplementCa = Math.max(0, targetCa - dietaryCalciumMg);
  const tablets = supplementCa > 0 ? Math.ceil(supplementCa / 315) : 0;

  return {
    oxalate_mg: Math.round(totalOxalateMg),
    stoichiometric_calcium_mg: Math.round(stoichiometricCa),
    target_calcium_mg: Math.round(targetCa),
    dietary_calcium_mg: Math.round(dietaryCalciumMg),
    supplement_calcium_mg: Math.round(supplementCa),
    calcium_citrate_tablets: tablets,
    calcium_citrate_tablet_size_mg: 315,
  };
}

const FOOD_IDENTIFICATION_PROMPT = `You are a food identification expert. Analyze this photo and identify all visible food items.

For each food item, provide:
1. The food name (use common names, be specific — e.g., "spinach" not "greens", "tofu" not "white cubes")
2. The estimated weight in grams of the portion visible
3. Your confidence level
4. If confidence is NOT "high", provide 2-3 alternative identifications that it could be

Respond ONLY in this exact JSON format, no other text:
{
  "foods": [
    { "name": "food name", "weight_grams": 150, "confidence": "high", "alternatives": [] },
    { "name": "best guess", "weight_grams": 80, "confidence": "medium", "alternatives": ["alternative 1", "alternative 2"] }
  ],
  "meal_description": "Brief description of the meal"
}

Confidence levels: "high" = clearly identifiable, "medium" = likely but uncertain, "low" = best guess.
For "high" confidence items, alternatives should be an empty array.
For "medium" or "low", always include plausible alternatives.
Use standard food names that would appear in a nutrition database. If you see a composite dish (e.g., salad), break it into individual ingredients where possible.`;

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

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
            { type: "text", text: FOOD_IDENTIFICATION_PROMPT },
          ],
        },
      ],
    });

    const responseText = response.content[0].text;
    let identified;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      identified = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: "Failed to parse food identification response", raw: responseText });
    }

    const foodResults = identified.foods.map((food) => buildFoodResult(food));

    let totalOxalate = 0;
    let totalDietaryCa = 0;
    let totalNetCarbs = 0;
    let totalCarbs = 0;
    let totalFiber = 0;
    let maxGI = 0;

    for (const f of foodResults) {
      if (f.estimated_oxalate_mg !== null) totalOxalate += f.estimated_oxalate_mg;
      if (f.dietary_calcium_mg !== null) totalDietaryCa += f.dietary_calcium_mg;
      if (f.net_carbs_g !== null) totalNetCarbs += f.net_carbs_g;
      if (f.total_carbs_g !== null) totalCarbs += f.total_carbs_g;
      if (f.fiber_g !== null) totalFiber += f.fiber_g;
      if (f.glycemic_index !== null && f.glycemic_index > maxGI) maxGI = f.glycemic_index;
    }

    const calcium = calculateCalciumRecommendation(totalOxalate, totalDietaryCa);

    const riskLevel =
      totalOxalate > 200 ? "high" : totalOxalate > 100 ? "moderate" : totalOxalate > 25 ? "low" : "very low";

    const giLabel = maxGI >= 70 ? "high" : maxGI >= 56 ? "medium" : "low";

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
  let maxGI = 0;

  for (const f of foodResults) {
    if (f.estimated_oxalate_mg !== null) totalOxalate += f.estimated_oxalate_mg;
    if (f.dietary_calcium_mg !== null) totalDietaryCa += f.dietary_calcium_mg;
    if (f.net_carbs_g !== null) totalNetCarbs += f.net_carbs_g;
    if (f.total_carbs_g !== null) totalCarbs += f.total_carbs_g;
    if (f.fiber_g !== null) totalFiber += f.fiber_g;
    if (f.glycemic_index !== null && f.glycemic_index > maxGI) maxGI = f.glycemic_index;
  }

  const calcium = calculateCalciumRecommendation(totalOxalate, totalDietaryCa);
  const riskLevel =
    totalOxalate > 200 ? "high" : totalOxalate > 100 ? "moderate" : totalOxalate > 25 ? "low" : "very low";
  const giLabel = maxGI >= 70 ? "high" : maxGI >= 56 ? "medium" : "low";

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
  });
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
