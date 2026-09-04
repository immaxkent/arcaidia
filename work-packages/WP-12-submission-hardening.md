# WP-12 — Submission hardening (M12)

**Objective:** treat submission quality as part of the build. Judges review code manually; the
video and README carry the argument.

**Depends on:** WP-11. **Blocks:** WP-13.
**Stack:** Next.js, docs, CI.

## Sub-tasks

- [ ] **12.1 UI polish.** Status and decision surfaces, explorer links for every transaction,
      real error handling, loading states, mobile-tolerable layout. The decision panel showing
      live agent inputs is the highest-value screen — make it legible to a non-engineer.
- [ ] **12.2 Architecture diagrams.** Trust hierarchy; onchain/offchain boundary with both
      settlement paths; the transaction sequence. Three diagrams, in the README, rendered not linked.
- [ ] **12.3 README completion.** Architecture, the **explicit authorised-solver trust assumption**,
      setup instructions, `.env.example`, deployed contract addresses (both chains, showing the
      matching CREATE2 addresses), data sources, indexed entities and the decisions they influence,
      demo steps, and a concise bounty mapping per sponsor.
- [ ] **12.4 Demo script.** A written 2–4 minute run sheet: what to show, in what order, what to
      say. Rehearse against a live run. Include the fallback narration if something fails on camera.
- [ ] **12.5 Video.** 2–4 minutes, 720p+, clear spoken audio, no music bed. Must show the actual
      onchain/offchain boundary: source CCTP commitment → Graph observation → agent decision with
      its live inputs → Agent Wallet fill → recipient receipt → later LP reimbursement. State the
      trust assumption out loud.
- [ ] **12.6 CI green and visible.** Badge in the README; all suites running on push.
- [ ] **12.7 Commit history review.** Confirm it reads as chronological, incremental work.
- [ ] **12.8 Submission entry finalised** on the ETHOnline platform, with every sponsor bounty
      mapped to its evidence. Started in WP-00; kept current since.

## Acceptance gate

The Arc/Circle, The Graph and Privy submission acceptance checklists are fully evidenced — each
requirement mapped to a specific artefact in the repo, the demo or the video.

## Traps

- Leaving the video to the last hour. Record a rough cut after WP-11 and improve it.
- A README that describes intent rather than evidence. Every claim gets a link, a hash or a query.
- Silently dropping the trust assumption because it sounds like a weakness. Stating it plainly
  reads as engineering maturity; omitting it and being caught reads much worse.
