import { useState } from "react"
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { CatalogueScreen } from "../catalogue/catalogue-screen"
import { AccountSecurity } from "../identity/account-security"
import { AuditScreen } from "../identity/audit-screen"
import { StaffAdminScreen } from "../identity/staff-admin-screen"
import type { Staff } from "../identity/identity-api"
import { DashboardScreen } from "./dashboard-screen"
import { SalesScreen } from "./sales-screen"

export function StaffWorkspace({
  staff,
  onSecurityChanged,
}: {
  staff: Staff
  onSecurityChanged: () => void
}) {
  type WorkspaceTab =
    | "dashboard"
    | "sales"
    | "catalogue"
    | "account"
    | "staff"
    | "audit"

  const [tab, setTab] = useState<WorkspaceTab>("dashboard")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const manager = staff.role === "manager"

  const baseItems: { id: WorkspaceTab; label: string; icon: LucideIcon }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "sales", label: "Sales", icon: ShoppingCart },
    { id: "catalogue", label: "Catalogue", icon: FileText },
    { id: "account", label: "My security", icon: Shield },
  ]

  const managerItems: { id: WorkspaceTab; label: string; icon: LucideIcon }[] = [
    { id: "staff", label: "Staff accounts", icon: Users },
    { id: "audit", label: "Security history", icon: ShieldCheck },
  ]

  const items = manager ? [...baseItems, ...managerItems] : baseItems

  return (
    <div className="flex min-h-[78vh] w-full overflow-hidden rounded-2xl border bg-background shadow-sm">
      <aside
        className={`hidden border-r bg-sidebar text-sidebar-foreground lg:flex lg:flex-col ${
          sidebarCollapsed ? "w-20" : "w-72"
        } transition-all duration-200`}
      >
        <div className="flex items-center justify-between border-b px-3 py-3">
          <div
            className={`flex items-center gap-3 ${sidebarCollapsed ? "justify-center" : ""}`}
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <p className="text-sm font-medium text-sidebar-foreground/80">
                  Pay & Go
                </p>
                <p className="text-xs text-sidebar-foreground/60">Operations</p>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        <div className={`space-y-2 px-2 py-4 ${sidebarCollapsed ? "items-center" : ""}`}>
          {items.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <Button
                key={id}
                variant={active ? "secondary" : "ghost"}
                className={`w-full gap-2 px-2.5 ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`}
                aria-pressed={active}
                title={sidebarCollapsed ? label : undefined}
                onClick={() => setTab(id)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {!sidebarCollapsed && label}
              </Button>
            )
          })}
        </div>

        {!sidebarCollapsed && (
          <div className="mt-auto border-t p-4">
            <div className="rounded-xl bg-sidebar-accent p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-sidebar-foreground/60">
                Active user
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sidebar-foreground">{staff.name}</p>
                  <p className="text-xs text-sidebar-foreground/70">{staff.role}</p>
                </div>
                <Badge variant="secondary" className="rounded-full">
                  Online
                </Badge>
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Workspace
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {tab === "dashboard"
                ? "Overview"
                : tab === "sales"
                  ? "Sales register"
                  : tab === "catalogue"
                    ? "Catalogue"
                    : tab === "account"
                      ? "Account security"
                      : tab === "staff"
                        ? "Staff management"
                        : "Security history"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {staff.role}
            </Badge>
            <Button variant="outline" className="gap-2">
              Open register
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <div className="flex flex-wrap gap-2">
              {items.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={tab === id ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="mb-6 lg:hidden" />

          {tab === "dashboard" ? (
            <DashboardScreen />
          ) : tab === "sales" ? (
            <SalesScreen />
          ) : tab === "catalogue" ? (
            <CatalogueScreen manager={manager} />
          ) : tab === "staff" && manager ? (
            <StaffAdminScreen currentUserId={staff.id} />
          ) : tab === "audit" && manager ? (
            <AuditScreen />
          ) : (
            <AccountSecurity staff={staff} onChanged={onSecurityChanged} />
          )}
        </main>
      </div>
    </div>
  )
}
