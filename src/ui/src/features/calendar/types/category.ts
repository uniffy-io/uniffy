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

export interface CategoryColorOption {
  name: string;
  /** Hex. */
  value: string;
  /** Lighter variant for backgrounds. */
  light: string;
}
