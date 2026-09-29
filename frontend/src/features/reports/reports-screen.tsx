import { useState } from "react"
import { BarChart3, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PurchaseReconciliationScreen } from "./purchase-reconciliation-screen"
import { SalesInsightsScreen } from "./sales-insights-screen"

type ReportView = "sales" | "purchases"

export function ReportsScreen() {
  const [view, setView] = useState<ReportView>("sales")

  return (
    <div className="space-y-5">
      <div
        className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted/30 p-1"
        aria-label="Report type"
      >
        <Button
          type="button"
          size="sm"
          variant={view === "sales" ? "secondary" : "ghost"}
          aria-pressed={view === "sales"}
          className="gap-2"
          onClick={() => setView("sales")}
        >
          <BarChart3 className="size-4" aria-hidden="true" />
          Sales insights
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "purchases" ? "secondary" : "ghost"}
          aria-pressed={view === "purchases"}
          className="gap-2"
          onClick={() => setView("purchases")}
        >
          <Truck className="size-4" aria-hidden="true" />
          Purchase reconciliation
        </Button>
      </div>

      {view === "sales" ? (
        <SalesInsightsScreen />
      ) : (
        <PurchaseReconciliationScreen />
      )}
    </div>
  )
}
