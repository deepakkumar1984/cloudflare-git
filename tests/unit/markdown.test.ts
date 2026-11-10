import { describe, expect, it } from "vitest";
import {
  extractChecklistItems,
  parseChecklist,
  toggleChecklistItem,
} from "@shared/markdown";

const markdown = `# Plan

- [ ] First item
- [x] Second item
  * [X] Nested item

\`\`\`
- [ ] Ignored inside a fence
\`\`\`
`;

describe("markdown checklists", () => {
  it("counts task-list items outside fenced code blocks", () => {
    expect(parseChecklist(markdown)).toEqual({ total: 3, completed: 2 });
  });

  it("extracts item text and completion state", () => {
    expect(extractChecklistItems(markdown)).toEqual([
      { index: 0, text: "First item", completed: false },
      { index: 1, text: "Second item", completed: true },
      { index: 2, text: "Nested item", completed: true },
    ]);
  });

  it("toggles only the addressed item and preserves the rest", () => {
    const toggled = toggleChecklistItem(markdown, 0);
    expect(toggled).toContain("- [x] First item");
    expect(toggled).toContain("- [x] Second item");
    expect(toggled).toContain("* [X] Nested item");
    expect(toggled).toContain("- [ ] Ignored inside a fence");
    expect(parseChecklist(toggled ?? "")).toEqual({ total: 3, completed: 3 });
  });

  it("returns null when the checklist index is out of range", () => {
    expect(toggleChecklistItem(markdown, 9)).toBeNull();
  });
});
