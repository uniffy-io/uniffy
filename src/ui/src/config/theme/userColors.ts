export interface UserColor {
  name: string;
  hex: string;
  ringClass: string;
  bgClass: string;
}

const PALETTE: readonly UserColor[] = [
  { name: 'rose', hex: '#f43f5e', ringClass: 'ring-rose-500', bgClass: 'bg-rose-500' },
  { name: 'amber', hex: '#f59e0b', ringClass: 'ring-amber-500', bgClass: 'bg-amber-500' },
  { name: 'emerald', hex: '#10b981', ringClass: 'ring-emerald-500', bgClass: 'bg-emerald-500' },
  { name: 'sky', hex: '#0ea5e9', ringClass: 'ring-sky-500', bgClass: 'bg-sky-500' },
  { name: 'violet', hex: '#8b5cf6', ringClass: 'ring-violet-500', bgClass: 'bg-violet-500' },
  { name: 'fuchsia', hex: '#d946ef', ringClass: 'ring-fuchsia-500', bgClass: 'bg-fuchsia-500' },
  { name: 'teal', hex: '#14b8a6', ringClass: 'ring-teal-500', bgClass: 'bg-teal-500' },
  { name: 'indigo', hex: '#6366f1', ringClass: 'ring-indigo-500', bgClass: 'bg-indigo-500' },
];

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

export function getUserColor(userId: string): UserColor {
  if (!userId) return PALETTE[0];
  return PALETTE[hashString(userId) % PALETTE.length];
}

export const USER_COLOR_PALETTE = PALETTE;
