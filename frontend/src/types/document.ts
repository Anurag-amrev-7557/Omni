export interface DocumentItem {
  filename: string;
  size_mb: number;
  pages: number;
  indexed?: boolean;
}

export interface CollectionStats {
  status?: string;
  total_chunks: number;
  files_count: number;
  files: string[];
  sessions_count?: number;
}

export interface UploadResponse {
  success: boolean;
  ingested_count: number;
  errors?: string[];
}
