const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");
const fs = require("fs");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

function calculateCalciumRecommendation(totalOxalateMg) {
  const stoichiometricCa = totalOxalateMg * MOLAR_RATIO_CA_TO_OX;
  const recommendedCa = stoichiometricCa * BINDING_SAFETY_FACTOR;

  const calciumCitrateMg = recommendedCa;
  const calciumCitrateTablets = Math.ceil(calciumCitrateMg / 315);

  return {
    oxalate_mg: Math.round(totalOxalateMg),
    stoichiometric_calcium_mg: Math.round(stoichiometricCa),
    recommended_calcium_mg: Math.round(recommendedCa),
    calcium_citrate_tablets: calciumCitrateTablets,
    calcium_citrate_tablet_size_mg: 315,
  };
}

const FOOD_IDENTIFICATION_PROMPT = `You are a food identification expert. Analyze this photo and identify all visible food items.

For each food item, estimate:
1. The food name (use common names, be specific — e.g., "spinach" not "greens")
2. The estimated weight in grams of the portion visible

Respond ONLY in this exact JSON format, no other text:
{
  "foods": [
    { "name": "food name", "weight_grams": 150, "confidence": "high" },
    { "name": "another food", "weight_grams": 80, "confidence": "medium" }
  ],
  "meal_description": "Brief description of the meal"
}

Confidence levels: "high" = clearly identifiable, "medium" = likely but uncertain, "low" = best guess.
Use standard food names that would appear in a nutrition database. If you see a composite dish (e.g., salad), break it into individual ingredients where possible.`;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

app.post("/api/analyze", upload.single("photo"), async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
      return res.status(400).json({ error: "API key required. Enter your Anthropic API key in the settings." });
    }

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

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
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

    let totalOxalate = 0;
    const foodResults = identified.foods.map((food) => {
      const dbEntry = findFoodInDatabase(food.name);
      const oxalatePer100g = dbEntry ? dbEntry.oxalate_mg_per_100g : null;
      const estimatedOxalate = oxalatePer100g !== null ? (oxalatePer100g * food.weight_grams) / 100 : null;

      if (estimatedOxalate !== null) {
        totalOxalate += estimatedOxalate;
      }

      const rangeLow = dbEntry ? (dbEntry.range[0] * food.weight_grams) / 100 : null;
      const rangeHigh = dbEntry ? (dbEntry.range[1] * food.weight_grams) / 100 : null;

      return {
        name: food.name,
        weight_grams: food.weight_grams,
        confidence: food.confidence,
        in_database: !!dbEntry,
        database_name: dbEntry?.name || null,
        oxalate_per_100g: oxalatePer100g,
        estimated_oxalate_mg: estimatedOxalate !== null ? Math.round(estimatedOxalate) : null,
        oxalate_range_mg: rangeLow !== null ? [Math.round(rangeLow), Math.round(rangeHigh)] : null,
        category: dbEntry?.category || "unknown",
        note: dbEntry?.note || null,
      };
    });

    const calcium = calculateCalciumRecommendation(totalOxalate);

    const riskLevel =
      totalOxalate > 200 ? "high" : totalOxalate > 100 ? "moderate" : totalOxalate > 25 ? "low" : "very low";

    res.json({
      meal_description: identified.meal_description,
      foods: foodResults,
      total_oxalate_mg: Math.round(totalOxalate),
      risk_level: riskLevel,
      calcium_recommendation: calcium,
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid API key. Check your Anthropic API key and try again." });
    }
    console.error("Analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/database", (_req, res) => {
  const foods = Object.entries(oxalateDb.foods)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.oxalate_mg_per_100g - a.oxalate_mg_per_100g);
  res.json({ foods, metadata: oxalateDb.metadata });
});

app.get("/api/calculate", (req, res) => {
  const oxalateMg = parseFloat(req.query.oxalate);
  if (isNaN(oxalateMg) || oxalateMg < 0) {
    return res.status(400).json({ error: "Valid oxalate amount in mg required" });
  }
  res.json(calculateCalciumRecommendation(oxalateMg));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Oxalate Estimator running on port ${PORT}`);
});
