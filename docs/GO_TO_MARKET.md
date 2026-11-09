# Getting to $100,000 of real volume by 30 November

## What decides this challenge

- Entries are ranked by **verified mainnet volume** through your integration. Code quality only breaks ties.
- Below **$100,000** of qualifying volume in the window (21 Oct to 30 Nov 2026) an entry is not assessed at all.
- Self-dealing does not count. Circular transfers, moving your own treasury without a business purpose and
  anything that looks like prize farming are excluded, and can disqualify the entry. Every dollar has to be
  a payment somebody needed to make anyway.
- There were 72 submissions when this was written, and only three places pay.

So the product is the easy part. The entry is won or lost on whether one or two organisations run real
payouts through it in the next three weeks. Plan your time accordingly: roughly one day finishing go-live,
the rest on customers.

## Why payouts, and what $100,000 looks like

A private-send app needs thousands of users to reach $100,000. A payout tool needs one customer:

| Customer | Typical single run |
| - | - |
| A 15 to 20 person crypto team's monthly contributor payroll | $80,000 to $150,000 |
| A token project paying a grant round, KOL round or market-maker fees | $50,000 to $500,000 |
| A hackathon or bounty sponsor paying winners | $10,000 to $100,000 |
| A validator or staking pool distributing commission | $20,000 to $200,000 |
| A gaming guild or tournament paying prizes | $5,000 to $50,000 |

Month-end payroll falls on 27 to 30 November, inside the window. That is the single best opportunity, and
it means a customer has to be signed up and tested by about 24 November.

## Who to contact, in order

1. **People who already pay contributors in USDC on Solana.** DAO operations leads, founders of small
   Solana teams, agency owners paying contractors. Find them through Superteam chapter chats, Solana
   founder groups and the projects you have personally worked with or for.
2. **Bounty and hackathon sponsors.** They post on Superteam Earn, pay batches of winners, and their payout
   lists are small and well defined. The sponsor contact is on each listing.
3. **Token projects with a distribution coming up.** Grants, contributor unlocks, migration payouts. Look
   for announcements dated late November.
4. **The MultiHopper builder chat.** Ask the team which use cases they most want to see live. They benefit
   from your volume and may introduce you to a design partner.

## The pitch

What a customer gets for the 0.5%:

- **Salaries are not broadcast.** A normal bulk send lists every teammate's pay in one transaction that
  every teammate can open. Routed payouts are separate transfers and recipients are not in the route's
  published hop list.
- **Screening on every payee.** Each sender and recipient is checked against TRM Labs sanctions data before
  funds move, which is a record a finance lead can point to.
- **Scheduled delivery and receipts.** Sign today, deliver on the 30th, export a CSV for the books.
- **No custody.** They sign in their own wallet (a multisig member wallet works for a first small run).

Be exact about the limit: this reduces linkage, it is not anonymity, and anyone doing chain analysis can
still follow payouts. Overselling privacy to a finance person loses the deal and breaks the challenge's
own guidance.

First message (adapt it, keep it short):

> Hi [name] — I saw [team] pays contributors in USDC on Solana. I built a small tool that pays a whole
> sheet in one go without putting everyone's salary in a single public transaction, with sanctions
> screening on each payee and a CSV receipt at the end. Non-custodial: you sign in your own wallet. Would
> you try it on a small batch this week? I'll sit with you while you do it.

Ask for a **small real batch first** (three to five people, a few hundred dollars). A customer who has
seen one run complete will put November payroll through it. One who has not will not.

## A discount to consider

You earn half of the 0.5% fee. Offering launch customers part of that back makes the effective cost 0.25%
to 0.4%. **Ask the organisers in the builder chat before you do this**: the rules exclude "prize-farming
activity", and you want it in writing that a rebate to a real customer is acceptable.

## Three-week plan

| Dates | Do |
| - | - |
| 9 to 11 Nov | Devnet key, run the README devnet checklist, fix anything the live API does differently. Request production access and ask how attribution works. Send the first twenty outreach messages. |
| 12 to 16 Nov | Deploy to mainnet. Run one small real payout yourself (a genuine payment you owe someone). Record the demo video. Keep messaging: aim for five conversations. |
| 17 to 23 Nov | Walk two or three prospects through a small batch each. Fix whatever confuses them the same day. |
| 24 to 30 Nov | Month-end runs. Be online while customers pay. Run `npm run evidence` daily. |
| By the deadline on the listing | Submit on Superteam Earn with the evidence export. Check the listing for the exact cut-off; it was not published when this was written. |

## Questions to put to the organisers now

The listing still marks several terms as draft. Get answers in the builder chat before investing the time:

1. How is a production integration identified and attributed for the challenge?
2. What is the exact submission deadline and the UTC cut-off for volume?
3. Is the prize split fixed (60/25/15) or proportional to volume among the top three? The two pages differ.
4. Is SPL (USDC) Multi-Send live on mainnet, or only SOL?
5. Is a customer rebate from the integrator's share allowed?
6. Does a customer's payroll count as a "treasury movement with a verifiable business purpose", and what
   evidence do they want for it?

## What it is worth if you do not place

Integration revenue is 0.25% of volume, paid on chain into your rewards wallet with every route, whether or
not you win: $250 per $100,000 routed. That is small on its own. The lasting value of the three weeks is a
working product with a paying customer or two, which is a better position than most entries will be in.

## Before you take money

You are offering payment software to businesses. It is non-custodial, which helps, but the rules on this
vary by country. Check what applies where you live before signing up customers, and do not describe the
product as a way to avoid tax reporting or sanctions.
