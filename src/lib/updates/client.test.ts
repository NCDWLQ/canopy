import { beforeEach, describe, expect, it, vi } from "vitest"

import { getVersion } from "@tauri-apps/api/app"
import { openUrl } from "@tauri-apps/plugin-opener"

import {
  compareStableVersions,
  createUpdateClient,
  decodeLatestRelease,
  parseStableVersion,
  UpdateCheckError,
} from "./client"
import {
  GITHUB_LATEST_RELEASE_API_URL,
  GITHUB_LATEST_RELEASE_PAGE_URL,
} from "./constants"

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}))

const mockedGetVersion = vi.mocked(getVersion)
const mockedOpenUrl = vi.mocked(openUrl)

function response(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json" },
  })
}

function dependencies(payload: unknown, init?: ResponseInit) {
  return {
    getVersion: mockedGetVersion,
    fetch: vi.fn<typeof fetch>().mockResolvedValue(response(payload, init)),
  }
}

describe("stable release decoding", () => {
  it("normalizes supported stable release versions", () => {
    expect(parseStableVersion("v0.4.0")).toBe("0.4.0")
    expect(parseStableVersion("1.2.30")).toBe("1.2.30")
    expect(parseStableVersion("01.2.3")).toBeNull()
    expect(parseStableVersion("1.2.3-beta.1")).toBeNull()
    expect(parseStableVersion("1.2")).toBeNull()
  })

  it("compares stable versions without guessing invalid input", () => {
    expect(compareStableVersions("0.4.0", "v0.3.1")).toBe(1)
    expect(compareStableVersions("0.3.1", "0.3.1")).toBe(0)
    expect(compareStableVersions("0.2.9", "0.3.0")).toBe(-1)
    expect(compareStableVersions("latest", "0.3.0")).toBeNull()
  })

  it("accepts only a published stable release shape", () => {
    expect(
      decodeLatestRelease({
        tag_name: "v0.4.0",
        draft: false,
        prerelease: false,
      }),
    ).toBe("0.4.0")
    expect(
      decodeLatestRelease({
        tag_name: "v0.4.0",
        draft: true,
        prerelease: false,
      }),
    ).toBeNull()
    expect(
      decodeLatestRelease({
        tag_name: "v0.4.0",
        draft: false,
        prerelease: true,
      }),
    ).toBeNull()
    expect(decodeLatestRelease({ tag_name: "v0.4.0" })).toBeNull()
    expect(
      decodeLatestRelease({
        tag_name: "latest",
        draft: false,
        prerelease: false,
      }),
    ).toBeNull()
  })
})

describe("createUpdateClient", () => {
  beforeEach(() => {
    mockedGetVersion.mockReset()
    mockedOpenUrl.mockReset()
    mockedOpenUrl.mockResolvedValue(undefined)
  })

  it("reports that the app is current for an equal or older release", async () => {
    mockedGetVersion.mockResolvedValue("0.3.1")
    const deps = dependencies({
      tag_name: "v0.3.1",
      draft: false,
      prerelease: false,
    })

    await expect(createUpdateClient(deps).check()).resolves.toEqual({
      kind: "up-to-date",
      currentVersion: "0.3.1",
    })
    expect(deps.fetch).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    })
  })

  it("reports a newer stable release", async () => {
    mockedGetVersion.mockResolvedValue("0.3.1")
    const client = createUpdateClient(
      dependencies({
        tag_name: "v0.4.0",
        draft: false,
        prerelease: false,
      }),
    )

    await expect(client.check()).resolves.toEqual({
      kind: "available",
      currentVersion: "0.3.1",
      latestVersion: "0.4.0",
    })
  })

  it.each([
    {
      name: "draft",
      payload: { tag_name: "v0.4.0", draft: true, prerelease: false },
    },
    {
      name: "pre-release",
      payload: { tag_name: "v0.4.0-rc.1", draft: false, prerelease: false },
    },
    { name: "missing fields", payload: { tag_name: "v0.4.0" } },
    {
      name: "invalid tag",
      payload: { tag_name: "latest", draft: false, prerelease: false },
    },
  ])("fails closed for a $name response", async ({ payload }) => {
    mockedGetVersion.mockResolvedValue("0.3.1")
    const client = createUpdateClient(dependencies(payload))

    await expect(client.check()).rejects.toBeInstanceOf(UpdateCheckError)
  })

  it("maps network and non-success responses to the safe check error", async () => {
    mockedGetVersion.mockResolvedValue("0.3.1")
    const networkFailure = createUpdateClient({
      getVersion: mockedGetVersion,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("secret body")),
    })
    await expect(networkFailure.check()).rejects.toBeInstanceOf(
      UpdateCheckError,
    )

    const serverFailure = createUpdateClient(
      dependencies({ error: "not rendered" }, { status: 503 }),
    )
    await expect(serverFailure.check()).rejects.toBeInstanceOf(UpdateCheckError)
  })

  it("fails closed when the local app version is invalid", async () => {
    mockedGetVersion.mockResolvedValue("0.3.1-dev")
    const deps = dependencies({
      tag_name: "v0.4.0",
      draft: false,
      prerelease: false,
    })

    await expect(createUpdateClient(deps).check()).rejects.toBeInstanceOf(
      UpdateCheckError,
    )
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it("opens only the fixed release page", async () => {
    mockedGetVersion.mockResolvedValue("0.3.1")
    const client = createUpdateClient(dependencies({}))

    await client.openReleasePage()

    expect(mockedOpenUrl).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_PAGE_URL)
  })
})
