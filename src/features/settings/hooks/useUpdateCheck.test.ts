import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { UpdateCheckClient, UpdateCheckResult } from "@/lib/updates/client"

import { useUpdateCheck } from "./useUpdateCheck"

function client(overrides: Partial<UpdateCheckClient> = {}): UpdateCheckClient {
  return {
    getCurrentVersion: vi.fn().mockResolvedValue("0.3.1"),
    check: vi.fn().mockResolvedValue({
      kind: "up-to-date",
      currentVersion: "0.3.1",
    } satisfies UpdateCheckResult),
    openReleasePage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("useUpdateCheck", () => {
  it("loads the local version without starting a network check", async () => {
    const updateClient = client()
    const { result } = renderHook(() => useUpdateCheck(updateClient))

    await waitFor(() => expect(result.current.currentVersion).toBe("0.3.1"))
    expect(updateClient.check).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ kind: "idle" })
  })

  it("prevents duplicate checks and exposes the result", async () => {
    let resolveCheck: ((result: UpdateCheckResult) => void) | undefined
    const check = vi.fn(
      () =>
        new Promise<UpdateCheckResult>((resolve) => {
          resolveCheck = resolve
        }),
    )
    const updateClient = client({ check })
    const { result } = renderHook(() => useUpdateCheck(updateClient))

    act(() => {
      void result.current.check()
      void result.current.check()
    })
    expect(result.current.state).toEqual({ kind: "loading" })
    expect(check).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCheck?.({
        kind: "available",
        currentVersion: "0.3.1",
        latestVersion: "0.4.0",
      })
      await Promise.resolve()
    })
    expect(result.current.state).toEqual({
      kind: "available",
      currentVersion: "0.3.1",
      latestVersion: "0.4.0",
    })
  })

  it("maps a rejected check to a retryable UI error and allows retry", async () => {
    const check = vi
      .fn<UpdateCheckClient["check"]>()
      .mockRejectedValueOnce(new Error("provider body"))
      .mockResolvedValueOnce({
        kind: "up-to-date",
        currentVersion: "0.3.1",
      })
    const updateClient = client({ check })
    const { result } = renderHook(() => useUpdateCheck(updateClient))

    await act(async () => {
      await result.current.check()
    })
    expect(result.current.state).toEqual({ kind: "error" })

    await act(async () => {
      await result.current.check()
    })
    expect(result.current.state).toEqual({
      kind: "up-to-date",
      currentVersion: "0.3.1",
    })
  })

  it("delegates the release-page action to the update boundary", async () => {
    const updateClient = client()
    const { result } = renderHook(() => useUpdateCheck(updateClient))

    await act(async () => {
      await result.current.openReleasePage()
    })
    expect(updateClient.openReleasePage).toHaveBeenCalledTimes(1)
  })
})
