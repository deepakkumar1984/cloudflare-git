export interface ChecklistProgress {
  total: number;
  completed: number;
}

const CHECKBOX_RE = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+.*)$/;

/**
 * Counts GitHub-flavoured task-list items outside fenced code blocks.
 */
export function parseChecklist(markdown: string): ChecklistProgress {
  let inFence = false;
  let total = 0;
  let completed = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CHECKBOX_RE.exec(line);
    if (!match) continue;
    total += 1;
    if ((match[2] ?? " ").toLowerCase() === "x") completed += 1;
  }
  return { total, completed };
}

/**
 * Toggles the nth task-list item (zero-based) and returns the new markdown.
 * Returns null when the index does not resolve to a task.
 */
export function toggleChecklistItem(
  markdown: string,
  index: number
): string | null {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let current = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CHECKBOX_RE.exec(line);
    if (!match) continue;
    if (current === index) {
      const checked = (match[2] ?? " ").toLowerCase() === "x";
      lines[lineIndex] = `${match[1]}${checked ? " " : "x"}${match[3]}`;
      return lines.join("\n");
    }
    current += 1;
  }
  return null;
}

export interface ChecklistItem {
  index: number;
  text: string;
  completed: boolean;
}

export function extractChecklistItems(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  let inFence = false;
  let index = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CHECKBOX_RE.exec(line);
    if (!match) continue;
    const checked = (match[2] ?? " ").toLowerCase() === "x";
    const text = (match[3] ?? "").replace(/^\]\s*/, "").trim();
    items.push({ index, text, completed: checked });
    index += 1;
  }
  return items;
}
