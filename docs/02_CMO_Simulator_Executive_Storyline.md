# Mybrew CMO Campaign Simulator — Executive Storyline

**Source:** `02_CMO_Simulator` notebook · Fabric workspace `BrewP`
**Audience:** C-level (CMO, CFO, CEO) · **Runtime:** 8–10 minutes
**Purpose:** Show how a marketing organisation moves from *reporting what happened* to *deciding what to do next* — on one platform, on live data.

---

## 1. The one-sentence story

> "Mybrew's marketing team can see, decide, and act on campaign performance inside a single platform — and we can prove the financial impact of each decision before we commit the budget."

Everything in the notebook exists to support that sentence. If an executive remembers nothing else, they should remember that marketing decisions became **measurable and reversible**.

---

## 2. The problem we are dramatising

Most marketing organisations have all four of these, and none of them talk to each other:

| The question the CMO asks | Where the answer lives today | Time to answer |
|---|---|---|
| Which publisher is actually working? | Agency dashboard / publisher portals | Days, and each portal marks its own homework |
| What if I move budget between them? | A spreadsheet someone builds by hand | A week |
| Who should we target *right now*? | CRM, disconnected from campaign data | Not answered — it's a batch job |
| What did all this return? | Finance, after the quarter closes | 30–60 days, too late to act |

**The cost of that fragmentation:** by the time the answer arrives, the campaign is over. Budget is optimised in the rear-view mirror.

The demo's job is to collapse all four questions into one surface, answered in seconds.

---

## 3. Narrative arc

The notebook has a deliberate four-act structure. Present it as a decision journey, not as five code cells.

```
ACT 1              ACT 2               ACT 3                ACT 4
SEE                DECIDE              ACT                  PROVE
"What is           "What should        "Who do we           "What did it
 happening?"        we change?"         reach today?"        return?"
   │                   │                   │                    │
Publisher          Budget              Personalization      ROI
performance        reallocation        triggers             dashboard
(Cell 2)           (Cell 3)            (Cell 4)             (Cell 5)
```

The arc matters more than the code. Each act answers the objection raised by the previous one.

---

## 4. Section-by-section script

### Opening — set the frame (30 sec)

> "This is the Mybrew marketing data estate. Every campaign, transaction, customer and even the weather is in one lakehouse. I'm going to take you through a decision the CMO makes every week — and show you it end-to-end in about eight minutes."

**On screen:** Cell 1 output — the data inventory.

**Say:** "Campaigns, transactions, impressions, customers, weather. One query surface, no data movement, no extracts."

> ⚠️ **Do not read the row counts aloud.** See §7 — the current dataset is a small sample and the numbers invite the wrong question.

---

### ACT 1 — SEE: Publisher performance (90 sec)

**On screen:** Two bar charts — CTR by publisher, CPA by publisher.

**Say:**
> "First question every CMO asks: which of my publishers is actually working? Not what each publisher claims — what our own first-party data says. Click-through on the left, cost-per-acquisition on the right."

**The executive "so what":**
> "This is the first time these publishers are being compared on *our* numbers rather than on the reports they each send us. Same definition, same window, same source of truth."

**Landing line:** "Notice the spread. That gap is the opportunity."

---

### ACT 2 — DECIDE: Budget reallocation (2 min) ← **the centrepiece**

**On screen:** The budget simulator output.

**Say:**
> "Seeing the gap is interesting. Acting on it is valuable. So we simulate: what happens if we move budget from the weaker publisher to the stronger one — before we spend a pound?"

Walk the three blocks deliberately:

1. **Current allocation** — "Here's how the £4.8M is split today, with the return each is generating."
2. **The recommendation** — "Move £120,000 from Google Display into Meta Stories."
3. **Projected impact** — "Here's the modelled outcome: net new conversions, improved blended cost per acquisition, incremental revenue."

**The executive "so what" — this is the money line:**
> "This is the shift. Marketing stops being an annual budget argument and becomes a series of small, testable, reversible decisions. We are not asking for more budget — we are asking the same budget to work harder, and we can show the arithmetic before we commit."

**Anticipate the CFO:** they will ask where the elasticity assumption comes from. Answer honestly:
> "The model assumes cost-per-acquisition holds as we shift spend. That's a simplifying assumption and it degrades at scale — which is exactly why we move £120k and not £1.2M. Small, measurable steps, and we re-baseline after each one."

---

### ACT 3 — ACT: Personalization triggers (2 min)

**On screen:** Trigger output for London.

**Say:**
> "Budget allocation is the wholesale decision. This is the retail one — which individual customer do we talk to today, and why?"

Walk the triggers:

- **Weather trigger** — "It's cold in London, so we push a warm drink offer to opted-in customers in that city. The weather table is joined to the customer table live. No campaign manager built a segment."
- **Win-back** — "Customers who haven't visited in 30 days get a voucher."
- **Tier nudge** — "Customers just short of the next loyalty tier get told how close they are."

**The executive "so what":**
> "Three things to notice. These are *rules*, not hand-built campaigns — they run continuously. They're driven by signals we already own. And every one is consent-gated: the opt-in flag is in the query, not in a policy document."

That last point pre-empts the governance question before it's asked. Say it deliberately.

> ⚠️ **Rehearsal risk:** the cold-weather trigger only fires below 5 °C. On the last run London was 6 °C and **the trigger silently produced no output** — the headline moment of this act simply didn't appear. See §7.

---

### ACT 4 — PROVE: ROI dashboard (2 min)

**On screen:** ROAS by campaign and publisher, with the break-even line.

**Say:**
> "Finally, the question the board actually asks: what did we get back?"

Point at the break-even line first:
> "Everything above this red line returns more than it costs. That line is the whole conversation — and until now it arrived 60 days after the quarter closed. Here it's live."

**Close on the summary block:** total attributed revenue, total spend, blended ROAS and ROI.

**The executive "so what":**
> "Attribution, spend and return in one place, refreshed continuously. Marketing can now be held to the same standard as any other capital allocation decision in the business — and that's a good thing for marketing, because for the first time it can *prove* its case."

---

## 5. Closing — the platform argument (45 sec)

Zoom out. The individual charts are not the point.

> "Nothing you just saw required data to be copied, exported, or handed between teams. Same lakehouse, same governance, same security model — from raw impression through to the ROI number the CFO sees. The reason this takes eight minutes instead of eight weeks isn't that we built better charts. It's that the data never had to move."

**Then bridge to the rest of the demo:**

| Next surface | The line that gets you there |
|---|---|
| **Stream Analytics** | "That was the weekly decision cycle. Now let me show you the same estate reacting in seconds, not days." |
| **Business Context** | "…and how the business ontology lets someone ask these questions in plain language, without writing a query." |
| **WW IQ** | "…and finally, the outside view: what the market is saying about our competitors, scored in real time." |

---

## 6. Anticipated C-level questions

| Question | Short answer |
|---|---|
| *"Is this real data or a mock-up?"* | Be straight: the customer, weather and impression data is queried live from the lakehouse. The budget and ROI figures are **modelled scenarios**, not actuals. Say so before you're asked. |
| *"How confident are we in the reallocation model?"* | It assumes stable CPA under a modest shift. Valid for small moves, degrades at scale. That's why it recommends £120k, and why we re-baseline after each step. |
| *"What about privacy / consent?"* | Consent is enforced in the query itself (`opted_in`), not in a downstream process. Nothing reaches a customer who hasn't opted in. |
| *"What would it take to run this for real?"* | The connectors and the model are the easy part. The real work is agreeing a single definition of conversion and attribution across marketing and finance. |
| *"Why Fabric rather than what we have?"* | Because every one of those four acts read from the same copy of the data. The alternative isn't a worse chart — it's four teams reconciling four spreadsheets. |
| *"Can we act on the recommendation from here?"* | Today the notebook ends at *"Ready to execute."* Write-back to the ad platforms is the natural next step — worth naming as roadmap rather than implying it exists. |

---

## 7. ⚠️ Pre-flight: fix before showing this to a CFO

The storyline is sound. **The numbers currently are not**, and a finance audience will catch it. Four issues, in priority order.

### 7.1 The reallocation produces an absurd return — highest risk

Cell 3 reports **+1,926 net conversions** but only **£9,151 additional revenue**. That values a conversion at £4.75 — the price of a cup of coffee — while paying a £21.14 cost per acquisition to obtain it.

Read literally, the recommendation is: *move £120,000 and receive £9,151 back.* A CFO will spot this immediately, and it contradicts the 4.13× ROAS shown three lines above.

The stated ROAS figures imply a conversion is worth **≈ £87**, not £4.75:

```
Meta:   £2.4M spend ÷ £21.14 CPA = 113,528 conversions
        £2.4M × 4.13 ROAS        = £9.912M revenue
        → £87.31 revenue per conversion

Google: £1.8M spend ÷ £32.00 CPA =  56,250 conversions
        £1.8M × 2.76 ROAS        = £4.968M revenue
        → £88.32 revenue per conversion   ← consistent, confirms the intent
```

**Cause:** `£4.75` is the average *cup* price (correctly used in Cell 4 for a single redemption) and was reused in Cell 3 as the value of an acquired *customer*.

**Fix:** derive revenue per conversion from ROAS and CPA rather than hard-coding it. The headline then becomes **≈ £168,000 incremental revenue** on a £120k reallocation — both internally consistent and a far stronger story.

### 7.2 The blended CPA improvement is hard-coded and wrong

`-£2.10` is a printed string, not a calculation. The actual improvement on these inputs is about **-£0.28**:

```
Before: 169,778 conversions on £4.2M (Meta+Google) → £24.74 blended CPA
After:  171,705 conversions on £4.2M              → £24.46 blended CPA
```

Either compute it or remove it. Don't show a number that isn't derived from the model.

### 7.3 Cells 3 and 5 describe two different companies

They don't reconcile, and both are on screen within four minutes of each other:

| | Cell 3 | Cell 5 |
|---|---|---|
| Total spend | £4,800,000 | £3,245,000 |
| Meta spend | £2,400,000 | £2,090,000 (£890k + £1.2M) |
| Meta ROAS | 4.13× | 4.20× (Winter Warmth) |

Pick one set of figures and drive both cells from it.

### 7.4 Both these cells are entirely hard-coded

Cell 5 is explicitly commented `# Simulate ROI data` with a hand-typed table. Neither Cell 3 nor Cell 5 touches the lakehouse.

That's legitimate for a simulator — but it means **Acts 2 and 4 are illustrative, while Acts 1 and 3 are live**. Know which is which, and never claim otherwise if asked directly. The demo survives "these are modelled scenarios"; it does not survive being caught.

### 7.5 Two rehearsal risks in Act 3

- **The cold-weather trigger didn't fire.** Threshold is `< 5 °C`; London last ran at 6 °C, so the block was skipped and produced no output at all. Either raise the threshold to `< 8 °C`, pin a demo weather value, or make the `else` branch print *"no trigger — conditions not met"* so the logic is still visible.
- **The win-back trigger reports £10 of revenue.** Mathematically correct (9 customers × 21% × £5.25) but jarring beside £11.9M elsewhere. Either scale the customer table or present the trigger as a *rate* rather than an absolute.

### 7.6 The sample dataset is small

The last execution loaded 10 campaigns, 25 transactions, 25 impressions, 20 customers. Act 1's publisher comparison is therefore computed from ~25 impressions spread across several publishers.

The chart renders fine, but **do not invite scrutiny of the sample size** — don't read the counts aloud, and if asked, be direct that it's a representative sample rather than production volume. Scaling the generator before the session would remove the risk entirely.

---

## 8. Recommended fix order

If you have limited time before the session:

1. **§7.1** — the £4.75 constant. One line, removes the biggest credibility risk, and *improves* the headline number.
2. **§7.5** — the weather threshold. One line, prevents a silent dead spot mid-demo.
3. **§7.3** — reconcile Cells 3 and 5 to one set of figures.
4. **§7.2** — compute or drop the blended CPA line.
5. **§7.6** — scale the sample data if time allows.

Items 1 and 2 are single-line changes and together remove most of the exposure.
