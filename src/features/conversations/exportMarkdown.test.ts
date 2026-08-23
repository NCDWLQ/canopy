import { describe, expect, it } from "vitest"

import { buildExportMarkdown, sanitizeExportFilename } from "./exportMarkdown"

const labels = { userLabel: "用户", assistantLabel: "助手" }

describe("buildExportMarkdown", () => {
  it("renders the H1 title and alternating role sections in path order", () => {
    const markdown = buildExportMarkdown({
      title: "Branch proof",
      userLabel: "用户",
      assistantLabel: "助手",
      messages: [
        { id: "root", role: "user", content: "ROOT_SENTINEL" },
        { id: "assistant", role: "assistant", content: "**reply**" },
        { id: "right", role: "user", content: "RIGHT_SENTINEL" },
      ],
    })

    expect(markdown).toBe(
      [
        "# Branch proof",
        "",
        "## 用户",
        "",
        "ROOT_SENTINEL",
        "",
        "## 助手",
        "",
        "**reply**",
        "",
        "## 用户",
        "",
        "RIGHT_SENTINEL",
        "",
      ].join("\n"),
    )
  })

  it("defensively drops system and tool roles while preserving alternation", () => {
    const markdown = buildExportMarkdown({
      ...labels,
      title: "Mixed",
      messages: [
        { id: "root", role: "user", content: "u1" },
        { id: "sys", role: "system", content: "SYSTEM_SENTINEL" },
        { id: "assistant", role: "assistant", content: "a1" },
        { id: "tool", role: "tool", content: "TOOL_SENTINEL" },
        { id: "user", role: "user", content: "u2" },
      ],
    })

    expect(markdown).not.toContain("SYSTEM_SENTINEL")
    expect(markdown).not.toContain("TOOL_SENTINEL")
    expect(markdown).toBe(
      "# Mixed\n\n## 用户\n\nu1\n\n## 助手\n\na1\n\n## 用户\n\nu2\n",
    )
  })

  it("keeps user content verbatim including markdown-active characters", () => {
    const markdown = buildExportMarkdown({
      ...labels,
      title: "Verbatim",
      messages: [
        {
          id: "root",
          role: "user",
          content: "  # not a heading\n``` fenced\n",
        },
      ],
    })

    expect(markdown).toBe(
      "# Verbatim\n\n## 用户\n\n  # not a heading\n``` fenced\n\n",
    )
  })

  it("emits only the title heading when every message is filtered out", () => {
    expect(
      buildExportMarkdown({
        ...labels,
        title: "Empty",
        messages: [{ id: "sys", role: "system", content: "hidden" }],
      }),
    ).toBe("# Empty\n")
  })
})

describe("sanitizeExportFilename", () => {
  it("strips characters illegal on Windows and macOS", () => {
    expect(sanitizeExportFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("abcdefghij")
  })

  it("strips control characters and trims surrounding whitespace", () => {
    expect(sanitizeExportFilename("  标题\u0007名字\u001f  ")).toBe("标题名字")
  })

  it("caps the result at 80 unicode scalars", () => {
    const title = "界".repeat(120)
    expect(Array.from(sanitizeExportFilename(title))).toHaveLength(80)
  })

  it("falls back when nothing usable remains", () => {
    expect(sanitizeExportFilename("")).toBe("conversation")
    expect(sanitizeExportFilename('  /*?"<>|\\ \u0000 ')).toBe("conversation")
  })

  it("keeps a normal title untouched", () => {
    expect(sanitizeExportFilename("Branch proof")).toBe("Branch proof")
  })
})
