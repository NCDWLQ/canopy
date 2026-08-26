import { getVersion } from "@tauri-apps/api/app"
import { openUrl } from "@tauri-apps/plugin-opener"

import {
  GITHUB_LATEST_RELEASE_API_URL,
  GITHUB_LATEST_RELEASE_PAGE_URL,
} from "./constants"

type ParsedVersion = {
  major: number
  minor: number
  patch: number
  normalized: string
}

export type UpdateCheckResult =
  | { kind: "up-to-date"; currentVersion: string }
  | {
      kind: "available"
      currentVersion: string
      latestVersion: string
    }

export type UpdateClientDependencies = {
  getVersion: () => Promise<string>
  fetch: typeof fetch
}

export type UpdateCheckClient = {
  getCurrentVersion: () => Promise<string>
  check: () => Promise<UpdateCheckResult>
  openReleasePage: () => Promise<void>
}

export class UpdateCheckError extends Error {
  constructor() {
    super("Update check failed")
    this.name = "UpdateCheckError"
  }
}

const defaultDependencies: UpdateClientDependencies = {
  getVersion,
  fetch: (...args) => fetch(...args),
}

export function parseStableVersion(value: unknown): string | null {
  return parseVersion(value)?.normalized ?? null
}

export function compareStableVersions(
  left: string,
  right: string,
): number | null {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)
  if (leftVersion === null || rightVersion === null) return null

  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major > rightVersion.major ? 1 : -1
  }
  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor > rightVersion.minor ? 1 : -1
  }
  if (leftVersion.patch !== rightVersion.patch) {
    return leftVersion.patch > rightVersion.patch ? 1 : -1
  }
  return 0
}

export function decodeLatestRelease(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (value.draft !== false || value.prerelease !== false) return null
  return parseStableVersion(value.tag_name)
}

export function createUpdateClient(
  dependencies: UpdateClientDependencies = defaultDependencies,
): UpdateCheckClient {
  const getCurrentVersion = async () => {
    const version = parseStableVersion(await dependencies.getVersion())
    if (version === null) throw new UpdateCheckError()
    return version
  }

  return {
    getCurrentVersion,

    async check() {
      let currentVersion: string
      try {
        currentVersion = await getCurrentVersion()
      } catch {
        throw new UpdateCheckError()
      }

      let response: Response
      try {
        response = await dependencies.fetch(GITHUB_LATEST_RELEASE_API_URL, {
          headers: { Accept: "application/vnd.github+json" },
        })
      } catch {
        throw new UpdateCheckError()
      }

      if (!response.ok) throw new UpdateCheckError()

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new UpdateCheckError()
      }

      const latestVersion = decodeLatestRelease(payload)
      if (latestVersion === null) throw new UpdateCheckError()

      const comparison = compareStableVersions(latestVersion, currentVersion)
      if (comparison === null) throw new UpdateCheckError()
      if (comparison <= 0) return { kind: "up-to-date", currentVersion }
      return { kind: "available", currentVersion, latestVersion }
    },

    openReleasePage() {
      return openUrl(GITHUB_LATEST_RELEASE_PAGE_URL)
    },
  }
}

export const updateClient = createUpdateClient()

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (match === null) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null
  }

  return {
    major,
    minor,
    patch,
    normalized: `${major}.${minor}.${patch}`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
