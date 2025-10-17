// Chrome扩展消息传递类型定义

// 图片下载相关类型
export interface ImageDownloadData {
  url: string;
  fileName: string;
  tagName: string;
}

export interface ImageDownloadResult {
  fileName: string;
  tagName: string;
  success: boolean;
  arrayBuffer?: ArrayBuffer;
  mimeType?: string;
  error?: string;
}

export interface DownloadImageRequest {
  type: 'DOWNLOAD_IMAGE';
  imageUrl: string;
  fileName: string;
}

export interface DownloadImageResponse {
  success: boolean;
  arrayBuffer?: ArrayBuffer;
  mimeType?: string;
  error?: string;
}

export interface DownloadImagesRequest {
  type: 'DOWNLOAD_IMAGES';
  images: ImageDownloadData[];
}

export interface DownloadImagesResponse {
  success: boolean;
  results: ImageDownloadResult[];
}

// 扩展消息类型
export type ExtensionMessage = DownloadImageRequest | DownloadImagesRequest;
export type ExtensionResponse = DownloadImageResponse | DownloadImagesResponse;