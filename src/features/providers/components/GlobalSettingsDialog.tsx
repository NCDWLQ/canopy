import * as React from "react"
import { KeyRound, Settings2, Trash2 } from "lucide-react"

import { resolveApiKeyAction } from "./apiKeyAction"
import { useProviderProfileStore } from "../store"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { ProviderClient } from "@/lib/tauri"

export type GlobalSettingsDialogProps = {
  client: ProviderClient
  readOnly: boolean
  generationActive: boolean
}

export function GlobalSettingsDialog({
  client,
  readOnly,
  generationActive,
}: GlobalSettingsDialogProps) {
  const phase = useProviderProfileStore((state) => state.phase)
  const profile = useProviderProfileStore((state) => state.profile)
  const error = useProviderProfileStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const saveProfile = useProviderProfileStore((state) => state.saveProfile)
  const deleteProfile = useProviderProfileStore((state) => state.deleteProfile)
  const [open, setOpen] = React.useState(false)
  const [baseEndpoint, setBaseEndpoint] = React.useState("")
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [removeKey, setRemoveKey] = React.useState(false)

  const mutationDisabled = readOnly || generationActive || phase === "loading"

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    setApiKey("")
    setRemoveKey(false)
    if (nextOpen) {
      setBaseEndpoint(profile?.baseEndpoint ?? "")
      setModel(profile?.model ?? "")
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutationDisabled) return
    const apiKeyAction = resolveApiKeyAction(profile, apiKey, removeKey)
    try {
      await saveProfile(client, {
        baseEndpoint,
        model,
        apiKey: apiKeyAction,
      })
    } finally {
      setApiKey("")
    }
  }

  const handleDelete = async () => {
    if (mutationDisabled) return
    await deleteProfile(client)
    setBaseEndpoint("")
    setModel("")
    setApiKey("")
    setRemoveKey(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          <Settings2 data-icon="inline-start" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage configuration that applies across this workspace.
          </DialogDescription>
        </DialogHeader>

        <section
          aria-labelledby="provider-settings-title"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 id="provider-settings-title" className="font-medium">
              Provider
            </h2>
            <p className="text-sm text-muted-foreground">
              Configure the single OpenAI-compatible provider used for this
              workspace. Credentials remain in the native credential store.
            </p>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            {profile !== null && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{profile.model}</Badge>
                <Badge variant="outline">
                  <KeyRound data-icon="inline-start" />
                  {profile.hasApiKey ? "API key stored" : "No API key"}
                </Badge>
              </div>
            )}

            {error !== null && (
              <Alert variant="destructive">
                <AlertTitle>Provider unavailable</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}

            {readOnly && (
              <Alert>
                <AlertTitle>Read only</AlertTitle>
                <AlertDescription>
                  Provider settings cannot be changed while viewing an archived
                  conversation.
                </AlertDescription>
              </Alert>
            )}

            {generationActive && !readOnly && (
              <Alert>
                <AlertTitle>Generation in progress</AlertTitle>
                <AlertDescription>
                  Provider settings are available after the current response is
                  resolved.
                </AlertDescription>
              </Alert>
            )}

            <FieldGroup>
              <Field data-disabled={mutationDisabled}>
                <FieldLabel htmlFor="provider-endpoint">
                  Base endpoint
                </FieldLabel>
                <Input
                  id="provider-endpoint"
                  type="url"
                  value={baseEndpoint}
                  onChange={(event) => setBaseEndpoint(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  disabled={mutationDisabled}
                  required
                />
              </Field>

              <Field data-disabled={mutationDisabled}>
                <FieldLabel htmlFor="provider-model">Model</FieldLabel>
                <Input
                  id="provider-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="model-name"
                  disabled={mutationDisabled}
                  required
                />
              </Field>

              <Field data-disabled={mutationDisabled || removeKey}>
                <FieldLabel htmlFor="provider-api-key">API key</FieldLabel>
                <Input
                  id="provider-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    profile === null ? "Optional" : "Leave blank to keep"
                  }
                  disabled={mutationDisabled || removeKey}
                />
                <FieldDescription>
                  The key is cleared from this dialog after every save attempt.
                </FieldDescription>
              </Field>

              {profile !== null && (
                <Field
                  orientation="horizontal"
                  data-disabled={mutationDisabled}
                >
                  <Checkbox
                    id="provider-remove-key"
                    checked={removeKey}
                    onCheckedChange={(checked) =>
                      setRemoveKey(checked === true)
                    }
                    disabled={mutationDisabled}
                  />
                  <FieldLabel htmlFor="provider-remove-key">
                    Remove the stored API key
                  </FieldLabel>
                </Field>
              )}
            </FieldGroup>

            <DialogFooter>
              {profile !== null && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={mutationDisabled}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete profile
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete provider profile?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Generation will remain unavailable until a provider is
                        configured again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void handleDelete()}
                      >
                        Delete profile
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                type="submit"
                aria-label="Save provider"
                disabled={mutationDisabled}
              >
                {phase === "loading" && <Spinner data-icon="inline-start" />}
                Save provider
              </Button>
            </DialogFooter>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  )
}
