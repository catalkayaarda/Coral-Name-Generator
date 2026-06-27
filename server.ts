import express from "express";
import path from "path";

import { GoogleGenAI, Type } from "@google/genai";
import ExcelJS from "exceljs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase request size limit to handle multiple base64 images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy-loaded Gemini Client pattern to prevent startup crashes when API keys are empty
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is missing. Please add it via Settings > Secrets panel.");
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
    
    // Extract all details securely, including non-enumerable properties
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

    // Analyze images sequentially to prevent concurrent high-demand limits on the model API and ensure reliable execution
    const results = [];
    for (let index = 0; index < images.length; index++) {
      const img = images[index];
      try {
        // Strip out the data url prefix if it's there
        const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, "");

        const prompt = "Analyze this coral photo. Determine a beautiful, catchy trade name for it " +
          "(e.g., 'Dragon Soul Torch', 'Sunset Montipora', 'Neon Green Star Polyps', 'Space Invader Pectinia').";

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
                text: prompt,
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

    // Enable grid lines
    worksheet.views = [{ showGridLines: true }];

    // Define columns
    worksheet.columns = [
      { header: "Coral Photo", key: "photo", width: 25 },
      { header: "Suggested Trade Name", key: "commonName", width: 45 },
    ];

    // Style Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.height = 32;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" }, // Deep ocean slate-900
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF334155" } },
      };
    });

    // Populate Coral Data and Embed Photos
    corals.forEach((coral, index) => {
      const rowIndex = index + 2; // Rows are 1-based, index 1 is headers
      const row = worksheet.getRow(rowIndex);
      
      // Set fixed height of row to fit a 120px tall image comfortably
      row.height = 100;

      // Assign non-photo values
      row.getCell(2).value = coral.commonName;

      // Formatting data cells
      const cell = row.getCell(2);
      cell.font = { name: "Segoe UI", size: 11, bold: true };
      cell.alignment = { vertical: "middle", wrapText: true };
      
      // Add light borders between entries
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      // Embed the photo directly into the worksheet cell!
      if (coral.imageBase64) {
        try {
          // Strip base64 headers
          const cleanBase64 = coral.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          const ext = coral.mimeType?.includes("png") ? "png" : "jpeg";

          const imageId = workbook.addImage({
            base64: cleanBase64,
            extension: ext,
          });

          // Place inside row, column 1 (photo)
          worksheet.addImage(imageId, {
            tl: { col: 0.1, row: rowIndex - 1 + 0.1 },
            ext: { width: 140, height: 125 }, // Fitted nicely to cell width (approx 25 characters = 180px) and height (100pt = 133px)
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

    // Generate output and send
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

// Serve frontend with Vite configuration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Coral Name Generator server running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== "1") {
  startServer();
}

export default app;

