import { ConversationWorkspace } from "@/features/conversations/components"
import { Toaster } from "@/components/ui/toaster"

export default function App() {
  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <ConversationWorkspace />
      <Toaster />
    </main>
  )
}
