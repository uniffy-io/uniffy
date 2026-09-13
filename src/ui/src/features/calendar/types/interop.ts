export interface ImportedEventPreview {
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  repeats: boolean;
}

export interface SkippedImportEntry {
  label: string;
  reason: string;
}

export interface CalendarImportPreview {
  creatable: ImportedEventPreview[];
  duplicateCount: number;
  skipped: SkippedImportEntry[];
}

export interface CalendarImportResult {
  createdCount: number;
  duplicateCount: number;
  skipped: SkippedImportEntry[];
}

export interface CalendarFeed {
  /** Empty when no feed has been minted for this calendar. */
  url: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}
