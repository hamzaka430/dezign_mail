/**
 * Attachment limits
 */
export const ATTACHMENT_LIMITS = {
  MAX_SIZE: 50 * 1024 * 1024, // 50 MB
  MAX_COUNT_PER_EMAIL: 10,
  ALLOWED_TYPES: [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Documents
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    // Other
    'application/json',
    'application/xml',
    'text/xml',
    'application/octet-stream',
  ] as const,
} as const

/** Maximum HTML size that will be converted to plain text (900 KB) */
export const HTML_MAX_CONVERT_SIZE = 900 * 1024
