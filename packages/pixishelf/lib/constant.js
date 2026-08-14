import { IMAGE_FILE_EXTENSIONS, MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'

/**
 * 支持的图片格式
 * @type {string[]}
 */
export const IMAGE_EXTENSIONS = [...IMAGE_FILE_EXTENSIONS]

/**
 * 支持的视频格式
 * @type {string[]}
 */
export const VIDEO_EXTENSIONS = [...VIDEO_FILE_EXTENSIONS]

/**
 * 所有支持的媒体格式
 * @type {string[]}
 */
export const MEDIA_EXTENSIONS = [...MEDIA_FILE_EXTENSIONS]

/**
 * API 图片资源前缀
 */
export const API_IMAGE_PREFIX = '/api/v1/images/'
