# Wiring the feedback store (Neon + Vercel)

Nothing here ships a database credential. The npm package knows one URL; the
Vercel function holds the connection string; Neon is never reachable from a
client. Swapping Neon for something else later means editing one file.

```
CLI / MCP  --POST-->  analyzthis-lab.vercel.app/api/feedback  --SQL-->  Neon
 (no creds)            (NEON_DATABASE_URL in Vercel env)
```

## 1. Create the Neon project

In the Neon console: **New Project** — free tier, region `ap-south-1` (Mumbai)
to match your Vercel/Supabase footprint.

Copy the **pooled** connection string (the one containing `-pooler`). Serverless
functions open a connection per invocation, so the pooled endpoint is the one
that survives traffic.

```
postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require
```

## 2. Apply the schema

Run this yourself so the credential never leaves your machine:

```bash
psql "postgresql://...-pooler.../neondb?sslmode=require" -f neon/001_schema.sql
```

Verify:

```bash
psql "$NEON_DATABASE_URL" -c "\dt"
psql "$NEON_DATABASE_URL" -c "select count(*) from persona_feedback;"
```

Expect tables `persona_feedback`, `persona_scores`, and view
`persona_failure_signal`.

## 3. Give Vercel the connection string

```bash
cd website
vercel env add NEON_DATABASE_URL production
# paste the pooled string when prompted
vercel env add NEON_DATABASE_URL preview
```

Or Vercel dashboard → **analyzthis-lab** → Settings → Environment Variables.

## 4. Deploy

`website/package.json` was added for the one dependency the function needs:

```bash
cd website && vercel --prod
```

## 5. Verify end to end

```bash
curl -s -X POST https://analyzthis-lab.vercel.app/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"kind":"corrections","rows":[{"install_id":"smoke","feedback_id":"smoke-1","persona":"zara","satisfied":false,"rating":2,"outcome":"revised","task_type":"delight_pass","user_comment":"smoke test"}]}'
# -> {"ok":true,"inserted":1}
```

Then remove the smoke row:

```bash
psql "$NEON_DATABASE_URL" -c "delete from persona_feedback where install_id='smoke';"
```

Real submission from the CLI (consent is prompted once, and only stored on a yes):

```bash
npx analyzthis_design feedback --submit --all
npx analyzthis_design scores --submit
```

## What each side may do

| | Package (every user) | Vercel function | Neon |
|---|---|---|---|
| Holds a DB credential | no | yes (env only) | — |
| Can read other users' rows | no | no (insert paths only) | yes (you, via psql) |
| Can drop tables | no | no | yes (you) |

The function only ever runs `insert`. There is no read path exposed over HTTP,
so a leaked endpoint URL lets someone submit noise — never read anyone's data.
That's the same trade `website/api/lead.js` already makes with Airtable.

## Reading the signal

```sql
select * from persona_failure_signal where persona = 'zara';
```

Gated at 3+ distinct installs on purpose: one loud user must not reshape a
persona for everyone. Below that threshold, read the raw rows and judge by hand.

## Opting out

```bash
npx analyzthis_design feedback --revoke-consent
```

Deletes `~/.analyzthis_design/feedback/submit-consent.json`. Local scoring keeps
working — it never needed the network.
