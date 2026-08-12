import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { resolveApiKeyAction } from "./apiKeyAction"
import { GlobalSettingsDialog } from "./GlobalSettingsDialog"
import { useProviderProfileStore } from "../store"
import type { ProviderProfileView } from "../types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"

const profile: ProviderProfileView = {
  baseEndpoint: "http://127.0.0.1:7788/v1",
  model: "fixture-model",
  hasApiKey: true,
  updatedAt: 10,
}

function createClient() {
  return {
    saveProviderProfile: vi.fn<ProviderClient["saveProviderProfile"]>(),
    loadProviderProfile: vi.fn<ProviderClient["loadProviderProfile"]>(),
    deleteProviderProfile: vi.fn<ProviderClient["deleteProviderProfile"]>(),
    generateFromActivePath: vi.fn<ProviderClient["generateFromActivePath"]>(),
    cancelGeneration: vi.fn<ProviderClient["cancelGeneration"]>(),
    commitGeneration: vi.fn<ProviderClient["commitGeneration"]>(),
  } satisfies ProviderClient
}

describe("GlobalSettingsDialog", () => {
  let client: ReturnType<typeof createClient>

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    client = createClient()
    useProviderProfileStore.setState({ phase: "ready", profile })
  })

  it("maps key intent without retaining a secret in global state", () => {
    expect(resolveApiKeyAction(profile, "", false)).toEqual({ action: "keep" })
    expect(resolveApiKeyAction(profile, "", true)).toEqual({
      action: "remove",
    })
    expect(resolveApiKeyAction(profile, "replacement", false)).toEqual({
      action: "replace",
      value: "replacement",
    })
    expect(resolveApiKeyAction(null, "", false)).toEqual({ action: "remove" })
  })

  it("submits a replacement by keyboard and clears it from the DOM and store", async () => {
    const user = userEvent.setup()
    const secret = "DIALOG_SECRET_SENTINEL"
    client.saveProviderProfile.mockResolvedValueOnce({
      ...profile,
      updatedAt: 11,
    })
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Settings")
    expect(screen.getByRole("heading", { name: "Provider" })).toBeVisible()
    const keyInput = screen.getByLabelText("API key")
    expect(keyInput).toHaveAttribute("type", "password")
    expect(keyInput).toHaveAttribute("autocomplete", "new-password")
    await user.type(keyInput, secret)
    await user.keyboard("{Enter}")

    await waitFor(() => {
      expect(client.saveProviderProfile).toHaveBeenCalledWith({
        baseEndpoint: profile.baseEndpoint,
        model: profile.model,
        apiKey: { action: "replace", value: secret },
      })
      expect(keyInput).toHaveValue("")
    })
    expect(document.body).not.toHaveTextContent(secret)
    expect(JSON.stringify(useProviderProfileStore.getState())).not.toContain(
      secret,
    )
  })

  it("opens by keyboard, clears an unsaved secret on close, and restores focus", async () => {
    const user = userEvent.setup()
    const secret = "UNSAVED_SECRET_SENTINEL"
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive={false}
      />,
    )

    const settingsButton = screen.getByRole("button", { name: "Settings" })
    await user.tab()
    expect(settingsButton).toHaveFocus()
    await user.keyboard("{Enter}")

    await user.type(screen.getByLabelText("API key"), secret)
    await user.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => expect(settingsButton).toHaveFocus())
    expect(document.body).not.toHaveTextContent(secret)

    await user.keyboard("{Enter}")
    expect(screen.getByLabelText("API key")).toHaveValue("")
  })

  it("clears a secret after a safe mutation error without echoing it", async () => {
    const user = userEvent.setup()
    const secret = "FAILED_SECRET_SENTINEL"
    client.saveProviderProfile.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "provider_authentication",
        message: "Provider authentication failed.",
        retryable: false,
      }),
    )
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))
    const keyInput = screen.getByLabelText("API key")
    await user.type(keyInput, secret)
    await user.click(screen.getByRole("button", { name: "Save provider" }))

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Provider authentication failed.",
      )
      expect(keyInput).toHaveValue("")
    })
    expect(document.body).not.toHaveTextContent(secret)
    expect(JSON.stringify(useProviderProfileStore.getState())).not.toContain(
      secret,
    )
  })

  it("removes a stored key and deletes the provider through Settings", async () => {
    const user = userEvent.setup()
    client.saveProviderProfile.mockResolvedValueOnce({
      ...profile,
      hasApiKey: false,
      updatedAt: 11,
    })
    client.deleteProviderProfile.mockResolvedValueOnce(true)
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))
    await user.click(screen.getByLabelText("Remove the stored API key"))
    await user.click(screen.getByRole("button", { name: "Save provider" }))

    await waitFor(() => {
      expect(client.saveProviderProfile).toHaveBeenCalledWith({
        baseEndpoint: profile.baseEndpoint,
        model: profile.model,
        apiKey: { action: "remove" },
      })
    })
    await user.click(screen.getByRole("button", { name: "Delete profile" }))
    const confirmation = screen.getByRole("alertdialog")
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete profile" }),
    )

    await waitFor(() => {
      expect(client.deleteProviderProfile).toHaveBeenCalledOnce()
      expect(screen.queryByText(profile.model)).not.toBeInTheDocument()
    })
  })

  it("keeps settings viewable but disables mutations for an archive", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly
        generationActive={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))

    expect(screen.getByText("Read only")).toBeVisible()
    expect(screen.getByLabelText("Base endpoint")).toBeDisabled()
    expect(screen.getByLabelText("Model")).toBeDisabled()
    expect(screen.getByLabelText("API key")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save provider" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Delete profile" }),
    ).toBeDisabled()
  })

  it("locks provider mutations while generation is active", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))

    expect(screen.getByText("Generation in progress")).toBeVisible()
    expect(screen.getByLabelText("Base endpoint")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save provider" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Delete profile" }),
    ).toBeDisabled()
  })

  it("shows loading progress and locks every provider mutation", async () => {
    const user = userEvent.setup()
    useProviderProfileStore.setState({ phase: "loading", profile })
    render(
      <GlobalSettingsDialog
        client={client}
        readOnly={false}
        generationActive={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Settings" }))

    expect(screen.getByRole("status", { name: "Loading" })).toBeVisible()
    expect(screen.getByLabelText("Base endpoint")).toBeDisabled()
    expect(screen.getByLabelText("Model")).toBeDisabled()
    expect(screen.getByLabelText("API key")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save provider" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Delete profile" }),
    ).toBeDisabled()
  })
})
