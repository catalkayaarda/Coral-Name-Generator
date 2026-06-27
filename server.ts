import app from "./api/index.js";
import path from "path";

const PORT = 3000;

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
    app.use(expressStaticMiddleware(distPath));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Coral Name Generator server running on http://localhost:${PORT}`);
  });
}

// Helper: static files middleware helper (using express imported inside index.ts, or we can import express here)
async function expressStaticMiddleware(distPath: string) {
  const { default: express } = await import("express");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

if (process.env.VERCEL !== "1") {
  startServer();
}

export default app;
