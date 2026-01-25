/**
 * Category type definitions for event categorization
 */

/**
 * Event category for color coding and filtering
 */
export interface Category {
  /** Unique category identifier */
  id: string;
  /** Category display name */
  name: string;
  /** Category color (hex format) */
  color: string;
  /** Optional icon or emoji */
  icon?: string;
  /** Whether this is a default/system category */
  isDefault: boolean;
  /** Organization ID */
  organizationId: string;
  /** Display order */
  sortOrder: number;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Category creation request
 */
export interface CreateCategoryRequest {
  name: string;
  color: string;
  icon?: string;
}

/**
 * Category update request
 */
export interface UpdateCategoryRequest {
  id: string;
  name?: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

/**
 * Predefined category color option
 */
export interface CategoryColorOption {
  /** Color name for display */
  name: string;
  /** Hex color value */
  value: string;
  /** Lighter variant for backgrounds */
  light: string;
}

/**
 * Default category IDs
 */
export const DEFAULT_CATEGORY_IDS = {
  MEETINGS: 'meetings',
  DEEP_WORK: 'deep_work',
  PERSONAL: 'personal',
  DEADLINE: 'deadline',
} as const;

export type DefaultCategoryId = typeof DEFAULT_CATEGORY_IDS[keyof typeof DEFAULT_CATEGORY_IDS];
