export interface DocumentItem {
  filename: string;
  size_mb: number;
  pages: number;
  indexed?: boolean;
  status?: 'uploading' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
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
  upload_id?: string;
  ingested_count: number;
  errors?: string[];
}

export interface UploadProgress {
  upload_id: string;
  status: 'uploading' | 'completed' | 'failed';
  total_files: number;
  completed_files: number;
  files: Array<{
    filename: string;
    size_mb: number;
    status: 'uploading' | 'processing' | 'completed' | 'failed';
    progress: number;
    indexed: boolean;
    error?: string;
  }>;
}
