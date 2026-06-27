export interface CoralAnalysisResult {
  id: string;
  fileName: string;
  success: boolean;
  commonName: string;
  imageBase64: string;
  mimeType: string;
  error?: string;
}

export interface UploadedFile {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  name: string;
  type: string;
  size: number;
}
