import * as React from "react"

import { ConversationWorkspace } from "@/features/conversations/components"
import { Toaster } from "@/components/ui/toaster"
import { useTranslation } from "@/lib/i18n"

export default function App() {
  const { locale } = useTranslation()

  // Keeps the document language in sync for assistive tech, hyphenation, and
  // translation hints; runs once on mount and after every locale switch.
  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <ConversationWorkspace />
      <Toaster />
    </main>
  )
}
