# Climate Futures Protocol: A Decentralized Forward Market for Global Temperature Forecasting

**Version 1.0 — July 2026**

---

## Abstract

Climate Futures Protocol (CFP) is a decentralized prediction market built on Ethereum that creates forward contracts settling on observed global mean temperature anomaly at decade boundaries from 2030 through 2100. By enabling participants to take financially-backed positions on future climate outcomes, the protocol surfaces distributed information about climate trajectories and creates real price signals for climate risk. Settlement is determined by the median of at least five globally recognized scientific authorities. The protocol is governed by a tripartite governance structure: vote-escrowed token holders (veCLMT), an independent Science Advisory Board with oracle veto power, and the Climate Futures Foundation, a 501(c)(3) nonprofit that provides institutional continuity, grant reception, and regulatory interface. All three bodies must agree on protocol changes, making capture by any single interest effectively impossible. Protocol fees fund veCLMT staker yield, the Foundation's operations, and the Oracle Fund that pays data providers.

---

## 1. Motivation

### 1.1 The Climate Information Problem

Despite decades of scientific research, global policy response to climate change remains hampered by disagreement about the pace and magnitude of warming. Climate models produce wide uncertainty bands. Political actors selectively cite projections that support their positions. The result is a noisy information environment where the true "market expectation" of future warming is invisible.

Financial markets are among the most powerful information-aggregation mechanisms ever created. When real money is at stake, participants have strong incentives to be right rather than merely persuasive. A liquid, well-designed prediction market for global temperature anomaly would produce a continuously-updated, financially-backed consensus estimate of future warming — a signal that is currently missing from the climate discourse.

### 1.2 Why Ethereum

Traditional prediction markets require trusted intermediaries and face jurisdictional limitations. A contract settling in 2100 requires institutional continuity that no corporation or government can guarantee. Ethereum provides:

- **Permissionless access**: Anyone worldwide can participate without institutional gatekeeping.
- **Credible neutrality**: No single entity controls the market.
- **Programmable settlement**: Smart contracts enforce payouts automatically, eliminating counterparty risk.
- **Durability**: The network is designed to outlast any individual organization — critical for contracts spanning decades.
- **Composability**: Other protocols can build on top of climate futures positions for insurance, hedging, and structured products.

### 1.3 Design Goals

1. **Information discovery**: Surface the market's best estimate of future temperature anomaly at each settlement date.
2. **Accessibility**: Minimize barriers to participation so that the broadest possible set of information holders can contribute.
3. **Integrity**: Ensure settlement is determined by objective, verifiable scientific data from trusted authorities.
4. **Longevity**: Build governance and economic structures that sustain the protocol across a 74-year operating horizon.
5. **Composability**: Design position tokens that integrate with the broader DeFi ecosystem.

---

## 2. Market Design

### 2.1 Settlement Dates and Instrument Structure

The protocol creates eight independent markets, one for each settlement year:

| Market | Settlement Year | Settlement Date |
|--------|----------------|-----------------|
| CFP-2030 | 2030 | March 31, 2031 |
| CFP-2040 | 2040 | March 31, 2041 |
| CFP-2050 | 2050 | March 31, 2051 |
| CFP-2060 | 2060 | March 31, 2061 |
| CFP-2070 | 2070 | March 31, 2071 |
| CFP-2080 | 2080 | March 31, 2081 |
| CFP-2090 | 2090 | March 31, 2091 |
| CFP-2100 | 2100 | March 31, 2101 |

Settlement dates are set to March 31 of the following year to allow time for scientific authorities to compute and publish annual global mean temperature anomaly data for the target year.

### 2.2 The Temperature Anomaly Metric

Each market settles on the **global mean surface temperature anomaly** relative to the pre-industrial baseline (1850-1900 average), measured in degrees Celsius. This is the standard metric used by the IPCC, NASA, NOAA, and other scientific bodies.

As of 2024, the observed anomaly is approximately +1.45°C. IPCC projections for 2100 range from approximately +1.5°C (SSP1-1.9) to +4.4°C (SSP5-8.5), depending on emissions pathway.

### 2.3 Payout Function

Each market uses a **linear payout function** bounded between +0.5°C and +4.0°C:

```
Let T = observed temperature anomaly at settlement (°C)
Let T_min = 0.5°C (lower bound)
Let T_max = 4.0°C (upper bound)
Let T_clamped = clamp(T, T_min, T_max)

LONG payout ratio = (T_clamped - T_min) / (T_max - T_min)
SHORT payout ratio = 1 - LONG payout ratio
```

For every pair of LONG + SHORT position tokens backed by 1 USDC of collateral:

- If T = 0.5°C or below: LONG pays 0 USDC, SHORT pays 1 USDC
- If T = 2.25°C (midpoint): LONG pays 0.5 USDC, SHORT pays 0.5 USDC
- If T = 4.0°C or above: LONG pays 1 USDC, SHORT pays 0 USDC

This structure ensures that:
1. **Total payout is always exactly the deposited collateral** — the protocol has no directional exposure.
2. **Both sides have bounded risk** — maximum loss is the collateral deposited.
3. **Price of a LONG token directly encodes the market's anomaly estimate** — if LONG trades at 0.40 USDC, the implied anomaly is 0.5 + 0.40 * 3.5 = 1.9°C.

### 2.4 Position Tokens (ERC-1155)

Positions are represented as ERC-1155 multi-tokens. Each market has two token IDs:

- **LONG token**: Pays proportionally to observed anomaly (bullish on warming)
- **SHORT token**: Pays the complement (bearish on warming)

Positions are minted in pairs: depositing 1 USDC into a market produces 1 LONG + 1 SHORT token. Either can be sold independently on the AMM or transferred peer-to-peer. This pair-minting mechanism ensures the system is always fully collateralized.

ERC-1155 was chosen over ERC-721 because positions are fungible within each market-side (all LONG-2050 tokens are identical), and ERC-1155 supports efficient batch transfers and is gas-efficient for multiple token types within a single contract.

### 2.5 Pre-Settlement Position Redemption

At any time before settlement, a holder of both 1 LONG and 1 SHORT token for the same market can redeem the pair for 1 USDC (minus a small redemption fee). This creates an arbitrage-enforced invariant: LONG price + SHORT price = 1 USDC (approximately), ensuring market prices remain meaningful.

---

## 3. Automated Market Maker (AMM)

### 3.1 Why LMSR

The protocol uses a **Logarithmic Market Scoring Rule (LMSR)** as its automated market maker, rather than a constant-product AMM (Uniswap-style). LMSR is the standard for prediction markets for several reasons:

1. **Bounded outcomes**: LMSR is designed for markets where outcomes are bounded (in our case, the payout ratio is between 0 and 1). Constant-product AMMs are designed for unbounded token pairs.
2. **Price interpretation**: In LMSR, the price of a token directly corresponds to the market's probability/expectation of the underlying outcome.
3. **Liquidity parameter**: LMSR's liquidity parameter `b` controls the trade-off between price impact and maximum subsidy, giving the DAO a direct lever to tune market depth.
4. **Proven track record**: LMSR is used by Polymarket, Augur, and Gnosis prediction markets.

### 3.2 LMSR Mechanics

LMSR maintains a cost function over the outstanding quantity of each outcome token:

```
C(q_long, q_short) = b * ln(e^(q_long/b) + e^(q_short/b))
```

Where:
- `q_long`, `q_short` = outstanding quantities of LONG and SHORT tokens
- `b` = liquidity parameter (higher b = more liquidity, higher maximum subsidy)

The cost to buy `Δ` LONG tokens is:

```
Cost = C(q_long + Δ, q_short) - C(q_long, q_short)
```

The instantaneous price of a LONG token is:

```
Price_long = e^(q_long/b) / (e^(q_long/b) + e^(q_short/b))
```

This ensures prices always sum to 1 and move smoothly in response to trades.

### 3.3 Liquidity Provision

The initial liquidity subsidy (the maximum amount the market maker can lose) is:

```
Max subsidy = b * ln(2)
```

This is funded from the DAO treasury at market creation. The DAO sets `b` to balance between:
- **Deeper markets** (higher `b`): Less price impact per trade, but higher maximum subsidy cost.
- **Cheaper markets** (lower `b`): Lower subsidy requirement, but thinner liquidity.

For a proof of concept, a reasonable starting value might be `b = 10,000`, implying a maximum subsidy of approximately 6,931 USDC per market.

### 3.4 Trading Fees

A 0.3% fee is applied to each trade on the AMM. This fee accrues to the DAO treasury, partially offsetting the liquidity subsidy over time. In a liquid market, trading fees can eventually exceed the subsidy, making the AMM profitable for the DAO.

---

## 4. Oracle System

### 4.1 Design Principles

The oracle system must:
1. Report objective, verifiable scientific data
2. Resist manipulation by any single entity
3. Handle the possibility that data sources change over decades
4. Provide finality within a bounded time window

### 4.2 Data Sources

Initial whitelisted data sources and their reporting methodologies:

| Source | Dataset | Baseline | Organization |
|--------|---------|----------|-------------|
| NASA GISS | GISTEMP v4 | 1951-1980 (converted to 1850-1900) | NASA Goddard Institute |
| NOAA NCEI | NOAAGlobalTemp v5 | 20th century average (converted) | National Oceanic and Atmospheric Administration |
| HadCRUT5 | HadCRUT5 | 1850-1900 | UK Met Office / CRU |
| Berkeley Earth | BEST | 1850-1900 | Berkeley Earth |
| JMA | JMA Global Temp | 1991-2020 (converted) | Japan Meteorological Agency |
| ERA5 | Copernicus/ECMWF | 1850-1900 | European Centre for Medium-Range Weather Forecasts |

All values are normalized to the 1850-1900 pre-industrial baseline before submission.

### 4.3 Two-Tier Reporting Architecture

The oracle uses a two-tier model that recognizes the institutional reality of scientific data providers:

**Tier 1 — Data Sources**: The authoritative institutions (NASA, NOAA, etc.) whose published data determines settlement. These organizations publish temperature data as part of their scientific mission. They are registered on-chain by the DAO but are *not* required to operate Ethereum wallets, hold tokens, or manage cryptographic keys.

**Tier 2 — Designated Submitters**: On-chain addresses authorised by the DAO to submit values on behalf of a specific data source. A submitter may be:
- The institution itself (if it chooses to operate a wallet)
- A DAO-approved intermediary (e.g., a university lab, a climate data nonprofit, or a protocol contributor)
- Multiple independent submitters per source for redundancy

This separation is critical because government and academic institutions are structured to produce and publish data, not to participate in DeFi protocols. The protocol meets them where they are — paying for the data they already produce — rather than asking them to adopt unfamiliar financial infrastructure.

### 4.4 Reporting Mechanism

1. **Reporting window**: Opens on January 15 of the year after the settlement year and closes March 15 (60-day window).
2. **Submission**: Each authorised submitter reads the published anomaly value from their assigned data source and submits it on-chain (in millidegrees Celsius for precision, e.g., 2450 = +2.450°C). Only one submission per data source is accepted (first valid submitter wins).
3. **Quorum**: Minimum 5 of 6 sources must be reported. If fewer than 5 are submitted within the window, the window extends by 30 days (repeatable up to 3 times).
4. **Aggregation**: The contract computes the **median** of all submitted values. The median is robust to a single outlier, requiring corruption of at least 3 of 6 sources to manipulate.
5. **Finality**: Once computed, the median value enters a 30-day dispute period.

### 4.4 Bounty-Based Incentives (Report-to-Earn)

Rather than requiring data providers to stake tokens (which government and academic institutions will not do), the protocol **pays submitters** for timely, accurate reporting. Incentives flow *to* reporters, not from them.

**Oracle Fund**: A dedicated USDC pool that pays bounties. Funded by:
1. **Protocol fee revenue**: A portion of trading, issuance, and settlement fees is routed to the Oracle Fund by DAO governance.
2. **CLMT oracle allocation**: The 5M CLMT oracle incentives allocation (5% of supply) can be sold by the DAO to fund bounties in USDC.
3. **External grants**: The DAO can accept grants from climate foundations, philanthropies, or government programs interested in supporting transparent climate data infrastructure.

**Bounty Structure**:
- **Submission bounty**: 5,000 USDC per valid, consensus-aligned submission (adjustable by tripartite governance).
- **Early bonus**: 1,000 USDC additional for the first valid submission in a reporting window (incentivizes timeliness).
- **Consensus requirement**: Only submissions within ±0.1°C of the final median are eligible for bounty. Outliers receive nothing but are not penalised — they simply aren't paid. This is sufficient incentive alignment because submitters are reading publicly-verifiable scientific data, not making subjective judgments.

**Why this works**: The data these institutions publish is already public and verifiable. A submitter who fabricates a value gains nothing (they'll be outside the consensus band and won't get paid) and risks losing their submitter authorization. The cost of honest reporting is near zero (read a published number, submit a transaction), while the reward is meaningful — especially for graduate students, postdocs, or small research groups who can serve as designated submitters.

**Estimated annual oracle cost**: At 8 settlement events with 6 sources each, the maximum annual bounty outflow is approximately 8 × 6 × 6,000 = 288,000 USDC. In practice, only one settlement event occurs per decade, so steady-state costs are ~36,000 USDC per settlement event — easily sustainable from protocol fee revenue.

### 4.5 Dispute Resolution

During the 30-day dispute period after oracle aggregation:

1. Any participant can raise a dispute by depositing a 10,000 USDC bond.
2. Resolution requires tripartite agreement: veCLMT holders vote, the Science Advisory Board reviews the scientific merits, and the Foundation Board confirms procedural integrity.
3. If the dispute is upheld, a corrected value is submitted and the disputer's bond is returned plus a 5,000 USDC reward from the Oracle Fund.
4. If the dispute is rejected, the disputer's bond is forfeited to the Oracle Fund.

The dispute bond is denominated in USDC (not CLMT) so that anyone with a financial stake in the market — not just governance token holders — can challenge a suspicious oracle result. This widens the set of watchdogs and makes the system more robust.

---

## 5. Governance: Tripartite Architecture

### 5.1 Design Philosophy

The protocol's 74-year operating horizon demands governance that is resistant to capture, adaptable over decades, and credible to both financial participants and the scientific community. We draw from the most durable governance models available:

- **From Bitcoin/Ethereum**: Minimize what is governable. The less that can be changed, the less there is to capture. Default to immutability; govern only what must adapt.
- **From constitutional democracies**: Separate powers across independent bodies with different incentives and constituencies. Require agreement across bodies for changes.
- **From established nonprofits**: Use legal structures with centuries-long track records (the 501(c)(3) form is older than any blockchain) for institutional continuity.

The result is a **tripartite governance** structure: three independent bodies, each with veto power over protocol changes. No single body — and no single type of actor — can unilaterally alter the protocol.

### 5.2 The Three Governing Bodies

#### Body 1: veCLMT Token Holders (On-Chain)

CLMT is the protocol's governance and yield token. Holders lock CLMT for a chosen duration (1 week to 4 years) to receive **veCLMT** (vote-escrowed CLMT) — a non-transferable balance representing voting power and fee-earning rights.

**Vote-escrow mechanics (modeled on Curve's veCRV):**
- Voting power = locked CLMT × (remaining lock time / max lock time)
- A token locked for 4 years has full weight; locked for 1 year has 25% weight
- Voting power decays linearly as the lock approaches expiry, requiring re-locking to maintain influence
- veCLMT is non-transferable — voting power cannot be bought on the open market

**Token Utility:**
1. **Governance voting**: veCLMT holders vote on all protocol proposals
2. **SAB confirmation**: veCLMT holders confirm or reject Science Advisory Board nominees
3. **Fee yield**: veCLMT holders receive USDC distributions from protocol fee revenue
4. **Delegation**: veCLMT holders can delegate voting power to trusted community members

**Initial Distribution (Total Supply: 100,000,000 CLMT):**

| Allocation | Percentage | Tokens | Vesting |
|-----------|-----------|--------|---------|
| Community / Liquidity Mining | 35% | 35,000,000 | Distributed over 10 years |
| Protocol Development | 20% | 20,000,000 | 4-year linear vesting |
| Initial Contributors | 15% | 15,000,000 | 2-year linear vesting, 6-month cliff |
| Foundation Endowment | 20% | 20,000,000 | Held by Foundation, governed by Foundation Board |
| Oracle Fund Seeding | 10% | 10,000,000 | Sold by Foundation to fund USDC bounties |

**No additional minting**: The total supply is fixed at 100,000,000. No entity can inflate the supply.

#### Body 2: Science Advisory Board (SAB)

The SAB is a panel of 7-9 active climate scientists from recognized research institutions. Its sole on-chain power is **veto over oracle-related changes**: data source additions/removals, submitter authorization, dispute resolution outcomes, and oracle parameter changes.

**Composition and appointment:**
- Foundation Board nominates candidates (active researchers with relevant expertise)
- veCLMT holders confirm or reject each nominee (simple majority)
- 3-year terms, staggered so no more than 3 seats turn over in any year
- Members receive a modest annual stipend plus expense reimbursement from the Foundation
- Veto requires 5-of-7 (or 5-of-9) SAB members

**Scope — what the SAB can and cannot do:**

| SAB CAN veto | SAB CANNOT do |
|-------------|--------------|
| Adding or removing data sources | Propose changes to any parameter |
| Authorizing or revoking submitters | Change fee rates or market parameters |
| Oracle dispute resolution outcomes | Access user funds or protocol collateral |
| Changes to oracle methodology | Manage the Foundation or its budget |
| Changes to bounty parameters | Override veCLMT votes on non-oracle matters |

The SAB is a **check**, not a governing body. It ensures that the scientific integrity of the oracle cannot be compromised by financial interests, even if those interests control a majority of veCLMT.

#### Body 3: Climate Futures Foundation

The **Climate Futures Foundation** is a US 501(c)(3) nonprofit corporation that provides the institutional layer the on-chain protocol cannot.

**Foundation Board of Directors (5-7 members):**
- Unpaid volunteers, per 501(c)(3) norms (expense reimbursement only)
- Mix of expertise: climate policy, nonprofit governance, technology, legal, finance
- Standard nonprofit governance: fiduciary duties, conflict of interest policies, D&O insurance
- Self-perpetuating board with veCLMT holder confirmation of new directors

**Executive Director:**
- Compensated professional hired by the Foundation Board
- Compensation funded partly from the Foundation's share of protocol fee revenue, aligning the ED's incentives with protocol health
- Responsible for day-to-day Foundation operations, data source relationships, grant applications, regulatory engagement, and SAB coordination

**Foundation responsibilities:**
1. Houses and administers the Science Advisory Board
2. Receives external grants (climate foundations, government programs, philanthropies) and channels them to the Oracle Fund
3. Maintains relationships with data source institutions (NASA, NOAA, etc.)
4. Provides legal and regulatory interface for the protocol
5. Funds ongoing protocol development through grants to contributors
6. Education and public communication about climate futures markets
7. On-chain veto over protocol changes (the third leg of tripartite governance)

**Foundation does NOT control:**
- User funds (held in smart contracts)
- Fee rates or market parameters (immutable or tripartite-governed)
- Token supply or distribution schedule (fixed at deployment)

**Foundation funding — hardcoded protocol fee split:**

| Recipient | Share of Protocol Fees | Purpose |
|-----------|----------------------|---------|
| veCLMT stakers | 60% | Yield for long-term token holders |
| Foundation | 25% | Operations, ED compensation, SAB stipends, development grants |
| Oracle Fund | 15% | Data provider bounties |

This split is hardcoded in the smart contracts at deployment. No single body can redirect fee flows — changing the split requires tripartite agreement.

### 5.3 Tripartite Governance Process

Any change to the protocol requires approval from **all three bodies**:

```
Proposal → veCLMT Vote → SAB Review → Foundation Board Approval → Execution
           (on-chain)    (on-chain     (on-chain multisig
                          multisig)     signature)
```

**Proposal lifecycle:**

1. **Proposal creation**: Any veCLMT holder with ≥100,000 veCLMT (0.1% of max supply) can submit a proposal on-chain.
2. **veCLMT voting period**: 14 days. Quorum: 10% of outstanding veCLMT. Approval: simple majority.
3. **SAB review period** (oracle-related proposals only): 14 days. SAB members signal approval or veto via multisig. 5-of-7 (or 5-of-9) must approve. For non-oracle proposals, this step is skipped.
4. **Foundation Board review**: 14 days. Foundation Board signals approval or veto via multisig. Simple majority of directors.
5. **Timelock**: 7 days after all approvals. During this window, any body can withdraw approval if new information emerges.
6. **Execution**: Automatic on-chain execution after timelock expires.

**Why this works for capture resistance:**

| Attack vector | Why it fails |
|--------------|-------------|
| Buy majority of CLMT | Still need SAB + Foundation approval. Time-weighting (ve-lock) means freshly-bought tokens have minimal voting power. |
| Compromise the SAB | Still need veCLMT + Foundation approval. SAB has staggered terms, so you'd need to wait years to replace a majority. |
| Compromise the Foundation | Still need veCLMT + SAB approval. Foundation Board is self-perpetuating with veCLMT confirmation, so hostile board replacement triggers token holder veto. |
| Compromise two of three | Extremely difficult: requires simultaneous capture of capital markets (veCLMT), scientific institutions (SAB), and a nonprofit board (Foundation) — three entirely different social structures. |

**Emergency actions:**

For genuine emergencies (critical bug, oracle failure, exploit in progress), the protocol includes a pause mechanism:
- Any 2-of-3 governing bodies can jointly trigger a pause (no proposal process needed)
- Pause halts trading and settlement but does not affect existing positions or collateral
- Unpausing requires full tripartite approval through the standard process
- This prevents emergencies from being used as pretexts for governance capture

### 5.4 Long-Term Sustainability

**Revenue Model (hardcoded at deployment):**
- Trading fees: 0.3% per AMM trade
- Issuance fees: 0.1% on minting position pairs
- Settlement fees: 0.5% on payouts at settlement
- Fee split: 60% veCLMT stakers / 25% Foundation / 15% Oracle Fund

**Why no general-purpose treasury:**
Following the Bitcoin/Ethereum principle of minimal governance, there is no discretionary treasury that could be raided. All fee revenue is deterministically split by the smart contracts. The Foundation's 25% share serves the operational functions that a treasury would, but it flows to a legally accountable nonprofit with fiduciary duties — not to an on-chain pool controlled by token votes alone.

**Continuity mechanisms:**
- **Foundation as institutional anchor**: The 501(c)(3) form has a multi-century track record. The Foundation provides continuity even if on-chain governance participation fluctuates.
- **Modular oracle**: Data sources can be added or removed (with tripartite approval) as scientific institutions evolve.
- **Fork-friendly design**: All contracts are open source with well-documented interfaces. If governance fails, the community can redeploy a competing instance — the ultimate exit right, as in Bitcoin/Ethereum.
- **Voter participation incentives**: Small USDC rewards for veCLMT holders who participate in governance votes, funded from the Foundation's share, to prevent governance dormancy between settlement events.

---

## 6. Economic Analysis

### 6.1 Market Pricing Dynamics

The price of a LONG position token directly encodes the market's implied temperature anomaly:

```
Implied anomaly = T_min + Price_long * (T_max - T_min)
                = 0.5 + Price_long * 3.5
```

| LONG Price | Implied Anomaly | Interpretation |
|-----------|----------------|---------------|
| 0.14 | +1.0°C | Below current warming — strong cooling expectation |
| 0.29 | +1.5°C | Paris Agreement target met |
| 0.43 | +2.0°C | Paris Agreement upper bound |
| 0.57 | +2.5°C | Moderate warming scenario |
| 0.71 | +3.0°C | Significant warming |
| 0.86 | +3.5°C | High warming scenario |
| 1.00 | +4.0°C | Worst-case scenario |

A rising LONG price over time signals that the market believes warming is accelerating relative to prior expectations. A falling LONG price signals optimism about mitigation efforts.

### 6.2 Who Participates

**Climate-aware investors**: Hedge climate-related portfolio risk. A pension fund exposed to climate-sensitive assets might buy LONG positions as insurance.

**Climate researchers**: Monetize superior predictive models. Researchers with better climate models can profit from positions that reflect their private information.

**Policy speculators**: Trade on beliefs about the effectiveness of climate policy (carbon taxes, renewable energy adoption, international agreements).

**Hedgers**: Entities with direct climate exposure (agriculture, insurance, real estate in flood zones) can hedge specific risks.

**Arbitrageurs**: Ensure market prices remain consistent across settlement years (the term structure should be monotonically increasing, all else equal).

### 6.3 Term Structure Information

The eight settlement dates produce a **term structure of implied warming** — analogous to a yield curve in fixed income. This term structure is itself enormously informative:

- **Shape**: A steep term structure (e.g., +1.8°C at 2030, +3.2°C at 2100) implies accelerating warming. A flat structure implies equilibrium.
- **Kinks**: Discontinuities in the term structure might reflect expected policy interventions (e.g., a kink at 2050 could reflect expected deployment of carbon capture technology).
- **Shifts**: Parallel shifts in the entire curve reflect new information about climate sensitivity. Rotations reflect changing expectations about the timing of warming.

### 6.4 Capital Requirements

For the proof of concept:

| Item | Cost (USDC) |
|------|-------------|
| AMM liquidity subsidy (8 markets × ~6,931) | ~55,450 |
| Oracle Fund (initial bounty pool) | 100,000 |
| Initial development and audit | Variable |
| **Total minimum** | **~155,450** |

---

## 7. Risk Analysis

### 7.1 Oracle Risk

**Risk**: Data sources may cease to exist, change methodology, or be compromised over the 74-year horizon.

**Mitigation**: Tripartite governance can add/remove oracle sources. The SAB veto ensures changes are scientifically sound. Median aggregation is robust to single-source failure. Minimum 5-source quorum ensures no single point of failure. The Foundation maintains ongoing relationships with data source institutions.

### 7.2 Smart Contract Risk

**Risk**: Bugs in smart contract code could result in loss of funds.

**Mitigation**: Contract upgrades require tripartite agreement. Proof-of-concept phase enables thorough testing before significant capital deployment. Formal verification of core payout logic. Emergency pause available with 2-of-3 governing body agreement.

### 7.3 Regulatory Risk

**Risk**: Prediction markets may face regulatory challenges in various jurisdictions.

**Mitigation**: The 501(c)(3) Foundation provides a legitimate legal interface for regulators. The protocol surfaces information of genuine public interest (climate forecasting), which strengthens the case for regulatory accommodation. The Foundation's charitable mission (climate data transparency) aligns with regulatory goals.

### 7.4 Liquidity Risk

**Risk**: Long-dated markets (2080-2100) may have insufficient liquidity to produce meaningful prices.

**Mitigation**: LMSR provides a price at all times regardless of liquidity. Foundation can fund liquidity subsidies from grants. Community liquidity mining incentives attract early participants.

### 7.5 Governance Capture Risk

**Risk**: A well-resourced adversary (industry, sovereign actor, large speculator) attempts to control the protocol to manipulate oracle outcomes or extract value.

**Mitigation**: Tripartite governance requires simultaneous capture of three independent structures — financial (veCLMT), scientific (SAB), and institutional (Foundation Board). Vote-escrowing prevents rapid accumulation of voting power. No discretionary treasury to raid. Fork-friendly design provides ultimate exit if governance fails.

### 7.6 Ethereum Platform Risk

**Risk**: Ethereum may undergo fundamental changes (consensus mechanism, state model, fee structure) over the protocol's lifetime.

**Mitigation**: Contract upgrades possible with tripartite approval. Core contract logic is relatively simple (arithmetic payout functions, median computation) and unlikely to be broken by platform changes. Fork-friendly design enables migration to a new platform if necessary.

---

## 8. Technical Architecture

### 8.1 Contract Structure

```
ClimateFuturesProtocol/
├── CLMTToken.sol              — ERC-20 governance token (fixed supply)
├── VotingEscrow.sol           — veCLMT lock and voting power (modeled on Curve)
├── TripartiteGovernor.sol     — Tripartite proposal/voting/approval/timelock
├── FeeDistributor.sol         — Hardcoded fee split (60/25/15)
├── TemperatureOracle.sol      — Oracle with bounty-based data source reporting
├── TemperatureMarketFactory.sol — Deploys new markets
├── TemperatureMarket.sol      — Core market logic (mint, redeem, settle)
├── ClimatePosition.sol        — ERC-1155 position tokens
└── ClimateAMM.sol             — LMSR automated market maker
```

### 8.2 On-Chain Representation of Governing Bodies

- **veCLMT holders**: Represented on-chain by the VotingEscrow contract. Voting power is computed from lock amount and remaining duration.
- **Science Advisory Board**: Represented on-chain by a Gnosis Safe multisig (5-of-7 or 5-of-9). The SAB multisig address is registered in the TripartiteGovernor. Changing the SAB multisig address requires tripartite approval.
- **Foundation Board**: Represented on-chain by a separate Gnosis Safe multisig (majority of directors). The Foundation multisig address is registered in the TripartiteGovernor. Changing this address also requires tripartite approval.

### 8.3 Upgrade Strategy

All stateful contracts use the UUPS (Universal Upgradeable Proxy Standard, EIP-1822) pattern:

- **Proxy**: Stores state, delegates calls to implementation.
- **Implementation**: Contains logic, can be replaced by tripartite vote.
- **Upgrade authorization**: Requires approval from all three governing bodies via the TripartiteGovernor.

### 8.4 Key Invariants

1. **Full collateralization**: For every LONG-SHORT pair in existence, exactly 1 USDC is held in the market contract.
2. **Payout conservation**: At settlement, total LONG payouts + total SHORT payouts = total collateral.
3. **Price bounds**: LMSR prices always satisfy `0 < Price_long < 1` and `Price_long + Price_short = 1`.
4. **Oracle integrity**: Settlement value is always the median of at least 5 independent data source submissions, and oracle changes require SAB approval.
5. **Fee determinism**: The 60/25/15 fee split is hardcoded and cannot be changed without tripartite agreement.
6. **Tripartite requirement**: No protocol change executes without approval from all three governing bodies.

---

## 9. Roadmap

### Phase 1: Proof of Concept (Current)
- Deploy smart contracts on Ethereum testnet (Sepolia)
- Create markets for 2030 and 2040 settlement dates
- Basic web interface for minting, trading, and viewing prices
- Simulated oracle submissions and tripartite governance flows

### Phase 2: Foundation Formation
- Incorporate Climate Futures Foundation as US 501(c)(3)
- Recruit initial Foundation Board of Directors
- Appoint Executive Director
- Recruit inaugural Science Advisory Board members
- Apply for climate foundation grants (Oracle Fund seeding)

### Phase 3: Testnet Validation
- Full suite of 8 markets (2030-2100)
- Deploy veCLMT and tripartite governance contracts
- Community testing and bug bounty program
- Formal verification of payout and oracle logic
- End-to-end governance simulation with all three bodies

### Phase 4: Mainnet Launch
- Security audit by reputable firm
- Mainnet deployment with conservative liquidity parameters
- CLMT token distribution event
- Oracle submitter onboarding with real institutional commitments
- Foundation begins data source relationship management

### Phase 5: Ecosystem Growth
- Integration with DeFi protocols (lending, insurance)
- Structured products built on CFP positions
- Academic partnerships for price analysis and research
- Foundation seeks additional grant funding for Oracle Fund sustainability

---

## 10. Conclusion

Climate Futures Protocol transforms climate forecasting from a purely academic exercise into a financially-incentivized information discovery mechanism. By creating transferable, tradeable positions on future temperature outcomes settled by consensus of scientific authorities, the protocol produces a continuously-updated market signal about the trajectory of global warming.

The linear payout structure ensures that market prices directly encode temperature expectations. The LMSR automated market maker guarantees liquidity at all times. The bounty-based oracle pays government and academic data providers for the data they already produce, without requiring them to participate in DeFi infrastructure. And the tripartite governance structure — veCLMT token holders, an independent Science Advisory Board, and the Climate Futures Foundation — provides the capture resistance and institutional continuity necessary for a protocol designed to operate for nearly a century.

The protocol draws its governance philosophy from the most durable systems available: Bitcoin's minimalism (govern only what must change), Ethereum's social-layer legitimacy (process over capital), and the nonprofit foundation form (centuries of institutional track record). The result is a system where no single interest — financial, political, or ideological — can corrupt the climate signal the market produces.

This is a new kind of climate instrument: not a derivative of emissions credits or weather events, but a direct forward contract on the planet's temperature trajectory — the most fundamental climate metric there is.

---

*Climate Futures Protocol is open-source software. This white paper describes a proof-of-concept system and does not constitute financial advice or a solicitation of investment.*
