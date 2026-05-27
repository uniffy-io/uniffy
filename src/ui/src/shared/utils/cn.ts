import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** clsx + tailwind-merge: lets conditional Tailwind class merges override each other correctly. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
