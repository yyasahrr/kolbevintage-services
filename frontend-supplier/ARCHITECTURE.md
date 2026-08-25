# Kolbe Vintage Supplier Portal

## Product goal

Give approved fashion suppliers one operational workspace for catalog readiness, sellable-series inventory, ready-stock fulfillment, custom-production negotiation, production evidence, quality control, and settlement visibility. The default page answers: “What must I decide or do next?”

## Information architecture

```text
Access
├── Sign in
└── Supplier application

Supplier workspace
├── Dashboard / Supplier Action Queue
├── Catalog
│   ├── Supplier products
│   ├── Drafts
│   ├── Kolbe review
│   └── Rejected products
├── Inventory
│   ├── Physical SKU inventory
│   ├── Sellable series inventory
│   └── Low / out-of-stock views
├── Series & packs
│   ├── Series templates
│   └── Product series
├── Ready-stock operations
│   ├── Orders
│   └── Returns / issues
├── Custom production
│   ├── RFQ inbox
│   ├── Quotes / counter-offers
│   ├── Production orders
│   ├── Samples
│   └── Change requests
├── Quality
│   ├── QC tasks
│   └── QC reports
├── Finance
│   ├── Balance
│   ├── Settlements
│   └── Ledger
└── Performance, messages, capabilities, settings
```

## Domain entities

- `Product`: Kolbe customer-facing commercial concept.
- `SupplierProduct`: a supplier-owned catalog submission with approval status and internal identifiers.
- `MasterProduct`: Kolbe-owned normalized catalog record; matching remains an admin-only manual decision.
- `Variant`: an option combination such as color and size with its own SKU, cost, image, availability, and physical stock.
- `SeriesTemplate`: reusable generic variant ratios such as half, full, or best-seller.
- `ProductSeries`: a sellable pack bound to one supplier product/color and composed of variant quantities.
- `PhysicalInventory`: on-hand and reserved quantities per variant SKU.
- `SellableSeriesInventory`: derived minimum of available variant quantities divided by required series quantities.
- `ReadyStockOrder`: wholesale fulfillment entity that reserves series inventory when confirmed.
- `ProductionRFQ`: structured customer manufacturing request.
- `Quote`: supplier response or counter-offer associated with an RFQ.
- `ProductionOrder`: operational entity created only after quote acceptance.
- `ProductionMilestone`, `Sample`, `ChangeRequest`, and `QCReport`: independent production records with evidence and audit history.
- `Settlement` and `Transaction`: financial payout and ledger entities.

## Component system

- `AppShell`, `Sidebar`, `Topbar`, `CommandPalette`
- `PageHeader`, `SectionHeading`, `Status`, `ActionQueueItem`
- `DataToolbar`, desktop comparison tables, mobile record cards, detail inspectors
- `ProductEditor`, `VariantMatrix`, `MediaUploader`, `ReviewTimeline`
- `RFQDetail`, `QuoteBuilder`, `MilestoneTimeline`, `SampleWorkspace`, `ChangeRequestWorkspace`
- `EmptyState`, inline error, disabled/read-only controls, confirmation surfaces

## Design tokens

- Ink: `#22221f`; warm canvas: `#f6f6f3`; elevated surface: `#ffffff`
- Primary border: `#e3e2dc`; muted copy: `#77766f`; editorial accent: `#9a7d3f`
- Success: muted sage; warning: ochre; destructive: clay; information: desaturated blue
- Radius: 5–10px for controls and operational surfaces; shadows only for overlays
- Type: Vazirmatn for Persian product UI, Playfair Display only for the Kolbe wordmark and restrained editorial moments
- Motion: 140–200ms state transitions, disabled when reduced motion is requested

## Responsive strategy

- Desktop: comparison tables, right-side inspectors, sticky workflow navigation.
- Tablet: single-column workspaces with wrapped toolbars and horizontal matrices only when comparison is essential.
- Mobile: task-first cards for alerts, RFQs, inventory adjustments, milestones, and evidence upload; dense desktop tables are replaced rather than squeezed.
