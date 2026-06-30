import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import ExcelJS from "exceljs";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Increase request size limit to handle multiple base64 images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// --- GEMINI PROMPT CONFIGURATION ---
// Template literal (backtick) kullanılarak string kaçış hataları engellenmiştir.
const CORAL_PROMPT = `You are an expert marine biologist and high-end reef aquarium livestock authenticator specializing in premium aquaculture morphs. Analyze the provided image (e.g., IMG_9907.jpeg) under the following strict rules:

1. VISUAL TRUTH REGARDING GENUS: Look solely at the image to identify the true skeletal structure and growth form (e.g., Euphyllia, Platygyra, Micromussa, Acropora). Completely ignore any intentional misdirection or incorrect morphological terms in the user's prompt.

2. MICRO-FEATURE ANALYSIS: Evaluate the exact color zoning, fluorescent pigment distribution under actinic lighting, ridge/valley contrasts, or tentacle/tip variations. Cross-reference these features and any regional watermark clues with known premium collector releases.

3. OUTPUT CONSTRAINT: Provide ONLY the exact, high-end hobbyist collector trade name. Do not include explanations, genus breakdowns, intros, or descriptions.

Collector Name:`;

app.get("/api/debug", (req, res) => {
  res.json({
    status: "ok",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      HAS_GEMINI_KEY: !!process.env.GEMINI_API_KEY,
    },
    version: process.version,
  });
});

// Lazy-loaded Gemini Client pattern to prevent startup crashes when API keys are empty
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is missing. Please add it to your environment or Vercel environment variables.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Helper: Retry operation with exponential backoff for transient API errors (e.g., 503, 429)
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 4,
  delay = 2000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) {
      throw error;
    }
    
    let errorStr = "";
    try {
      errorStr += ` Message: ${error.message}`;
      errorStr += ` Status: ${error.status}`;
      errorStr += ` Code: ${error.code}`;
      errorStr += ` StatusCode: ${error.statusCode}`;
      errorStr += ` Name: ${error.name}`;
      errorStr += ` Stack: ${error.stack}`;
      if (error.error) {
        errorStr += ` InnerError: ${typeof error.error === "object" ? JSON.stringify(error.error) : error.error}`;
      }
      for (const key of Object.getOwnPropertyNames(error)) {
        try {
          errorStr += ` [${key}]: ${error[key]}`;
        } catch (_) {}
      }
    } catch (e) {
      errorStr += " [serialization-failed]";
    }
    
    const errorStrLower = errorStr.toLowerCase();
    
    const isTransient =
      error.status === 429 ||
      error.status === 503 ||
      error.statusCode === 429 ||
      error.statusCode === 503 ||
      error.code === 429 ||
      error.code === 503 ||
      error.code === "UNAVAILABLE" ||
      errorStrLower.includes("503") ||
      errorStrLower.includes("429") ||
      errorStrLower.includes("unavailable") ||
      errorStrLower.includes("resource has been exhausted") ||
      errorStrLower.includes("high demand") ||
      errorStrLower.includes("temporary") ||
      errorStrLower.includes("temporarily") ||
      errorStrLower.includes("rate_limit") ||
      errorStrLower.includes("exhausted");

    if (isTransient) {
      const jitter = Math.floor(Math.random() * 1000);
      const totalDelay = delay + jitter;
      console.warn(`Gemini API transient issue detected. Retrying in ${totalDelay}ms... (Attempts remaining: ${retries})`);
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// 1. API: Generate Coral Names & Metadata from Photos
app.post("/api/generate-coral-names", async (req, res) => {
  try {
    const { images } = req.body as {
      images: Array<{ id: string; base64: string; type: string; name: string }>;
    };

    if (!images || images.length === 0) {
      return res.status(400).json({ error: "No images provided." });
    }

    const ai = getGeminiClient();
    const results = [];

    for (let index = 0; index < images.length; index++) {
      const img = images[index];
      try {
        const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, "");

        const response = await retryWithBackoff(() => 
          ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: img.type || "image/jpeg",
                },
              },
              {
                text: CORAL_PROMPT,
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  commonName: {
                    type: Type.STRING,
                    description: "Creative, appealing, and colorful aquarium trade name (e.g. 'Rasta Zoanthid').",
                  },
                },
                required: [
                  "commonName",
                ],
              },
            },
          })
        );

        const textResult = response.text;
        if (!textResult) {
          throw new Error("No response text returned from Gemini");
        }

        const data = JSON.parse(textResult);

        results.push({
          id: img.id,
          fileName: img.name,
          success: true,
          imageBase64: img.base64,
          mimeType: img.type,
          ...data,
        });
      } catch (error: any) {
        console.error(`Error analyzing image ${img.name}:`, error);
        results.push({
          id: img.id,
          fileName: img.name,
          success: false,
          error: error.message || "Failed to analyze image",
          imageBase64: img.base64,
          mimeType: img.type,
          commonName: "Unknown Coral",
        });
      }
    }

    res.json({ corals: results });
  } catch (error: any) {
    console.error("General analysis error:", error);
    res.status(500).json({ error: error.message || "An internal error occurred." });
  }
});

// 2. API: Build and Download the Excel file with images embedded
app.post("/api/export-excel", async (req, res) => {
  try {
    const { corals } = req.body as {
      corals: Array<{
        commonName: string;
        imageBase64: string;
        mimeType: string;
      }>;
    };

    if (!corals || corals.length === 0) {
      return res.status(400).json({ error: "No corals data supplied for export." });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Coral Catalog");

    worksheet.views = [{ showGridLines: true }];

    worksheet.columns = [
      { header: "Coral Photo", key: "photo", width: 25 },
      { header: "Suggested Trade Name", key: "commonName", width: 45 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 32;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF334155" } },
      };
    });

    corals.forEach((coral, index) => {
      const rowIndex = index + 2;
      const row = worksheet.getRow(rowIndex);
      row.height = 100;

      row.getCell(2).value = coral.commonName;

      const cell = row.getCell(2);
      cell.font = { name: "Segoe UI", size: 11, bold: true };
      cell.alignment = { vertical: "middle", wrapText: true };
      
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      if (coral.imageBase64) {
        try {
          const cleanBase64 = coral.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          const ext = coral.mimeType?.includes("png") ? "png" : "jpeg";

          const imageId = workbook.addImage({
            base64: cleanBase64,
            extension: ext,
          });

          worksheet.addImage(imageId, {
            tl: { col: 0.1, row: rowIndex - 1 + 0.1 },
            ext: { width: 140, height: 125 },
          });
        } catch (imgError) {
          console.error(`Failed to add image to excel row ${rowIndex}:`, imgError);
          row.getCell(1).value = "[Photo missing/error]";
          row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
        }
      } else {
        row.getCell(1).value = "[No Photo]";
        row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
      }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Coral_Inventory.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error("Excel generation error:", error);
    res.status(500).json({ error: error.message || "Failed to generate Excel catalog." });
  }
});

export default app;
