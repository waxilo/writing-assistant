/** A book (writing project) belonging to the user. */
export interface Book {
  id: number;
  title: string;
  sortOrder: number;
  updateTime: string;
  /** Number of chapters (optional: older API responses may omit it). */
  chapterCount?: number;
  /** Total character count across chapters (optional). */
  wordCount?: number;
}
