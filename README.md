# P4 — Ishida after-sales plugin + ERP replica API

A Front demo for Ishida (industrial food-processing machinery), built to answer two
things their after-sales team gets from Zendesk today:

1. **Visibility.** Every ticket field for the ticket type, plus the machine and its
   related records, in one panel — instead of custom fields hidden behind an icon.
2. **Automation.** Ishida's on-prem ERP can only push data out, never be queried. So
   this repo stands up a small datastore with a real REST API that a Front AI playbook
   calls via *Send app request* to resolve a serial number and populate ticket fields.

The panel and the playbook read the **same backend**, so what the automation writes is
what the agent sees.

> All data here is fabricated. There is no real Ishida or ERP connectivity.

---

## Layout

```
p4-plugin/
├── data/Ishida_ERP_Serial_Lookup.csv   # 8 machines, seeded into SQLite at boot
├── backend/                            # Express + TypeScript + better-sqlite3
│   ├── src/
│   │   ├── index.ts                    # server, CORS, error handling
│   │   ├── db.ts                       # SQLite + CSV seed + snapshot store
│   │   ├── derive.ts                   # billing_status derivation
│   │   ├── generate.ts                 # deterministic associated objects
│   │   ├── auth.ts                     # X-Api-Key check
│   │   └── routes/{machines,customers,tickets}.ts
│   └── Dockerfile
├── plugin/                             # React + TypeScript + Vite + @frontapp/plugin-sdk
│   ├── src/
│   │   ├── App.tsx                     # panel shell + all states
│   │   ├── fieldSets.ts                # ← EDIT ME: field names and inbox mapping
│   │   ├── hooks/useFrontContext.ts    # Front SDK subscription
│   │   ├── hooks/useSerials.ts         # 3-path serial detection
│   │   ├── api/{client,types}.ts
│   │   └── components/{TicketFields,MachineCard,AssociatedObjects}.tsx
│   └── vercel.json
├── render.yaml
└── .env.example
```

---

## Quick start

```bash
cp .env.example .env    # then set API_KEY to anything you like
```

Two terminals:

```bash
cd backend && npm install && npm run dev    # http://localhost:4000
```

```bash
cd plugin && npm install && npm run dev     # http://localhost:5173
```

Open <http://localhost:5173> in a plain browser tab. After 1.5s with no Front handshake
the panel switches to **demo mode** and shows a serial picker — so the whole panel can be
built, rehearsed and screenshotted without registering it in Front first.

---

## API reference

Every `/api/*` route except `/api/health` requires `X-Api-Key`. Set `API_KEY` in `.env`.

```bash
export API_KEY=your-key
export BACKEND=http://localhost:4000        # or your Render URL
```

### `GET /api/health`

No auth — this is what Render's health check hits.

```bash
curl -s $BACKEND/api/health
# {"status":"ok"}
```

### `GET /api/machines/:serial`

The core lookup the playbook calls.

```bash
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/560020728
```

```json
{
  "serial_number": "560020728",
  "model_code": "IX-EN-2463",
  "machine_type": "X-RAY",
  "customer_account": "Sanchez-Cano",
  "country": "Spain",
  "region_inbox": "Aftersales EU-South",
  "install_date": "2025-02-03",
  "warranty_active": true,
  "warranty_expiry": "2027-02-03",
  "service_contract": "Service 365 Ultimate (X-Ray)",
  "ln_reference": "470003011",
  "key_account": null,
  "billing_status": "warranty",
  "associated_objects": {
    "work_orders": [
      { "id": "WO-529278", "status": "Completed", "summary": "Conveyor belt tracking fault triggering reject alarm", "opened_date": "2026-08-16", "engineer": "A. Ricci" }
    ],
    "spare_parts": [
      { "part_no": "IS-IX-TUB-2205", "description": "X-ray tube assembly", "qty": 4, "stock_status": "In stock — EU hub" }
    ],
    "quotes": [
      { "id": "QT-42425", "amount": 2775, "currency": "EUR", "status": "Sent", "issued_date": "2026-02-15" }
    ],
    "service_contract": { "name": "Service 365 Ultimate (X-Ray)", "level": "Ultimate", "expiry": "2028-12-29", "response_sla": "4h remote / next business day on-site" }
  }
}
```

Unknown serial → **404**, which is the branch the playbook must handle:

```bash
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/999999999
# {"error":"serial_not_found","serial":"999999999"}
```

Missing or wrong key → **401**:

```bash
curl -s $BACKEND/api/machines/560020728
# {"error":"unauthorized","message":"Missing or invalid X-Api-Key header."}
```

### `GET /api/machines?serial=A&serial=B`

Batch lookup — a ticket often names two serials (an X-ray and its DACS). Unknown serials
come back as `serial_not_found` **entries in the array** rather than failing the whole
call, so one bad serial cannot break a playbook run.

```bash
curl -s -H "X-Api-Key: $API_KEY" "$BACKEND/api/machines?serial=560020728&serial=560020727"
```

Comma-separated also works: `?serial=560020728,560020727`.
With no `serial` parameter it returns the whole catalogue — handy for demo prep.

### `GET /api/customers/:account/objects`

All machines and related objects for one account. Powers the "other machines at this
account" list in the panel. Account matching is case-insensitive.

```bash
curl -s -H "X-Api-Key: $API_KEY" "$BACKEND/api/customers/Sanchez-Cano/objects"
# {"customer_account":"Sanchez-Cano","country":"Spain","key_account":null,"machine_count":2,"machines":[...]}
```

### `POST /api/tickets/:conversationId/snapshot`

The playbook's write-back. Body is a free-form field map. Returns **201**.

```bash
curl -s -X POST -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"Machine(s)":"X-RAY","Country":"Spain","Service Contract":"Service 365 Ultimate (X-Ray)","Warranty Active?":true,"Request Type":"warranty"}' \
  $BACKEND/api/tickets/cnv_demo/snapshot
```

A nested `{"fields": { ... }}` body is accepted too, since Front's request builder can
produce either shape depending on how the step is configured.

### `GET /api/tickets/:conversationId/snapshot`

What the plugin reads to show **AI-filled** values. **404** when nothing has been written.

```bash
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/tickets/cnv_demo/snapshot
```

### `billing_status`

Derived, and the thing the playbook branches on:

| Condition | Value |
|---|---|
| `warranty_active === true` | `warranty` |
| else, `service_contract` set and not `"None"` | `contract` |
| otherwise | `chargeable` |

The seed data covers all three: `560020728` → `warranty`, `560019430` → `contract`,
`560018221` → `chargeable`.

---

## Wiring up the Front AI playbook

### 1. Send app request — machine lookup

| Setting | Value |
|---|---|
| Method | `GET` |
| URL | `https://<your-backend>/api/machines/{{serial}}` |
| Header | `X-Api-Key: <your API_KEY>` |

Map the response into Front custom fields:

| Response field | Front custom field |
|---|---|
| `machine_type` | `Machine(s)` |
| `country` | `Country` |
| `service_contract` | `Service Contract` |
| `warranty_active` | `Warranty Active?` |
| `billing_status` | `Request Type` |
| `region_inbox` | routing / Group |

### 2. The 404 branch

When the request returns **404** with `{"error":"serial_not_found"}`, branch to a reply
asking the customer to re-check the serial on the machine plate. Do not let the playbook
continue and write empty fields.

### 3. Write-back so the panel shows the result

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `https://<your-backend>/api/tickets/{{conversationId}}/snapshot` |
| Header | `X-Api-Key: <your API_KEY>` |
| Body | the resolved field map, keys matching the Front custom field names |

The plugin reads this back and badges those values **AI-filled**, which is what makes the
automation visible on screen during the demo.

---

## Front setup

### Inboxes — already exist

The panel picks a field set from the conversation's inbox:

| Inbox | ID | Field set |
|---|---|---|
| Support + Complaints | `inb_51v4d` | Complaints |
| Tech Support | `inb_51v65` | Tech Support |

These IDs are in [`plugin/src/fieldSets.ts`](plugin/src/fieldSets.ts) under
`INBOX_FIELD_SETS`. Anything else falls back to name matching, then to Tech Support. The
segmented toggle in the panel header always overrides — so you can force the right set
live if a conversation is in an unexpected inbox.

### Custom fields — you need to create these

> **Checked against the demo instance: none of these exist yet.** There are 214 custom
> fields and none of them are Ishida's. Front's API has no route for creating them
> (`POST /custom_fields` returns *"No such route"*), so this is a Settings task:
> **Settings → Company → Custom fields → conversation fields.**

The panel renders every field regardless, showing `—` for anything unset, so it stays
legible before you create them. But the playbook cannot **write** to a field that does
not exist.

**Minimum for the automation half (6 fields):**

| Name | Type |
|---|---|
| `Serial Number(s)` | Text |
| `Machine(s)` | Text |
| `Country` | Text |
| `Service Contract` | Text |
| `Warranty Active?` | Boolean |
| `Request Type` | Text or Enum (`warranty`, `contract`, `chargeable`) |

**Complaints set (adds 11):** `Complaint Category`, `Complaint Type`, `Complaint Status`,
`Commercial Impact`, `Which department(s)`, `Next Update` (date), `LN Reference`,
`Problem Statement`, `Proposed Solution`, `Latest Update`, `Final Resolution`.

**Tech Support set (adds 11):** `Date of SightCall Intervention` (date),
`SightCall Completed` (boolean), `Did SightCall Resolve the ticket?` (boolean),
`Reason SightCall did not resolve`, `Machine Breakdown?` (boolean),
`Callback Required` (boolean), `No. of Engineer Visits` (number), `Total time spent`,
`Time spent last update`, `Issue`, `Solution`.

Names must match `frontName` in `plugin/src/fieldSets.ts` **exactly** — that string is
how values are looked up. If you name a field differently in Front, change it there too.

### Registering the plugin

**Settings → Developers → Plugins → Create/Add plugin**, then paste the plugin's public
HTTPS URL. Front loads it in an iframe, so `http://localhost` will not work — it must be
public HTTPS (see Deploy below).

> Front's UI moves around between releases. If *Developers* is not where you expect,
> look under Settings → Company → Integrations/Apps. The plugin itself does not care how
> it was registered.

---

## Deploy

Front needs **both** over public HTTPS: the iframe URL and the API the playbook calls.

### Backend → Render

Push this repo, then Render → **New → Blueprint** → point at `render.yaml`. Set `API_KEY`
in the dashboard (it is marked `sync: false`, so it is never committed).

```bash
curl -s https://<your-service>.onrender.com/api/health
```

> Render's free plan sleeps when idle and has an ephemeral filesystem. Machines reseed
> from the CSV on every boot, but **ticket snapshots are lost on restart**. Harmless for a
> live demo — you POST the snapshot during the demo — but hit `/api/health` a minute
> before you present so the service is awake.

### Plugin → Vercel

Import the repo with **root directory `plugin/`**. `vercel.json` already sets the build
command, output directory and a `frame-ancestors` policy allowing Front to iframe it.
Set these environment variables in the Vercel project:

- `VITE_BACKEND_URL` = your Render URL
- `VITE_API_KEY` = the same value as the backend's `API_KEY`

Rebuild after changing them — Vite inlines `VITE_*` at build time, not runtime.

### Or tunnel locally with ngrok

```bash
ngrok http 5173    # plugin URL for Front
ngrok http 4000    # backend URL for VITE_BACKEND_URL and the playbook
```

Both must be HTTPS. Set `VITE_BACKEND_URL` to the backend tunnel and restart the Vite dev
server, otherwise the iframe will try to reach `localhost` from Front's origin and be
blocked as mixed content.

---

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `API_KEY` | backend | Expected `X-Api-Key` value. Requests fail 500 if unset. |
| `PORT` | backend | Listen port, default `4000`. Render sets this itself. |
| `DB_PATH` | backend | SQLite path, default `:memory:`. |
| `SEED_CSV_PATH` | backend | Override CSV location. |
| `VITE_BACKEND_URL` | plugin | Backend base URL, default `http://localhost:4000`. |
| `VITE_API_KEY` | plugin | Sent as `X-Api-Key`. **Inlined into the bundle** — see below. |
| `FRONT_API_TOKEN` | scripts only | Front API token. Never read at runtime. |

---

## Demo script

1. **Backend is real.** `curl` `/api/machines/560020728` on the terminal — X-ray, in
   warranty, with work orders, parts, quotes and contract nested under it.
2. **Open a conversation** in Support + Complaints or Tech Support. The panel picks the
   field set from the inbox and shows *every* field for that ticket type in one list —
   the "no more hidden fields, no scrolling a huge form" point.
3. **Serial detection.** With a `Serial Number(s)` field set, it reads that. Without one,
   it regex-scans the message bodies for `5600xxxxx`. The panel says which path fired.
   Type a serial into the box to force it.
4. **Associated objects.** Machine card with a green/red warranty pill, then work orders,
   spare parts, quotes, and the customer's other machines — the Zendesk custom-object
   replacement. `560020728` and `560020727` are the X-ray/DACS pair at Sanchez-Cano, so
   each shows the other.
5. **Run the playbook.** It calls the backend, writes the custom fields, and POSTs the
   snapshot. Hit **Refresh** in the panel — the resolved values appear with **AI-filled**
   badges.
6. **Edge case.** `560018221` (Intersnack) is out of warranty with no contract →
   `chargeable`, red pill. `999999999` → the "not in the ERP, ask the customer to
   re-check" state.
7. **Draft.** *Draft machine summary* creates a Front draft with the machine, warranty,
   billing status and open work orders, threaded as a reply to the latest inbound message.

---

## Security note

The plugin calls the backend **directly from the iframe**, so `VITE_API_KEY` is inlined
into the JavaScript bundle and is visible to anyone who opens devtools. That is a
deliberate trade for this demo: the data is entirely fabricated and the backend holds
nothing real.

For production you would route the call through Front's `context.sendHttp` relay so the
credential stays server-side, configured against the app's private API rather than
shipped to the browser. The SDK exposes `sendHttp` and `relayHttp` on every context —
that is the swap, and it does not change the panel's UI.

Rotate `API_KEY` after the demo.

---

## Known limits

- **The plugin cannot write Front custom fields.** The SDK exposes
  `conversation.customFieldAttributes` as read-only; there is no setter. Writing is the
  playbook's job via Front's REST API. That is precisely why the snapshot round-trip
  exists — it is the only way the panel can display AI-populated values.
- Only the **first** detected serial drives the panel. Multi-serial tickets show a count
  in the header and the batch endpoint supports them, but the panel renders one machine.
- Associated objects are generated, not stored — deterministically seeded from the serial,
  so they are stable across restarts and rehearsals, but they are not editable.

---

## Verifying it works

```bash
export API_KEY=your-key BACKEND=http://localhost:4000

curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/560020728 | jq .billing_status   # "warranty"
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/560019430 | jq .billing_status   # "contract"
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/560018221 | jq .billing_status   # "chargeable"
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Api-Key: $API_KEY" $BACKEND/api/machines/999999999   # 404
curl -s -o /dev/null -w '%{http_code}\n' $BACKEND/api/machines/560020728                            # 401
```

Snapshot round-trip:

```bash
curl -s -X POST -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"Machine(s)":"X-RAY"}' $BACKEND/api/tickets/cnv_demo/snapshot          # 201
curl -s -H "X-Api-Key: $API_KEY" $BACKEND/api/tickets/cnv_demo/snapshot       # 200
```

`cnv_demo` is the conversation id the panel uses in demo mode, so you can POST that and
watch the **AI-filled** badges appear in a plain browser tab — no Front required.
