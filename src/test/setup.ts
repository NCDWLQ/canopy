import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

import { useLocaleStore } from "@/lib/i18n/locale-store"

// jsdom defaults navigator.languages to ["en-US"], which the system-locale
// detection resolves to "en" and would drift every component assertion.
// The shipped copy under test is zh-CN, so pin the locale before any test
// module (and its module-scope dictionary reads) loads. `setLocale` itself
// lives on the store; the i18n barrel intentionally exports only read APIs.
useLocaleStore.getState().setLocale("zh-CN")

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function (
    this: Element,
    arg?: ScrollToOptions | number,
    y?: number,
  ) {
    if (typeof arg === "number") {
      ;(this as HTMLElement).scrollTop = y ?? arg
      return
    }
    if (arg !== undefined && typeof arg === "object" && arg.top !== undefined) {
      ;(this as HTMLElement).scrollTop = arg.top
    }
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
