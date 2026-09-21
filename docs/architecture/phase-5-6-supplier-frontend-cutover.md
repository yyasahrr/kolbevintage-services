# Phase 5.6 Supplier Frontend Preservation / Cutover Map

This artifact is a preservation map, not a frontend redesign. `frontend-next/supplier-src/App.tsx`, `features.tsx`, `workflows.tsx`, and `data.ts` remain unchanged by the Phase 5.6 backend implementation. Static/demo values continue to be visibly treated as fixtures until a later cutover.

| Existing Supplier surface | Backend authority after Phase 5.6 | Current status | Deferred |
| --- | --- | --- | --- |
| `production` page and `milestones` fixture | `production_job`, `production_job_history`, `production_milestone_definition`, `production_job_milestone` | API contract available; UI remains preserved | live page wiring and visual redesign |
| `samples` workspace and upload affordance | `production_sample`, append-only `production_sample_revision`, `production_sample_review`, `production_artifact` metadata | Secure metadata API; no raw browser base64 | upload adapter/object storage and UX |
| `quality` board and QC history | versioned `quality_checklist`/items, `quality_inspection`, `quality_inspection_item`, `quality_defect`, `quality_rework`, `quality_release` | authoritative API and release gate | live board wiring |
| `quality-docs` / recall fixture | `production_lot`, `production_lot_trace`, `production_recall`, scope and approval records | authoritative lot/recall API | document UI and notification delivery |
| `changes` workspace | `production_change_request` and append-only decisions | controlled request API | owner-domain decision UI |
| profile capacity and capability concepts | `supplier_capability`, `supplier_capacity_period`, `supplier_closure`, `production_capacity_reservation` | concurrency-safe API | profile editor and calendar UI |
| `orders` / fulfillment actions | existing Orders and Shipping owner APIs; Production only references `purchase_order_id` | unchanged | no duplicate production order screen |
| `data.ts` products, order rows, RFQs, milestones | no authority; fixtures only | preserved exactly | removal only during a separately approved frontend cutover |
| localStorage features in `features.tsx` | no backend authority | unchanged and not used by Production services | replacing demos with server reads |

## Safety rules for a later cutover

1. Replace reads with relative API calls through the frontend server proxy; never call PostgreSQL, `localhost`, or a browser-side service directly.
2. Keep the existing empty-state behavior: no invented jobs, samples, QC results, lots, recalls, or KPIs when the API returns no rows.
3. Use server-returned integer quantities and basis-point rates; do not recompute commercial totals or capacity availability from fixture state.
4. Submit only explicit transition commands with an idempotency key. Do not add a generic status PATCH.
5. Show private artifact metadata and signed access abstractions only; do not expose object keys, raw base64, or executable files.
6. Preserve supplier isolation by deriving supplier scope from the authenticated session. A selected supplier id may be displayed, but it must not be an authority supplied by the browser.
7. Keep production handoff read-only from the frontend: Orders, Inventory, Shipping, Settlement, Support, Notifications, Compliance, and catalog remain owner services.
