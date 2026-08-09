export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <section
        aria-labelledby="canopy-title"
        className="flex max-w-md flex-col gap-3 text-center"
      >
        <p className="text-sm font-medium text-muted-foreground">
          Desktop foundation
        </p>
        <h1 id="canopy-title" className="text-4xl font-semibold tracking-tight">
          Canopy
        </h1>
        <p className="text-muted-foreground">The application shell is ready.</p>
      </section>
    </main>
  )
}
