export const MIN_SENTENCES = 10;
export const MAX_SENTENCES = 15;
export const DEFAULT_SENTENCES = 10;
export const MAX_SOURCE_LENGTH = 30000;
export type SelectionMode = "extract" | "summarize";
export interface SentenceSelection {
  selected: string[];
  excluded: { sentence: string; reason: string }[];
}
export class SelectionInputError extends Error {}
export class SelectionOutputError extends Error {}

export function selectionOptions(mode: unknown, limit: unknown): { mode: SelectionMode; limit: number } {
  const selectedMode = mode === undefined ? "extract" : mode;
  const count = limit === undefined ? DEFAULT_SENTENCES : limit;
  if (selectedMode !== "extract" && selectedMode !== "summarize") {
    throw new SelectionInputError("원문 그대로 추출 또는 요약문 만들기를 선택해 주세요.");
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < MIN_SENTENCES || count > MAX_SENTENCES) {
    throw new SelectionInputError(`문장 수는 ${MIN_SENTENCES}~${MAX_SENTENCES} 사이의 정수로 선택해 주세요.`);
  }
  return { mode: selectedMode, limit: count };
}

// Retain original spelling, punctuation and internal whitespace. ICU sometimes
// splits after a title/initial; join those boundaries before numbering.
export function sourceSentences(source: string): string[] {
  // PDF/OCR line wraps are not sentence boundaries. Equal-length spaces let
  // ICU find boundaries while offsets still map to untouched source text.
  const boundaryText = source.replace(/[\r\n\t]/g, " ");
  const pieces = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(boundaryText), item => source.slice(item.index, item.index + item.segment.length));
  const merged: string[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|e\.g|i\.e)|(?:^|\s)[A-Z])\.\s*$/.test(previous)) {
      merged[merged.length - 1] += piece;
    } else {
      merged.push(piece);
    }
  }
  return merged.map(sentence => sentence.trim()).filter(sentence => /[A-Za-z]/.test(sentence));
}

export function prepareSelection(source: unknown, mode: unknown, limit: unknown) {
  const options = selectionOptions(mode, limit);
  if (typeof source !== "string" || source.trim().length < 20) {
    throw new SelectionInputError("본문이 너무 짧아요. 전체 지문을 입력하거나 PDF·사진을 올려 주세요.");
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new SelectionInputError("본문은 30,000자까지 사용할 수 있어요. 한 과제로 만들 범위를 줄여 주세요.");
  }
  if (source.includes("[?]")) {
    throw new SelectionInputError("사진에서 읽지 못한 [?] 부분을 먼저 원문과 비교해 수정해 주세요.");
  }
  const sentences = Array.from(new Set(sourceSentences(source)));
  if (options.mode === "extract" && sentences.length < options.limit) {
    throw new SelectionInputError(`원문에서 확인된 문장은 ${sentences.length}개입니다. 문장 수를 줄이거나 지문을 추가해 주세요.`);
  }
  return { ...options, sentences };
}

export function parseSelection(text: string, sentences: string[], mode: SelectionMode, limit: number): SentenceSelection {
  let parsed: { selected?: unknown; excluded?: unknown };
  try {
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  } catch {
    throw new SelectionOutputError("문장 생성 결과의 형식을 확인하지 못했어요. 다시 시도해 주세요.");
  }
  if (!parsed || !Array.isArray(parsed.selected) || parsed.selected.length !== limit) {
    throw new SelectionOutputError(`요청한 ${limit}문장이 생성되지 않았어요. 다시 시도해 주세요.`);
  }
  const validId = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id >= 1 && id <= sentences.length;
  if (mode === "extract") {
    const ids = parsed.selected;
    if (!ids.every(validId) || new Set(ids).size !== limit) {
      throw new SelectionOutputError("원문 문장 번호가 잘못되었거나 중복되었어요. 다시 시도해 주세요.");
    }
    const selected = [...ids].sort((a, b) => a - b).map(id => sentences[id - 1]);
    const seen = new Set(ids);
    const excluded: SentenceSelection["excluded"] = [];
    if (Array.isArray(parsed.excluded)) for (const item of parsed.excluded) {
      if (!item || !validId(item.id) || seen.has(item.id) || typeof item.reason !== "string") continue;
      seen.add(item.id);
      excluded.push({ sentence: sentences[item.id - 1], reason: item.reason.trim().slice(0, 160) });
      if (excluded.length === 5) break;
    }
    return { selected, excluded };
  }
  const selected: string[] = [];
  for (const item of parsed.selected) {
    if (!item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 1000 ||
        !Array.isArray(item.source_ids) || !item.source_ids.length || !item.source_ids.every(validId) ||
        sourceSentences(item.text).length !== 1 || !/[.!?]["'”’)]?$/.test(item.text.trim()) || item.text.includes("[?]")) {
      throw new SelectionOutputError("요약 문장이나 원문 근거를 확인하지 못했어요. 다시 시도해 주세요.");
    }
    selected.push(item.text.trim());
  }
  if (new Set(selected.map(sentence => sentence.toLowerCase().replace(/\s+/g, " "))).size !== limit) {
    throw new SelectionOutputError("요약 문장에 중복이 있어요. 다시 시도해 주세요.");
  }
  return { selected, excluded: [] };
}
