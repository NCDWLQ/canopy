import { useCallback, useEffect, useRef, useState } from "react"

import {
  type UpdateCheckClient,
  type UpdateCheckResult,
  updateClient,
} from "@/lib/updates/client"

export type UpdateCheckState =
  { kind: "idle" } | { kind: "loading" } | UpdateCheckResult | { kind: "error" }

export type UpdateCheckController = {
  currentVersion: string | null
  state: UpdateCheckState
  check: () => Promise<void>
  openReleasePage: () => Promise<void>
}

export function useUpdateCheck(
  client: UpdateCheckClient = updateClient,
): UpdateCheckController {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [state, setState] = useState<UpdateCheckState>({ kind: "idle" })
  const requestIdRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void client
      .getCurrentVersion()
      .then((version) => {
        if (!cancelled && mountedRef.current) setCurrentVersion(version)
      })
      .catch(() => {
        // A version lookup failure does not start an update check. The UI
        // keeps the check action available and displays an unavailable value.
      })

    return () => {
      cancelled = true
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [client])

  const check = useCallback(async () => {
    if (inFlightRef.current) return

    inFlightRef.current = true
    const requestId = ++requestIdRef.current
    setState({ kind: "loading" })
    try {
      const result = await client.check()
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setCurrentVersion(result.currentVersion)
      setState(result)
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setState({ kind: "error" })
    } finally {
      inFlightRef.current = false
    }
  }, [client])

  const openReleasePage = useCallback(() => client.openReleasePage(), [client])

  return { currentVersion, state, check, openReleasePage }
}
