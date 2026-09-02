import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"

import { ConversationPane } from "./ConversationPane"
import type { PathMessageView } from "../types"
import { useLocaleStore } from "@/lib/i18n/locale-store"

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
)

function installScrollIntoView(mock: ReturnType<typeof vi.fn>) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: mock,
  })
}

const overflowViewportRect = {
  x: 0,
  y: 0,
  top: 0,
  bottom: 400,
  left: 0,
  right: 800,
  width: 800,
  height: 400,
  toJSON: () => ({}),
}

const overflowContentRect = {
  x: 0,
  y: 0,
  top: 0,
  bottom: 2000,
  left: 0,
  right: 800,
  width: 800,
  height: 2000,
  toJSON: () => ({}),
}

function mockOverflowMetrics(
  viewport: HTMLElement,
  scrollTop: number,
): {
  getScrollTop: () => number
  setScrollTop: (value: number) => void
  setScrollHeight: (value: number) => void
} {
  let top = scrollTop
  let height = 2000
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollHeight: {
      configurable: true,
      get: () => height,
    },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value
      },
    },
  })
  return {
    getScrollTop: () => top,
    setScrollTop: (value: number) => {
      top = value
    },
    setScrollHeight: (value: number) => {
      height = value
    },
  }
}

function installOverflowRects(viewport: HTMLElement) {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this === viewport) {
        return overflowViewportRect
      }
      const scrolled = viewport.scrollTop
      return {
        ...overflowContentRect,
        top: overflowContentRect.top - scrolled,
        bottom: overflowContentRect.bottom - scrolled,
        y: overflowContentRect.y - scrolled,
        toJSON: () => ({}),
      }
    })
}

function jumpButton(): HTMLElement | null {
  return document.querySelector('[data-slot="message-scroller-button"]')
}

function defineElementScrollTo() {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: Element, arg?: ScrollToOptions | number, y?: number) {
      if (typeof arg === "number") {
        ;(this as HTMLElement).scrollTop = y ?? arg
        return
      }
      if (
        arg !== undefined &&
        typeof arg === "object" &&
        arg.top !== undefined
      ) {
        ;(this as HTMLElement).scrollTop = arg.top
      }
    },
  })
}

afterEach(() => {
  useLocaleStore.getState().setLocale("zh-CN")
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  } else {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    )
  }
})

const user1: PathMessageView = {
  id: "user-1",
  role: "user",
  content: "USER_1_CONTENT",
  createdAt: 1,
  metadata: null,
}

const assistant1: PathMessageView = {
  id: "assistant-1",
  role: "assistant",
  content: "ASSISTANT_1_CONTENT",
  createdAt: 2,
  metadata: null,
}

const user2: PathMessageView = {
  id: "user-2",
  role: "user",
  content: "USER_2_CONTENT",
  createdAt: 3,
  metadata: null,
}

const assistant2: PathMessageView = {
  id: "assistant-2",
  role: "assistant",
  content: "ASSISTANT_2_CONTENT",
  createdAt: 4,
  metadata: null,
}

describe("ConversationPane", () => {
  it("renders the localized pending branch marker immediately after its assistant origin", () => {
    render(
      <ConversationPane
        path={[user1, assistant1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        pendingBranchOriginId={assistant1.id}
      />,
    )

    const marker = screen.getByRole("separator", {
      name: "由此处创建分支",
    })
    const assistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")

    expect(marker).toBeVisible()
    expect(marker).toHaveAttribute("data-variant", "separator")
    expect(marker).toHaveTextContent("由此处创建分支")
    expect(marker.querySelector('[data-slot="marker-icon"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    expect(marker.querySelector('[data-slot="marker-icon"] svg')).not.toBeNull()
    // Messages are wrapped in a scroller item; the marker must immediately
    // follow the origin message's row.
    expect(assistantArticle?.parentElement?.nextElementSibling).toBe(marker)

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(
      screen.getByRole("separator", { name: "Branch from here" }),
    ).toHaveTextContent("Branch from here")
  })

  it("passes userGenerationAction only to the last user message on the path", () => {
    const onSelect = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        userGenerationAction={{ kind: "generate", onSelect }}
      />,
    )

    const buttons = screen.getAllByRole("button", { name: "生成回复" })
    expect(buttons).toHaveLength(1)

    // The button belongs to the user-2 message article
    const user2Article = screen.getByText("USER_2_CONTENT").closest("article")
    expect(user2Article).not.toBeNull()
    expect(user2Article).toContainElement(buttons[0]!)

    const user1Article = screen.getByText("USER_1_CONTENT").closest("article")
    expect(user1Article).not.toBeNull()
    expect(
      within(user1Article!).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
  })

  it("renders '回复已停止' and '重新生成' on cancelled transient generation", async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={{
          phase: "cancelled",
          content: "CANCELLED_PARTIAL_CONTENT",
        }}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getByText("CANCELLED_PARTIAL_CONTENT")).toBeVisible()
    expect(screen.getByText("回复已停止")).toBeVisible()

    const regenerateBtn = screen.getByRole("button", { name: "重新生成" })
    expect(regenerateBtn).toBeVisible()
    expect(regenerateBtn).toHaveAttribute("aria-label", "重新生成")
    expect(regenerateBtn).toHaveAttribute("data-variant", "ghost")
    expect(regenerateBtn).toHaveAttribute("data-size", "icon")
    expect(regenerateBtn).toHaveClass("size-7")
    expect(regenerateBtn).toHaveClass(
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(regenerateBtn).toHaveTextContent("")
    expect(regenerateBtn.querySelector("svg")).toHaveClass("size-3.5")
    expect(regenerateBtn.parentElement).not.toHaveClass("opacity-0")

    await user.click(regenerateBtn)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("renders '回复失败' and '重新生成' on failed transient generation", async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={{
          phase: "failed",
          failureKind: "generation",
        }}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getByText("回复失败")).toBeVisible()
    const regenerateBtn = screen.getByRole("button", { name: "重新生成" })
    expect(regenerateBtn).toBeVisible()
    expect(regenerateBtn).toHaveAttribute("aria-label", "重新生成")
    expect(regenerateBtn).toHaveAttribute("data-variant", "ghost")
    expect(regenerateBtn).toHaveAttribute("data-size", "icon")
    expect(regenerateBtn).toHaveClass("size-7")
    expect(regenerateBtn).toHaveClass(
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(regenerateBtn).toHaveTextContent("")
    expect(regenerateBtn.querySelector("svg")).toHaveClass("size-3.5")
    expect(regenerateBtn.parentElement).not.toHaveClass("opacity-0")

    await user.click(regenerateBtn)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("routes one assistant regeneration action only to the final assistant", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1, user2, assistant2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: assistant2.id,
          onSelect,
        }}
      />,
    )

    const buttons = screen.getAllByRole("button", { name: "重新生成" })
    expect(buttons).toHaveLength(1)
    const regenBtn = buttons[0]!
    expect(regenBtn).toBeVisible()

    const finalAssistantArticle = screen
      .getByText(assistant2.content)
      .closest("article")
    const earlierAssistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")
    expect(finalAssistantArticle).toContainElement(regenBtn)
    expect(
      within(earlierAssistantArticle!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()

    await user.click(regenBtn)
    expect(onSelect).toHaveBeenCalledWith(assistant2.id)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("does not route a durable assistant action to an earlier message or alongside a transient recovery", () => {
    const props = {
      status: "ready" as const,
      canBranch: () => false,
      canEdit: () => false,
      onCreateBranch: vi.fn(),
      onEditAsBranch: vi.fn(),
      onRegenerate: vi.fn(),
    }
    const { rerender } = render(
      <ConversationPane
        {...props}
        path={[user1, assistant1, user2]}
        transientGeneration={null}
        assistantRegenerationAction={{
          assistantNodeId: assistant1.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()

    rerender(
      <ConversationPane
        {...props}
        path={[user1, assistant1]}
        transientGeneration={{ phase: "cancelled", content: "PARTIAL" }}
        assistantRegenerationAction={{
          assistantNodeId: assistant1.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    const assistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")
    expect(
      within(assistantArticle!).queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "重新生成" })).toHaveLength(1)
  })

  describe("auto-scroll", () => {
    const scrollIntoView = vi.fn()
    let scrollTo: MockInstance

    beforeEach(() => {
      installScrollIntoView(scrollIntoView)
      scrollIntoView.mockClear()
      defineElementScrollTo()
      scrollTo = vi.spyOn(Element.prototype, "scrollTo")
    })

    const props = {
      status: "ready" as const,
      canBranch: () => false,
      canEdit: () => false,
      onCreateBranch: vi.fn(),
      onEditAsBranch: vi.fn(),
      onRegenerate: vi.fn(),
    }

    function prepareOverflow(scrollTop: number) {
      const viewport = screen.getByTestId("conversation-pane")
      const metrics = mockOverflowMetrics(viewport, scrollTop)
      const rectSpy = installOverflowRects(viewport)
      return { viewport, metrics, rectSpy }
    }

    function stubResizeObservers(): ResizeObserverCallback[] {
      const observers: ResizeObserverCallback[] = []
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: ResizeObserverCallback) {
            observers.push(callback)
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      )
      return observers
    }

    async function flushObservers(observers: ResizeObserverCallback[]) {
      await act(async () => {
        for (const callback of observers) {
          callback([], {} as ResizeObserver)
        }
        await new Promise((resolve) => {
          requestAnimationFrame(resolve)
        })
      })
    }

    it("does not scroll when the same path is rebuilt with new identities", () => {
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )
      const { rectSpy } = prepareOverflow(0)
      scrollTo.mockClear()

      // Identity churn mirrors unrelated store updates such as background
      // generation deltas in another conversation.
      rerender(
        <ConversationPane
          {...props}
          path={[{ ...user1 }, { ...assistant1 }]}
          transientGeneration={null}
        />,
      )
      expect(scrollTo).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
      rectSpy.mockRestore()
    })

    it("follows streaming growth while the viewport stays in live-edge mode", async () => {
      const observers = stubResizeObservers()
      render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
        />,
      )
      expect(observers.length).toBeGreaterThan(0)
      const { metrics, rectSpy } = prepareOverflow(1500)
      scrollTo.mockClear()
      await flushObservers(observers)
      expect(scrollTo).toHaveBeenCalled()
      expect(metrics.getScrollTop()).toBe(1600)
      rectSpy.mockRestore()
    })

    it("scrolls when the displayed tail changes but not when transient content grows", () => {
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )
      const { metrics, rectSpy } = prepareOverflow(0)
      scrollTo.mockClear()

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          transientGeneration={null}
        />,
      )
      expect(scrollTo).toHaveBeenCalled()
      expect(metrics.getScrollTop()).toBe(1600)
      const afterPathChange = scrollTo.mock.calls.length

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
        />,
      )
      const afterTransientAppears = scrollTo.mock.calls.length

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL_GROWN",
            thinking: "",
          }}
        />,
      )
      expect(scrollTo.mock.calls.length).toBe(afterTransientAppears)
      expect(afterTransientAppears).toBeGreaterThanOrEqual(afterPathChange)
      expect(scrollIntoView).not.toHaveBeenCalled()
      rectSpy.mockRestore()
    })

    it("keeps the jump-to-latest control hidden at the live edge", () => {
      render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )

      const button = jumpButton()
      expect(button).not.toBeNull()
      expect(button).toHaveAttribute("data-active", "false")
      expect(button).toHaveAttribute("aria-label", "滚动到最新")
      expect(button).toHaveAttribute("inert")
      expect(button).toHaveAttribute("tabindex", "-1")
    })

    it("releases follow while scrolled away, then jumps back and resumes", async () => {
      const user = userEvent.setup()
      const observers = stubResizeObservers()
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
        />,
      )

      const { viewport, metrics, rectSpy } = prepareOverflow(0)
      fireEvent.wheel(viewport, { deltaY: -120 })
      fireEvent.scroll(viewport)
      scrollTo.mockClear()

      const button = jumpButton()
      expect(button).toHaveAttribute("data-active", "true")
      expect(screen.getByRole("button", { name: "滚动到最新" })).toBeVisible()

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL_GROWN",
            thinking: "",
          }}
        />,
      )
      expect(metrics.getScrollTop()).toBe(0)
      expect(scrollTo).not.toHaveBeenCalled()

      await user.click(screen.getByRole("button", { name: "滚动到最新" }))
      expect(metrics.getScrollTop()).toBe(1600)
      expect(jumpButton()).toHaveAttribute("data-active", "false")

      metrics.setScrollHeight(2400)
      scrollTo.mockClear()
      await flushObservers(observers)
      expect(scrollTo).toHaveBeenCalled()
      expect(metrics.getScrollTop()).toBe(2000)

      rectSpy.mockRestore()
    })

    it("resumes live-edge following after the user scrolls back to the bottom", async () => {
      const observers = stubResizeObservers()
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
        />,
      )

      const { viewport, metrics, rectSpy } = prepareOverflow(0)
      fireEvent.wheel(viewport, { deltaY: -120 })
      fireEvent.scroll(viewport)
      expect(jumpButton()).toHaveAttribute("data-active", "true")

      metrics.setScrollTop(1600)
      fireEvent.scroll(viewport)
      expect(jumpButton()).toHaveAttribute("data-active", "false")

      metrics.setScrollHeight(2400)
      scrollTo.mockClear()
      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL_GROWN",
            thinking: "",
          }}
        />,
      )
      await flushObservers(observers)
      expect(scrollTo).toHaveBeenCalled()
      expect(metrics.getScrollTop()).toBe(2000)

      rectSpy.mockRestore()
    })

    it("is keyboard-operable and localizes the jump control", async () => {
      const user = userEvent.setup()
      render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )

      const { viewport, rectSpy } = prepareOverflow(0)
      fireEvent.wheel(viewport, { deltaY: -120 })
      fireEvent.scroll(viewport)

      const button = screen.getByRole("button", { name: "滚动到最新" })
      expect(button.querySelector("svg")).not.toBeNull()
      button.focus()
      expect(button).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(jumpButton()).toHaveAttribute("data-active", "false")

      act(() => {
        useLocaleStore.getState().setLocale("en")
      })
      fireEvent.wheel(viewport, { deltaY: -120 })
      fireEvent.scroll(viewport)
      expect(
        screen.getByRole("button", { name: "Scroll to latest" }),
      ).toBeVisible()

      rectSpy.mockRestore()
    })

    it("does not follow the live edge while a reveal owns the viewport", () => {
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
          reveal={{ conversationId: "c1", nodeId: user1.id, query: "USER_1" }}
        />,
      )
      const { metrics, rectSpy } = prepareOverflow(0)
      scrollTo.mockClear()

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          status="streaming"
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL_GROWN",
            thinking: "",
          }}
          reveal={{ conversationId: "c1", nodeId: user1.id, query: "USER_1" }}
        />,
      )
      expect(scrollTo).not.toHaveBeenCalled()
      expect(metrics.getScrollTop()).toBe(0)
      rectSpy.mockRestore()
    })

    it("uses instant jump scrolling when reduced motion is requested", () => {
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )
      prepareOverflow(0)
      scrollTo.mockClear()

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          transientGeneration={null}
        />,
      )
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "auto" }),
      )
    })
  })
})

describe("ConversationPane search reveal", () => {
  it("anchors every message with its node id and scrolls the revealed hit into view", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)

    const { rerender } = render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
      />,
    )
    expect(
      screen.getByText("USER_1_CONTENT").closest("article"),
    ).toHaveAttribute("data-node-id", "user-1")
    expect(
      screen.getByText("USER_2_CONTENT").closest("article"),
    ).toHaveAttribute("data-node-id", "user-2")
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    )

    rerender(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-1", query: "USER_1" }}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    // The scroll targets the matched text, not the message article: a long
    // message anchored on its article can leave the match off-screen.
    const scrollTarget = scrollIntoView.mock.contexts.at(-1) as
      Element | undefined
    expect(scrollTarget?.tagName).toBe("MARK")
  })

  it("uses instant match scrolling when reduced motion is requested", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: user1.id, query: "USER_1" }}
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      inline: "nearest",
      behavior: "auto",
    })
  })

  it("aligns the exact assistant match range to the container top inside a long markdown block", () => {
    const scrollIntoView = vi.fn()
    const scrollBy = vi.fn()
    installScrollIntoView(scrollIntoView)
    const originalScrollBy = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollBy",
    )
    Object.defineProperty(Element.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy,
    })

    const originalRangeRect = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getBoundingClientRect",
    )
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => ({
        top: 820,
        bottom: 840,
        left: 0,
        right: 80,
        width: 80,
        height: 20,
        x: 0,
        y: 820,
        toJSON: () => ({}),
      })),
    })
    const elementRectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        top: 100,
        bottom: 500,
        left: 0,
        right: 800,
        width: 800,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      })

    try {
      render(
        <ConversationPane
          path={[
            {
              ...assistant1,
              content: `${"long markdown text ".repeat(100)}NEEDLE tail`,
            },
          ]}
          status="ready"
          canBranch={() => false}
          canEdit={() => false}
          onCreateBranch={vi.fn()}
          onEditAsBranch={vi.fn()}
          transientGeneration={null}
          onRegenerate={vi.fn()}
          reveal={{
            conversationId: "c1",
            nodeId: assistant1.id,
            query: "needle",
          }}
        />,
      )

      expect(scrollBy).toHaveBeenCalledWith({
        top: 720,
        behavior: "smooth",
      })
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (originalRangeRect === undefined) {
        Reflect.deleteProperty(Range.prototype, "getBoundingClientRect")
      } else {
        Object.defineProperty(
          Range.prototype,
          "getBoundingClientRect",
          originalRangeRect,
        )
      }
      elementRectSpy.mockRestore()
      if (originalScrollBy === undefined) {
        Reflect.deleteProperty(Element.prototype, "scrollBy")
      } else {
        Object.defineProperty(Element.prototype, "scrollBy", originalScrollBy)
      }
    }
  })

  it("highlights matches only inside the revealed message", () => {
    const { container } = render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-1", query: "USER_1" }}
      />,
    )

    const user1Article = container.querySelector('[data-node-id="user-1"]')
    expect(user1Article?.querySelector("mark")?.textContent).toBe("USER_1")

    const user2Article = container.querySelector('[data-node-id="user-2"]')
    expect(user2Article?.querySelector("mark")).toBeNull()
    expect(user2Article?.textContent).toContain("USER_2_CONTENT")
  })

  it("marks only the first occurrence inside the revealed message", () => {
    const twice: PathMessageView = {
      id: "user-twice",
      role: "user",
      content: "NEEDLE first then needle again",
      createdAt: 2,
      metadata: null,
    }
    const { container } = render(
      <ConversationPane
        path={[user1, twice]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-twice", query: "needle" }}
      />,
    )

    const article = container.querySelector('[data-node-id="user-twice"]')
    const marks = article?.querySelectorAll("mark") ?? []
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe("NEEDLE")
    expect(article?.textContent).toBe("NEEDLE first then needle again")
  })

  it("anchors an assistant highlight in message content, not thinking UI", () => {
    installScrollIntoView(vi.fn())
    class TestHighlight {
      readonly ranges: readonly Range[]

      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    const registry = new Map<string, unknown>()
    vi.stubGlobal("CSS", { highlights: registry })
    vi.stubGlobal("Highlight", TestHighlight)

    render(
      <ConversationPane
        path={[
          {
            ...assistant1,
            thinking: "thinking NEEDLE must not win",
            content: "rendered NEEDLE is the searchable content",
          },
        ]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{
          conversationId: "c1",
          nodeId: assistant1.id,
          query: "needle",
        }}
      />,
    )

    const highlight = registry.get("canopy-search-reveal") as TestHighlight
    expect(highlight.ranges[0]?.toString()).toBe("NEEDLE")
    expect(
      highlight.ranges[0]?.startContainer.parentElement?.closest(
        ".assistant-markdown",
      ),
    ).not.toBeNull()
  })

  it("does not scroll when the reveal carries no node id", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)

    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: null, query: "USER_1" }}
      />,
    )
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    )
    expect(screen.queryByText("USER_1_CONTENT")).toBeInTheDocument()
  })

  it("scrolls the revealed message row to the container top for queryless reveals", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)

    render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        // Panorama "open in conversation" reveal: a node id without a query.
        reveal={{ conversationId: "c1", nodeId: assistant1.id, query: "" }}
      />,
    )

    const container = screen.getByTestId("conversation-pane")
    const row = container.querySelector(
      `[data-message-row-id="${assistant1.id}"]`,
    )
    expect(row).not.toBeNull()
    // The row itself is the scroll target so the message lands at the top
    // of the pane regardless of its height.
    expect(scrollIntoView.mock.contexts).toContain(row)
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start", behavior: "smooth" }),
    )
  })
})
