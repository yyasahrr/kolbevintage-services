# Status machines — frozen future design

Phase 3.10 documentation only. Current CHECKs/shared constants remain unchanged. Future transitions belong in tested shared pure tables; business services lock/re-read rows, check actor and ownership, execute effects and append status history, events and audit in one transaction. Unlisted edges are forbidden. A repeated command replays through idempotency; it is not a new transition. Admin is not exempt from invariants.

## Wholesale request

Actors below are authenticated and resource-scoped: buyer owns the VIP account; supplier is the offer seller's authorized owner/sales member; KOLBE responses use authorized admin acting for KOLBE; system is trusted server code.

| Transition | Actor | Validation | Atomic effects |
| --- | --- | --- | --- |
| absent → pending | buyer | active account/subscription, plan allowance, product/offer/package match, integer MOQ/unit, idempotency | persist request version and proposed terms, audit |
| pending → supplier_review | buyer or admin | own request, published/active seller offer, current version | freeze submitted version, record review deadline/event |
| supplier_review → revision_requested | responsible supplier or admin | reason, explicit proposed quantities/prices/recipe version | append proposal revision; no silent buyer acceptance or stock hold |
| revision_requested → supplier_review | buyer or admin acting for buyer | explicit acceptance/new buyer revision, entitlement and units | new version and review deadline; supersede prior acceptance |
| supplier_review → accepted | responsible supplier or admin | current version, fresh supplier stock confirmation, valid commercial terms and deadline | snapshot confirmation actor/time/expiry; no stock decrement |
| supplier_review or revision_requested → rejected | responsible supplier or admin | nonblank reason, current version | terminal event/audit |
| pending/supplier_review/revision_requested/accepted → cancelled | buyer or admin | own request, not converted | terminal reason/history; release any explicitly linked pre-order holds through Inventory |
| pending/supplier_review/revision_requested/accepted → expired | system | database-time deadline reached | terminal history; release linked holds atomically if present |
| accepted → ordered | Orders command initiated by buyer or authorized admin | accepted version valid; seller/buyer eligibility; all stock reserved; one conversion link | create immutable order/children/items + Inventory holds + request conversion + history/audit/idempotency in same transaction |

Rejected, expired, cancelled and ordered are terminal. A new proposal after terminal closure needs a new request linked to the old one. Partial supplier availability requires explicit revision and buyer acceptance, not automatic partial conversion.

## Wholesale order

`awaiting_payment` is a workflow gate only. Payment records and actual financial states belong to Payments. Creation freezes commercial snapshots even in draft. The following are target states, not existing database values.

| Transition | Actor | Validation | Atomic effects |
| --- | --- | --- | --- |
| absent → draft | Orders command for buyer/admin | full accepted-request conversion, snapshots, quantities and idempotency | persist order/children/items; activate holds; history/event/audit |
| draft → confirmed | buyer or authorized admin | exact frozen terms accepted; unexpired holds; child sellers valid | set confirmed_at; no repricing or stock consumption |
| confirmed → awaiting_payment | system | frozen commercial terms require payment; no existing release evidence | record payment gate; retain bounded holds |
| confirmed → processing | trusted policy command | explicit pre-approved credit/no-prepayment terms; unexpired holds | commit allocation by removing cart TTL through Inventory; record release reason |
| awaiting_payment → processing | trusted future payment orchestration or audited authorized manual evidence command | verified payment release evidence, expected amount/currency/version and still-valid allocations | persist evidence reference; commit holds; do not create payment facts in Orders |
| processing → fulfillment | Fulfillment application command or admin | all relevant child preparation accepted, committed allocations, no payment gate | history/event; preparation timestamps; no stock decrement |
| fulfillment → shipped | trusted dispatch orchestration | all uncancelled children dispatched; concrete handoff/tracking evidence | consume remaining allocations exactly once through Inventory, record dispatch event/time |
| shipped → completed | trusted delivery orchestration or authorized admin | all uncancelled children delivered; delivery evidence | completed_at/history; no second stock decrement |
| draft/confirmed/awaiting_payment → cancelled | buyer or admin; system on hold expiry | no dispatch; lock current state; reason | release active holds, cancel unshipped children, append history |
| processing/fulfillment → cancelled | admin or approved cancellation orchestration | no child dispatched; supplier preparation cancellation acknowledged | release remaining holds atomically; record reason; any financial reversal is separate future work |

Completed and cancelled are terminal. No cancellation from shipped. A payment received after expiry does not resurrect an order or silently re-reserve stock; record/route the exception through the future Payments workflow. Until trusted payment evidence handling exists, payment-gated orders cannot advance.

Parent state aggregates children; it cannot be arbitrarily overwritten. A child dispatch consumes its own hold once. Parent advancement after the last child dispatch does not consume earlier children again. If only some children dispatch, parent remains fulfillment with item-level facts. Partial cancellation is outside the initial model. Unexpected shortage requires a recorded exception and explicit resolution, never inventory clamping.

## Seller child and reservation states

Retain the existing child vocabulary for the first cutover: pending → confirmed → preparing → shipped → delivered. Supplier owner/sales confirms; owner/warehouse prepares and hands off; delivery requires trusted evidence. Admin handles KOLBE. Pending/confirmed/preparing cancellation requires parent orchestration and no dispatch. All child transitions record history and update parent predicates through OrdersService; SuppliersService never writes child order rows.

Reservation: pending → active atomically increments reserved; pending → cancelled/expired has no balance effect. Active → released/cancelled/expired decrements reserved only; active → confirmed consumes on_hand and reserved at dispatch. Terminal states cannot reactivate. Expiry uses database time and is ignored only for explicitly committed allocations with no TTL. These semantics supersede earlier comments equating order creation or delivery with stock consumption.

## Migration and acceptance

Current request values lack revision_requested/expired/cancelled. Current parent states are pending/approved/fulfilling/fulfilled/cancelled. Phase 4.2 must use evidence-based mapping: pending may map to draft; approved to confirmed; fulfilling to fulfillment; fulfilled to completed only with delivery evidence. Quarantine inconsistent rows instead of fabricating payment/stock history. Update shared constants, CHECKs, API serializers and compatibility behavior together; no direct status rewriting in 3.10.

Test each edge for permitted actor, wrong buyer/seller, stale version, expired confirmation, missing evidence, audit failure, duplicate command and races. Test forbidden edges and parent-child aggregates. Green pure transition tests do not substitute for endpoint and transactional integration tests.
