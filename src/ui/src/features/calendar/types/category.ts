export interface Category {
  id: string;
  name: string;
  /** Hex. */
  color: string;
  /** Emoji or icon name. */
  icon?: string;
  isDefault: boolean;
  organizationId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  name: string;
  color: string;
  icon?: string;
}

export interface UpdateCategoryRequest {
  id: string;
  name?: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

export interface CategoryColorOption {
  name: string;
  /** Hex. */
  value: string;
  /** Lighter variant for backgrounds. */
  light: string;
}

export const DEFAULT_CATEGORY_IDS = {
  MEETINGS: 'meetings',
  DEEP_WORK: 'deep_work',
  PERSONAL: 'personal',
  DEADLINE: 'deadline',
} as const;

export type DefaultCategoryId = typeof DEFAULT_CATEGORY_IDS[keyof typeof DEFAULT_CATEGORY_IDS];
