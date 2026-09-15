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
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete={newPassword ? "new-password" : "current-password"}
        minLength={12}
        maxLength={128}
        required
        disabled={disabled}
        className="h-11"
      />
    </div>
  )
}
