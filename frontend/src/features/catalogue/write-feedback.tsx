import { Button } from "@/components/ui/button"

export function WriteFeedback({
  error,
  uncertain,
  pending,
  retry,
}: {
  error: string
  uncertain: boolean
  pending: boolean
  retry: () => void
}) {
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {uncertain && (
        <>
          <p className="text-sm text-muted-foreground">
            The save may have completed. Retry the same change to confirm its
            outcome before editing again.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={retry}
          >
            {pending ? "Checking save…" : "Retry same save"}
          </Button>
        </>
      )}
    </div>
  )
}
