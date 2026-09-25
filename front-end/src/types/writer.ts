/** 分卷（第一卷 / 第二卷 …） */
export interface Volume {
  id: number;
  bookId: number;
  title: string;
  sortOrder: number;
  /** Number of chapters in this volume (from list aggregation). */
  chapterCount?: number;
}

/** 章节历史版本（列表项，不含正文）。 */
export interface HistoryItem {
  id: number;
  version: number;
  title: string;
  wordCount: number;
  createTime: string;
}

/** 历史版本详情（含正文）。 */
export interface HistoryDetail {
  id: number;
  version: number;
  title: string;
  content: string;
  wordCount: number;
  createTime: string;
}

/** 写作日历：某天写了多少字（UTC 日期）。 */
/** 设定资料库条目类型。 */
export type EntryType = "character" | "location" | "concept";

/** 设定资料库条目（人物 / 地点 / 设定）。 */
export interface Entry {
  id: number;
  bookId: number;
  type: EntryType;
  title: string;
  content: string;
  sortOrder: number;
  updateTime: string;
  version: number;
}

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  character: "人物",
  location: "地点",
  concept: "设定",
};
