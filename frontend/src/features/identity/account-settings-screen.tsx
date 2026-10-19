import { BusinessSettings } from "../business/business-settings"
import { useState } from "react"
import {
  Check,
  ChevronRight,
  Mail,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AccountSecurity } from "./account-security"
import type { Staff } from "./identity-api"

const sections = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "business", label: "Business", icon: Monitor },
] as const
const themes = [
  {
    id: "light",
    label: "Light",
    description: "A bright workspace for daytime use.",
    icon: Sun,
  },
  {
    id: "dark",
    label: "Dark",
    description: "Darker surfaces for low-light surroundings.",
    icon: Moon,
  },
  {
    id: "system",
    label: "System",
    description: "Follow this device’s appearance setting.",
    icon: Monitor,
  },
] as const

export function AccountSettingsScreen({
  staff,
  onChanged,
}: {
  staff: Staff
  onChanged: () => void
}) {
  const [section, setSection] =
    useState<(typeof sections)[number]["id"]>("profile")
  return (
    <section
      aria-label="Account settings"
      className="mx-auto max-w-6xl space-y-6"
    >
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Account settings
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your staff profile, sign-in protection and workspace appearance.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-0">
          <Card className="hidden lg:flex">
            <CardContent className="text-center">
              <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-muted text-lg font-semibold">
                {staff.name
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </div>
              <p className="font-medium break-words">{staff.name}</p>
              <p className="mt-1 text-xs break-all text-muted-foreground">
                {staff.email}
              </p>
              <Badge variant="secondary" className="mt-3 capitalize">
                {staff.role}
              </Badge>
            </CardContent>
          </Card>
          <nav
            aria-label="Settings sections"
            className="flex gap-1 rounded-xl border bg-card p-2 lg:flex-col"
          >
            {sections
              .filter(
                (item) => item.id !== "business" || staff.role === "manager"
              )
              .map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={section === id ? "secondary" : "ghost"}
                  className="min-h-11 flex-1 justify-start gap-2 px-2 text-xs sm:px-3 sm:text-sm lg:flex-none"
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => setSection(id)}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                  <ChevronRight
                    className="ml-auto hidden size-3.5 lg:block"
                    aria-hidden="true"
                  />
                </Button>
              ))}
          </nav>
        </aside>
        <div className="min-w-0">
          {section === "profile" ? (
            <ProfileSettings staff={staff} />
          ) : section === "security" ? (
            <AccountSecurity staff={staff} onChanged={onChanged} />
          ) : section === "business" && staff.role === "manager" ? (
            <BusinessSettings />
          ) : (
            <AppearanceSettings />
          )}
        </div>
      </div>
    </section>
  )
}

function ProfileSettings({ staff }: { staff: Staff }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Personal information</CardTitle>
          <CardDescription>
            Your identity in the shop workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <ProfileRow label="Full name" value={staff.name} />
            <ProfileRow label="Email address" value={staff.email} />
            <ProfileRow
              label="Role"
              value={
                staff.role === "manager"
                  ? "Manager"
                  : staff.role === "supervisor"
                    ? "Supervisor"
                    : "Cashier"
              }
            />
          </dl>
          <p className="mt-4 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            Your manager maintains your name, email and role through Staff
            accounts. Contact them if these details need updating.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account status</CardTitle>
          <CardDescription>
            Protection reported by the account service.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Email address</p>
              <p className="text-xs text-muted-foreground">
                {staff.emailVerified ? "Verified" : "Verification needed"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <ShieldCheck
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">Authenticator</p>
              <p className="text-xs text-muted-foreground">
                {staff.twoFactorEnabled ? "Enabled" : "Not enabled"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how POP N’ GO looks on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h3 className="text-sm font-medium">Colour theme</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Changes apply immediately and use the existing device preference.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Colour theme">
          {themes.map(({ id, label, description, icon: Icon }) => (
            <Button
              key={id}
              variant="outline"
              aria-pressed={theme === id}
              onClick={() => setTheme(id)}
              className={`h-auto flex-col items-stretch gap-3 rounded-xl p-4 text-left whitespace-normal ${theme === id ? "border-primary bg-muted/40 ring-1 ring-primary" : "bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <Icon className="size-5" aria-hidden="true" />
                {theme === id && (
                  <Check className="size-4" aria-hidden="true" />
                )}
              </div>
              <span className="font-medium">{label}</span>
              <span className="text-xs leading-5 font-normal text-muted-foreground">
                {description}
              </span>
            </Button>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          System mode automatically follows light and dark changes in your
          operating system.
        </p>
      </CardContent>
    </Card>
  )
}
