import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CatalogueScreen } from "../catalogue/catalogue-screen"
import { AccountSecurity } from "../identity/account-security"
import { AuditScreen } from "../identity/audit-screen"
import { StaffAdminScreen } from "../identity/staff-admin-screen"
import type { Staff } from "../identity/identity-api"

export function StaffWorkspace({
  staff,
  onSecurityChanged,
}: {
  staff: Staff
  onSecurityChanged: () => void
}) {
  const [tab, setTab] = useState<"catalogue" | "account" | "staff" | "audit">(
    "catalogue"
  )
  const manager = staff.role === "manager"
  return (
    <>
      <nav
        className="flex flex-wrap gap-2 border-b pb-4"
        aria-label="Staff workspace"
      >
        <Button
          variant={tab === "catalogue" ? "secondary" : "ghost"}
          aria-pressed={tab === "catalogue"}
          onClick={() => setTab("catalogue")}
        >
          Catalogue
        </Button>
        <Button
          variant={tab === "account" ? "secondary" : "ghost"}
          aria-pressed={tab === "account"}
          onClick={() => setTab("account")}
        >
          My security
        </Button>
        {manager && (
          <>
            <Button
              variant={tab === "staff" ? "secondary" : "ghost"}
              aria-pressed={tab === "staff"}
              onClick={() => setTab("staff")}
            >
              Staff accounts
            </Button>
            <Button
              variant={tab === "audit" ? "secondary" : "ghost"}
              aria-pressed={tab === "audit"}
              onClick={() => setTab("audit")}
            >
              Security history
            </Button>
          </>
        )}
      </nav>
      {tab === "catalogue" ? (
        <CatalogueScreen manager={manager} />
      ) : tab === "staff" && manager ? (
        <StaffAdminScreen currentUserId={staff.id} />
      ) : tab === "audit" && manager ? (
        <AuditScreen />
      ) : (
        <AccountSecurity staff={staff} onChanged={onSecurityChanged} />
      )}
    </>
  )
}
