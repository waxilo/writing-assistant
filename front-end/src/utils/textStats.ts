export interface ITextStats {
  wordCount: number;
  charCount: number;
}

const CJK_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const WHITESPACE_PATTERN = /\s/u;

/** Count Chinese characters and all visible characters, including punctuation. */
export function getTextStats(content: string): ITextStats {
  const wordCount = content.match(CJK_CHARACTER_PATTERN)?.length ?? 0;
  const charCount = Array.from(content).filter(
    (character) => !WHITESPACE_PATTERN.test(character)
  ).length;

  return { wordCount, charCount };
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat("zh-CN").format(count);
}
