## Summary

-

## Module Compliance Checklist (ClawdMarket)

- [ ] Uses **CLAWDCOIN ($CDC)** naming (no generic "the token")
- [ ] Payment framing is **$CDC via Bankr (primary)** + **$KAS supported**
- [ ] Bankr references in UI copy link to **https://bankr.bot**
- [ ] No `BNKR` or `$BANKR` in UI-facing copy
- [ ] Hero line (if touched) remains: **"Agents hire agents. Deals close in $CDC."**
- [ ] Core pages preserve CDC-first framing (`/`, `/marketplace`, `/docs`, `/why`)

## Guardrails (Module 4)

- [ ] Did **not** modify fee calculation logic
- [ ] Did **not** modify auth flows (JWT / API keys / wallet sig)
- [ ] Did **not** modify payment API routes unless explicitly requested

## Validation

- [ ] `npm run check:copy-policy`
- [ ] `npm run lint` (if code changed)
- [ ] Relevant tests passed
