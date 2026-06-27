import React, { useState, useRef } from "react";
import { 
  Upload, 
  Sparkles, 
  Download, 
  Trash2, 
  Loader2, 
  FileSpreadsheet, 
  AlertCircle, 
  Plus, 
  Sun, 
  Wind, 
  Layers, 
  Compass, 
  Heart,
  ChevronRight,
  CheckCircle2,
  Undo
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CoralAnalysisResult, UploadedFile } from "./types";

export default function App() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [analyzedCorals, setAnalyzedCorals] = useState<CoralAnalysisResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper: Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
    });
  };

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Process selected files
  const processFiles = async (files: FileList) => {
    setError(null);
    const validImageFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    
    if (validImageFiles.length === 0) {
      setError("Please select valid image files (PNG, JPG, JPEG, WEBP).");
      return;
    }

    const newUploadedFiles: UploadedFile[] = [];
    for (const file of validImageFiles) {
      try {
        const base64 = await fileToBase64(file);
        newUploadedFiles.push({
          id: Math.random().toString(36).substring(2, 9),
          file,
          previewUrl: URL.createObjectURL(file),
          base64,
          name: file.name,
          type: file.type,
          size: file.size
        });
      } catch (err) {
        console.error("Failed to read file:", file.name, err);
      }
    }

    setUploadedFiles(prev => [...prev, ...newUploadedFiles]);
  };

  // Handle Drop Event
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  // Handle File Input Change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  // Remove uploaded file from pending list
  const removePendingFile = (id: string) => {
    setUploadedFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove) {
        URL.revokeObjectURL(fileToRemove.previewUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  // Trigger File Input Click
  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Submit to Server for Gemini Analysis
  const analyzePhotos = async () => {
    if (uploadedFiles.length === 0) return;
    setIsAnalyzing(true);
    setError(null);

    const payload = {
      images: uploadedFiles.map(f => ({
        id: f.id,
        base64: f.base64,
        type: f.type,
        name: f.name
      }))
    };

    try {
      const response = await fetch("/api/generate-coral-names", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to analyze coral photos.");
      }

      const data = await response.json() as { corals: CoralAnalysisResult[] };
      setAnalyzedCorals(data.corals);
      
      // Clear pending list on success to move to Step 2
      setUploadedFiles([]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong while connecting to the name generator.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Update a single analyzed coral field in the local list
  const updateCoralField = (id: string, field: keyof CoralAnalysisResult, value: string) => {
    setAnalyzedCorals(prev =>
      prev.map(coral => (coral.id === id ? { ...coral, [field]: value } : coral))
    );
  };

  // Remove coral from analyzed catalog
  const removeCoralFromCatalog = (id: string) => {
    setAnalyzedCorals(prev => prev.filter(c => c.id !== id));
  };

  // Export and Download Excel file with images
  const exportToExcel = async () => {
    if (analyzedCorals.length === 0) return;
    setIsExporting(true);
    setError(null);

    try {
      const response = await fetch("/api/export-excel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ corals: analyzedCorals }),
      });

      if (!response.ok) {
        throw new Error("Failed to compile and download Excel sheet.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Coral_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to download catalog file.");
    } finally {
      setIsExporting(false);
    }
  };

  // Reset App to Start Over
  const resetApp = () => {
    setUploadedFiles([]);
    setAnalyzedCorals([]);
    setError(null);
  };

  // Compute stats for analyzed corals
  const stats = {
    total: analyzedCorals.length,
    easy: analyzedCorals.filter(c => c.careLevel?.toLowerCase() === "easy").length,
    highLight: analyzedCorals.filter(c => c.lighting?.toLowerCase() === "high").length,
    highFlow: analyzedCorals.filter(c => c.waterFlow?.toLowerCase() === "high").length,
  };

  return (
    <div className="min-h-screen bg-natural-bg text-natural-text font-sans selection:bg-natural-accent selection:text-white pb-16">
      {/* Visual background ambient details */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-natural-cream/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-40 right-1/4 w-[600px] h-[600px] bg-natural-teal/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Top Header */}
      <header className="border-b border-natural-border bg-white/80 backdrop-blur sticky top-0 z-50 px-4 py-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-natural-accent p-2.5 rounded-full shadow-md shadow-natural-accent/15">
              <Compass className="w-5 h-5 text-white animate-spin-slow" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-natural-text font-serif">
                CoralCataloguer
              </h1>
              <p className="text-xs text-natural-muted font-medium uppercase tracking-wider">Naturalist Edition • Vision AI</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {analyzedCorals.length > 0 && (
              <button
                onClick={resetApp}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-natural-muted hover:text-natural-accent border border-natural-border hover:border-natural-accent/30 rounded-full bg-white transition-all shadow-xs"
                id="btn-reset"
              >
                <Undo className="w-3.5 h-3.5" />
                Start Over
              </button>
            )}
            <div className="bg-white px-4 py-1.5 rounded-full border border-natural-border text-xs font-semibold flex items-center gap-1.5 text-natural-text shadow-xs">
              <span className="w-2 h-2 rounded-full bg-natural-teal animate-pulse" />
              Gemini 3.5 Active
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 mt-10">
        
        {/* Error Notification banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-8 p-5 bg-white border-2 border-natural-accent/30 rounded-[24px] flex items-start gap-4 text-sm text-natural-text shadow-sm"
              id="error-banner"
            >
              <AlertCircle className="w-5 h-5 text-natural-accent shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-natural-accent font-serif">Processing Error</h4>
                <p className="mt-1 leading-relaxed text-natural-muted">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)} 
                className="text-xs text-natural-accent hover:underline font-bold"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 1: Upload Workspace (When no corals are analyzed yet) */}
        {analyzedCorals.length === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Description Column */}
            <div className="lg:col-span-5 flex flex-col justify-center pr-0 lg:pr-6">
              <div className="space-y-6">
                <div>
                  <span className="px-3 py-1 bg-natural-teal/10 border border-natural-teal/25 text-natural-teal text-xs font-bold tracking-wider uppercase rounded-full">
                    Step 1 of 2
                  </span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-natural-text leading-tight font-serif">
                  Upload specimens to build your beautiful catalog
                </h2>
                <p className="text-natural-muted text-sm leading-relaxed">
                  Drop high-resolution coral photography here. Our specialist system analyzes biological features, textures, and pigmentation to suggest exquisite trade names.
                </p>
                
                <div className="space-y-4 pt-4 border-t border-natural-border/60">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-full text-natural-accent border border-natural-border shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-natural-text">Exotic Trade Names</h4>
                      <p className="text-xs text-natural-muted mt-0.5">Automates common nomenclature based on physical traits.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-full text-natural-teal border border-natural-border shadow-xs">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-natural-text">Direct Excel Compilation</h4>
                      <p className="text-xs text-natural-muted mt-0.5">Embeds thumbnail photos directly inside columns along with suggested trade names.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Interactive Upload Area */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Drag and Drop Box */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-[32px] p-10 flex flex-col items-center justify-center text-center transition-all ${
                  dragActive 
                    ? "border-natural-accent bg-natural-panel shadow-inner" 
                    : "border-natural-border bg-white hover:border-natural-muted hover:bg-natural-panel/40 shadow-xs"
                }`}
                id="drag-drop-zone"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="bg-natural-panel p-5 rounded-full border border-natural-border mb-4 text-natural-muted transition-colors">
                  <Upload className="w-8 h-8 text-natural-teal" />
                </div>

                <h3 className="text-lg font-medium text-natural-text font-serif">Drop your coral photography here</h3>
                <p className="text-sm text-natural-muted mt-1 max-w-sm">
                  or <span className="text-natural-teal hover:text-natural-teal/80 font-bold cursor-pointer underline" onClick={onButtonClick}>browse your files</span> to select multiple specimens
                </p>
                <span className="text-xs text-natural-muted mt-3 font-mono bg-natural-panel px-2 py-0.5 rounded border border-natural-border/60">Supports PNG, JPG, JPEG, WEBP</span>
              </div>

              {/* Pending Upload List */}
              {uploadedFiles.length > 0 && (
                <div className="bg-white border border-natural-border rounded-[32px] p-6 space-y-6 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-md font-bold text-natural-text flex items-center gap-2">
                        Selected Files
                        <span className="px-2.5 py-0.5 bg-natural-panel border border-natural-border text-natural-text rounded-full text-xs font-semibold">
                          {uploadedFiles.length}
                        </span>
                      </h3>
                      <p className="text-xs text-natural-muted mt-0.5">Ready to transmit to biological vision analysis</p>
                    </div>

                    <button
                      onClick={onButtonClick}
                      className="flex items-center gap-1.5 text-xs font-bold text-natural-teal hover:text-natural-teal/85"
                    >
                      <Plus className="w-4 h-4" />
                      Add More
                    </button>
                  </div>

                  {/* Grid of uploaded images */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" id="upload-grid">
                    <AnimatePresence>
                      {uploadedFiles.map((file) => (
                        <motion.div
                          key={file.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="group relative aspect-square bg-natural-panel rounded-[20px] overflow-hidden border border-natural-border shadow-xs"
                        >
                          <img
                            src={file.previewUrl}
                            alt={file.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-100 p-3 flex flex-col justify-end">
                            <span className="text-[10px] text-white font-semibold truncate max-w-full">
                              {file.name}
                            </span>
                            <span className="text-[9px] text-slate-300 font-mono mt-0.5">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </div>
                          
                          {/* Delete Hover action */}
                          <button
                            onClick={() => removePendingFile(file.id)}
                            className="absolute top-2 right-2 p-1.5 bg-white/95 text-natural-accent hover:text-natural-accent/80 rounded-full border border-natural-border shadow-sm opacity-100 transition-opacity"
                            title="Remove file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Submit Bar */}
                  <div className="border-t border-natural-border pt-5 flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div className="text-xs text-natural-muted flex items-center gap-1.5 font-medium">
                      <span className="w-2 h-2 rounded-full bg-natural-teal animate-pulse" />
                      Automatic marine model presets loaded.
                    </div>
                    
                    <button
                      onClick={analyzePhotos}
                      disabled={isAnalyzing}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-natural-accent hover:bg-natural-accent/90 text-white font-bold px-6 py-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-natural-accent/25 cursor-pointer"
                      id="btn-analyze"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Analyzing Coral Features...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Generate Coral Names & Specs
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading overlay with reassurance prompts */}
        {isAnalyzing && (
          <div className="fixed inset-0 bg-natural-bg/90 backdrop-blur-md flex flex-col items-center justify-center z-50 p-6 text-center">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="max-w-md bg-white border border-natural-border p-8 rounded-[32px] shadow-xl relative overflow-hidden"
            >
              {/* Natural Accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-natural-teal via-natural-accent to-natural-cream animate-pulse" />
              
              <Loader2 className="w-12 h-12 text-natural-teal animate-spin mx-auto mb-6" />
              
              <h3 className="text-xl font-semibold text-natural-text font-serif mb-2">Analyzing Coral Anatomy</h3>
              
              <p className="text-sm text-natural-muted leading-relaxed mb-6">
                Our marine vision model is inspecting polyp coloration, layout taxonomy, and skeletal configuration. This process will resolve in a few moments.
              </p>

              <div className="bg-natural-panel rounded-xl p-3 border border-natural-border text-xs font-mono text-natural-muted">
                Contacting server-side model instance...
              </div>
            </motion.div>
          </div>
        )}

        {/* Step 2: Display & Refine Analyzed Corals */}
        {analyzedCorals.length > 0 && (
          <div className="space-y-8">
            
            {/* Stats Dashboard header */}
            <div className="bg-white border border-natural-border p-6 rounded-[32px] flex flex-col md:flex-row gap-6 md:items-center justify-between shadow-xs">
              <div>
                <span className="px-3 py-1 bg-natural-accent/10 border border-natural-accent/20 text-natural-accent text-xs font-bold tracking-wider uppercase rounded-full">
                  Step 2 of 2
                </span>
                <h2 className="text-2xl font-semibold mt-2 text-natural-text font-serif">Review & Customize Coral Inventory</h2>
                <p className="text-xs text-natural-muted mt-1 font-medium">Verify suggested trade names. Edits persist directly to Excel.</p>
              </div>

              {/* Bento Grid Mini-Stats */}
              <div className="bg-natural-panel px-6 py-3.5 rounded-[20px] border border-natural-border flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-natural-teal animate-pulse" />
                <div className="text-sm font-semibold text-natural-text">
                  Total Corals Cataloged: <span className="font-bold text-natural-accent text-base ml-1">{stats.total}</span>
                </div>
              </div>
            </div>

            {/* Core Coral Catalog Grid */}
            <div className="grid grid-cols-1 gap-6" id="catalog-list">
              {analyzedCorals.map((coral) => (
                <div
                  key={coral.id}
                  className={`bg-white border rounded-[32px] overflow-hidden shadow-xs transition-all ${
                    coral.success ? "border-natural-border" : "border-natural-accent/30 bg-natural-accent/5"
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
                    
                    {/* Left: Interactive Image preview with file information */}
                    <div className="lg:col-span-3 flex flex-col gap-3">
                      <div className="aspect-video lg:aspect-square bg-natural-panel rounded-[20px] overflow-hidden border border-natural-border relative group shadow-inner">
                        <img
                          src={coral.imageBase64}
                          alt={coral.commonName}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        {!coral.success && (
                          <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center p-4 text-center">
                            <AlertCircle className="w-8 h-8 text-natural-accent mb-2" />
                            <span className="text-xs text-natural-accent font-bold font-serif">Analysis Failed</span>
                            <span className="text-[10px] text-natural-muted mt-1">Default metrics applied</span>
                          </div>
                        )}
                        <div className="absolute top-2 left-2 px-2.5 py-1 bg-white/90 text-[10px] text-natural-muted font-mono rounded border border-natural-border font-semibold shadow-xs">
                          {coral.fileName}
                        </div>
                      </div>
                      
                      <button
                        onClick={() => removeCoralFromCatalog(coral.id)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs text-natural-accent hover:text-white bg-natural-accent/5 hover:bg-natural-accent border border-natural-accent/10 hover:border-natural-accent rounded-[12px] transition-all font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Exclude From Catalog
                      </button>
                    </div>

                    {/* Right: Customizable Input parameters */}
                    <div className="lg:col-span-9 flex flex-col justify-center">
                      
                      {/* Name input row */}
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-natural-muted mb-2 uppercase tracking-widest flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-natural-accent animate-pulse" />
                            Suggested Trade Name (Common Name)
                          </label>
                          <input
                            type="text"
                            value={coral.commonName}
                            onChange={(e) => updateCoralField(coral.id, "commonName", e.target.value)}
                            className="w-full bg-natural-panel border border-natural-border hover:border-natural-muted focus:border-natural-teal focus:bg-white rounded-xl px-4 py-3.5 text-sm text-natural-text font-semibold outline-none transition-all shadow-2xs"
                            placeholder="e.g. Purple Monster Acropora"
                          />
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Export & Action Footer block */}
            <div className="bg-white border border-natural-border rounded-[32px] p-6 flex flex-col sm:flex-row gap-6 items-center justify-between shadow-xs">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0 border border-emerald-500/20">
                  <FileSpreadsheet className="text-emerald-600 w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-md font-semibold text-natural-text font-serif">
                    Coral Catalog Sheet is Ready
                  </h3>
                  <p className="text-xs text-natural-muted mt-0.5">Includes high-resolution embedded image files nested inside row index structures.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  onClick={resetApp}
                  className="px-6 py-3 bg-natural-panel border border-natural-border hover:border-natural-muted rounded-full text-xs font-bold text-natural-text transition-all"
                >
                  Clear & Start Over
                </button>
                <button
                  onClick={exportToExcel}
                  disabled={isExporting}
                  className="flex items-center justify-center gap-2 bg-natural-accent hover:bg-natural-accent/90 text-white font-bold px-8 py-3.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-natural-accent/25 cursor-pointer"
                  id="btn-export"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Compiling Spreadsheet...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-5 h-5" />
                      Download Excel Catalog (.xlsx)
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        )}

      </main>
    </div>
  );
}
