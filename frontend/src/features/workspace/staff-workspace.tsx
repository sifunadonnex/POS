import { useMemo, useState, type ComponentProps } from "react"
import {
  Archive,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CatalogueScreen } from "../catalogue/catalogue-screen"
import { AccountSecurity } from "../identity/account-security"
import { AuditScreen } from "../identity/audit-screen"
import { StaffAdminScreen } from "../identity/staff-admin-screen"
import type { Staff } from "../identity/identity-api"
import { StockControlScreen } from "../inventory/stock-control-screen"
import { PurchaseIntakeScreen } from "../purchases/purchase-intake-screen"
import { ReturnsScreen } from "../returns/returns-screen"
import { StocktakeScreen } from "../stocktake/stocktake-screen"
import { DashboardScreen } from "./dashboard-screen"
import { SalesScreen } from "./sales-screen"

type WorkspaceTab =
  | "dashboard"
  | "sales"
  | "catalogue"
  | "account"
  | "staff"
  | "audit"
  | "returns"
  | "stock"
  | "purchases"
  | "stocktake"
  | "reports"

type NavigationItem = {
  id: WorkspaceTab
  label: string
  description: string
  icon: LucideIcon
  available?: boolean
  managerOnly?: boolean
}

const navigationSections: Array<{
  label: string
  items: NavigationItem[]
}> = [
  {
    label: "Workspace",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        description: "Store overview and next actions",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Sell",
    items: [
      {
        id: "sales",
        label: "Sales register",
        description: "Scan, basket and payment",
        icon: ShoppingCart,
      },
      {
        id: "returns",
        label: "Returns",
        description: "Customer returns and refunds",
        icon: RotateCcw,
      },
    ],
  },
  {
    label: "Inventory",
    items: [
      {
        id: "catalogue",
        label: "Product catalogue",
        description: "Products, prices and barcodes",
        icon: Boxes,
      },
      {
        id: "stock",
        label: "Stock control",
        description: "Opening stock and adjustments",
        icon: PackageCheck,
        managerOnly: true,
      },
      {
        id: "purchases",
        label: "Purchase intake",
        description: "Suppliers and receiving",
        icon: Archive,
        managerOnly: true,
      },
      {
        id: "stocktake",
        label: "Stocktake",
        description: "Count and reconcile stock",
        icon: ClipboardCheck,
        managerOnly: true,
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        id: "reports",
        label: "Daily reports",
        description: "Sales, payments and exceptions",
        icon: BarChart3,
        available: false,
        managerOnly: true,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        id: "staff",
        label: "Staff accounts",
        description: "Roles, access and recovery",
        icon: Users,
        managerOnly: true,
      },
      {
        id: "audit",
        label: "Security history",
        description: "Review sensitive access events",
        icon: ShieldCheck,
        managerOnly: true,
      },
      {
        id: "account",
        label: "My security",
        description: "Password, MFA and sessions",
        icon: Shield,
      },
    ],
  },
]

const pageDetails: Record<
  WorkspaceTab,
  { section: string; title: string; description: string }
> = {
  dashboard: {
    section: "Workspace",
    title: "Dashboard",
    description: "A clear view of what needs attention in the shop.",
  },
  sales: {
    section: "Sell",
    title: "Sales register",
    description: "Build the next basket and complete the sale.",
  },
  catalogue: {
    section: "Inventory",
    title: "Product catalogue",
    description: "Find products, prices, units and barcodes.",
  },
  account: {
    section: "Administration",
    title: "My security",
    description: "Keep your account and sign-in protection up to date.",
  },
  staff: {
    section: "Administration",
    title: "Staff accounts",
    description: "Manage staff access with clear, auditable actions.",
  },
  audit: {
    section: "Administration",
    title: "Security history",
    description: "Review sensitive access and account events.",
  },
  returns: {
    section: "Sell",
    title: "Returns",
    description:
      "Find a completed sale and record a traceable customer return.",
  },
  stock: {
    section: "Inventory",
    title: "Stock control",
    description:
      "Opening stock, receiving and adjustments with movement history.",
  },
  purchases: {
    section: "Inventory",
    title: "Purchase intake",
    description:
      "Receive supplier goods and add them to stock with cost records.",
  },
  stocktake: {
    section: "Inventory",
    title: "Stocktake",
    description: "Count physical stock and reconcile differences safely.",
  },
  reports: {
    section: "Insights",
    title: "Daily reports",
    description: "Detailed sales and exception reports will appear here next.",
  },
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function StaffWorkspace({
  staff,
  onSecurityChanged,
}: {
  staff: Staff
  onSecurityChanged: () => void
}) {
  const [tab, setTab] = useState<WorkspaceTab>("dashboard")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const manager = staff.role === "manager"

  const visibleSections = useMemo(
    () =>
      navigationSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.managerOnly || manager),
        }))
        .filter((section) => section.items.length > 0),
    [manager]
  )
  const currentPage = pageDetails[tab]

  function navigate(next: WorkspaceTab) {
    setTab(next)
  }

  return (
    <div className="flex min-h-[calc(100svh-7rem)] w-full overflow-hidden rounded-2xl border bg-background shadow-sm">
      <aside
        className={`hidden border-r bg-sidebar text-sidebar-foreground lg:flex lg:flex-col ${sidebarCollapsed ? "w-[4.5rem]" : "w-64"} transition-[width] duration-200`}
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-between border-b px-3 py-3">
          <div
            className={`flex items-center gap-3 ${sidebarCollapsed ? "justify-center" : ""}`}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <ReceiptText className="size-5" aria-hidden="true" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Pay &amp; Go</p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  Commerce workspace
                </p>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        {!sidebarCollapsed && (
          <div className="border-b px-3 py-3">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-3 py-2">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-sidebar-foreground/55 uppercase">
                Current workspace
              </p>
              <p className="mt-1 text-sm font-medium">Main shop</p>
              <p className="mt-0.5 text-xs text-sidebar-foreground/60">
                Online operations
              </p>
            </div>
          </div>
        )}

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-4">
          {visibleSections.map((section) => (
            <div key={section.label}>
              {!sidebarCollapsed && (
                <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.18em] text-sidebar-foreground/45 uppercase">
                  {section.label}
                </p>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={tab === item.id}
                    collapsed={sidebarCollapsed}
                    onClick={() =>
                      item.available !== false && navigate(item.id)
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {!sidebarCollapsed && (
          <div className="border-t p-3">
            <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/70 p-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {initials(staff.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{staff.name}</p>
                <p className="truncate text-xs text-sidebar-foreground/60 capitalize">
                  {staff.role}
                </p>
              </div>
              <Badge variant="secondary" className="rounded-full text-[10px]">
                Active
              </Badge>
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {currentPage.section}
              </p>
              <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {currentPage.title}
              </h2>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                {currentPage.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="secondary"
                className="hidden capitalize sm:inline-flex"
              >
                {staff.role}
              </Badge>
              <Button className="gap-2" onClick={() => navigate("sales")}>
                <ShoppingCart className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Open register</span>
                <span className="sm:hidden">Register</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="border-b bg-muted/20 px-4 py-2 lg:hidden">
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {visibleSections
              .flatMap((section) => section.items)
              .map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={tab === item.id}
                  collapsed={false}
                  mobile
                  onClick={() => item.available !== false && navigate(item.id)}
                />
              ))}
          </div>
        </div>

        <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          {tab === "dashboard" ? (
            <DashboardScreen
              manager={manager}
              staffName={staff.name}
              onNavigate={navigate}
            />
          ) : tab === "sales" ? (
            <SalesScreen />
          ) : tab === "returns" ? (
            <ReturnsScreen />
          ) : tab === "catalogue" ? (
            <CatalogueScreen manager={manager} />
          ) : tab === "stock" && manager ? (
            <StockControlScreen />
          ) : tab === "purchases" && manager ? (
            <PurchaseIntakeScreen />
          ) : tab === "stocktake" && manager ? (
            <StocktakeScreen />
          ) : tab === "staff" && manager ? (
            <StaffAdminScreen currentUserId={staff.id} />
          ) : tab === "audit" && manager ? (
            <AuditScreen />
          ) : tab === "account" ? (
            <AccountSecurity staff={staff} onChanged={onSecurityChanged} />
          ) : (
            <PlannedModule tab={tab} />
          )}
        </main>
      </div>
    </div>
  )
}

function NavButton({
  item,
  active,
  collapsed,
  mobile = false,
  onClick,
}: {
  item: NavigationItem
  active: boolean
  collapsed: boolean
  mobile?: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  const buttonProps: ComponentProps<typeof Button> = {
    type: "button",
    variant: active ? "secondary" : "ghost",
    size: mobile ? "sm" : "default",
    className: mobile
      ? "shrink-0 gap-2"
      : `w-full gap-2 px-2.5 ${collapsed ? "justify-center px-0" : "justify-start"}`,
    disabled: item.available === false,
    title: collapsed ? item.label : item.description,
    "aria-pressed": active,
    onClick,
  }
  return (
    <Button {...buttonProps}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed || mobile ? <span>{item.label}</span> : null}
      {!collapsed && !mobile && item.available === false && (
        <span className="ml-auto text-[10px] text-sidebar-foreground/45">
          Soon
        </span>
      )}
    </Button>
  )
}

function PlannedModule({ tab }: { tab: WorkspaceTab }) {
  const detail = pageDetails[tab]
  return (
    <section className="mx-auto flex min-h-[50vh] max-w-2xl items-center justify-center">
      <div className="w-full rounded-2xl border border-dashed bg-card p-8 text-center shadow-xs">
        <FileClock
          className="mx-auto size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-4 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Module next
        </p>
        <h3 className="mt-2 text-xl font-semibold">{detail.title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {detail.description} This area is reserved in the workspace so the
          next operational module has a clear home.
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={() => window.history.back()}
        >
          Return to previous view
        </Button>
      </div>
    </section>
  )
}
