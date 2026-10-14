import { BarChart3, Boxes, ClipboardList, Truck } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PurchaseReconciliationScreen } from "./purchase-reconciliation-screen"
import { SalesInsightsScreen } from "./sales-insights-screen"
import { StockPositionScreen } from "./stock-position-screen"
import { StoreDocumentsScreen } from "./store-documents-screen"

export function ReportsScreen() {
  return (
    <Tabs defaultValue="sales" className="gap-5">
      <div className="overflow-x-auto border-b pb-1.5">
        <TabsList
          variant="line"
          aria-label="Report type"
          className="min-w-max gap-4 group-data-horizontal/tabs:h-12"
        >
          <TabsTrigger value="sales" className="gap-2 px-2">
            <BarChart3 className="size-4" aria-hidden="true" />
            Sales insights
          </TabsTrigger>
          <TabsTrigger value="purchases" className="gap-2 px-2">
            <Truck className="size-4" aria-hidden="true" />
            Purchase reconciliation
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-2 px-2">
            <Boxes className="size-4" aria-hidden="true" />
            Stock position
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2 px-2">
            <ClipboardList className="size-4" aria-hidden="true" />
            Store documents
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="sales">
        <SalesInsightsScreen />
      </TabsContent>
      <TabsContent value="purchases">
        <PurchaseReconciliationScreen />
      </TabsContent>
      <TabsContent value="stock">
        <StockPositionScreen />
      </TabsContent>
      <TabsContent value="documents">
        <StoreDocumentsScreen />
      </TabsContent>
    </Tabs>
  )
}
