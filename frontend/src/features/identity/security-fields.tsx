import { useState } from "react"
import { Eye, EyeOff, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PasswordField({
  id = "current-password",
  label = "Current password",
  disabled = false,
  newPassword = false,
}: {
  id?: string
  label?: string
  disabled?: boolean
  newPassword?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <LockKeyhole
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          minLength={12}
          maxLength={128}
          required
          disabled={disabled}
          className="h-11 px-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  )
}
