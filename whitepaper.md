# Climate Futures Protocol: A Decentralized Forward Market for Global Temperature Forecasting

**Version 1.0 — July 2026**

---

## Abstract

Climate Futures Protocol (CFP) is a decentralized prediction market built on Ethereum that creates forward contracts settling on observed global mean temperature anomaly at decade boundaries from 2030 through 2100. By enabling participants to take financially-backed positions on future climate outcomes, the protocol surfaces distributed information about climate trajectories and creates real price signals for climate risk. Settlement is determined by the median of at least five globally recognized scientific authorities. The protocol is governed by a decentralized autonomous organization (DAO) funded by trading, issuance, and settlement fees, ensuring long-term sustainability across a multi-decade operating horizon.

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
- **Submission bounty**: 5,000 USDC per valid, consensus-aligned submission (adjustable by DAO).
- **Early bonus**: 1,000 USDC additional for the first valid submission in a reporting window (incentivizes timeliness).
- **Consensus requirement**: Only submissions within ±0.1°C of the final median are eligible for bounty. Outliers receive nothing but are not penalised — they simply aren't paid. This is sufficient incentive alignment because submitters are reading publicly-verifiable scientific data, not making subjective judgments.

**Why this works**: The data these institutions publish is already public and verifiable. A submitter who fabricates a value gains nothing (they'll be outside the consensus band and won't get paid) and risks losing their DAO-approved submitter status. The cost of honest reporting is near zero (read a published number, submit a transaction), while the reward is meaningful — especially for graduate students, postdocs, or small research groups who can serve as designated submitters.

**Estimated annual oracle cost**: At 8 settlement events with 6 sources each, the maximum annual bounty outflow is approximately 8 × 6 × 6,000 = 288,000 USDC. In practice, only one settlement event occurs per decade, so steady-state costs are ~36,000 USDC per settlement event — easily sustainable from protocol fee revenue.

### 4.5 Dispute Resolution

During the 30-day dispute period after oracle aggregation:

1. Any participant can raise a dispute by depositing a 10,000 USDC bond.
2. The DAO votes on the dispute (simple majority of participating votes, minimum 10% quorum).
3. If the dispute is upheld, the DAO can submit a corrected value and the disputer's bond is returned plus a 5,000 USDC reward from the Oracle Fund.
4. If the dispute is rejected, the disputer's bond is forfeited to the DAO treasury.

The dispute bond is denominated in USDC (not CLMT) so that anyone with a financial stake in the market — not just governance token holders — can challenge a suspicious oracle result. This widens the set of watchdogs and makes the system more robust.

---

## 5. Governance: The Climate DAO

### 5.1 CLMT Token

**CLMT** is the governance and utility token of the Climate Futures Protocol.

**Token Utility:**
1. **Governance voting**: 1 CLMT = 1 vote on DAO proposals.
2. **Oracle governance**: DAO votes to approve data sources, authorise submitters, and set bounty levels.
3. **Fee sharing**: CLMT stakers receive a share of protocol fee revenue (distributed in USDC).
4. **Treasury governance**: CLMT holders govern the DAO treasury, including Oracle Fund allocations and grant acceptance.

**Initial Distribution (Total Supply: 100,000,000 CLMT):**

| Allocation | Percentage | Tokens | Vesting |
|-----------|-----------|--------|---------|
| DAO Treasury | 40% | 40,000,000 | Governed by DAO proposals |
| Protocol Development | 20% | 20,000,000 | 4-year linear vesting |
| Community / Liquidity Mining | 25% | 25,000,000 | Distributed over 10 years |
| Initial Contributors | 10% | 10,000,000 | 2-year linear vesting, 6-month cliff |
| Oracle Fund Seeding | 5% | 5,000,000 | Sold by DAO to fund USDC bounties |

**No additional minting**: The total supply is fixed at 100,000,000. The DAO cannot inflate the supply.

### 5.2 Governance Scope

The DAO governs:

1. **Oracle management**: Add/remove data sources, authorise/revoke submitters, set bounty levels, fund the Oracle Fund.
2. **Market parameters**: Adjust fee rates, AMM liquidity parameter, anomaly range bounds.
3. **Treasury management**: Allocate treasury funds for liquidity subsidies, grants, development.
4. **Contract upgrades**: Approve upgrades to protocol contracts via proxy pattern.
5. **Emergency actions**: Pause markets, override oracle values in case of clear error.
6. **New market creation**: Deploy markets for additional settlement years if desired.

### 5.3 Proposal Lifecycle

1. **Proposal creation**: Requires holding at least 100,000 CLMT (0.1% of supply).
2. **Voting period**: 7 days for standard proposals, 3 days for emergency proposals.
3. **Quorum**: 10% of circulating supply must participate for standard proposals; 5% for emergency proposals.
4. **Approval threshold**: Simple majority (>50%) for standard; supermajority (>66%) for emergency and contract upgrades.
5. **Timelock**: 48 hours for standard proposals; 24 hours for emergency proposals. During the timelock, the DAO multisig can veto clearly malicious proposals.
6. **Execution**: Automatic on-chain execution after timelock expires.

### 5.4 Long-Term Sustainability

The 74-year operating horizon requires special consideration:

**Revenue Model:**
- Trading fees (0.3% per AMM trade) provide ongoing revenue proportional to market activity.
- Issuance fees (0.1% on minting position pairs) generate revenue from new market participation.
- Settlement fees (0.5% on payouts) generate revenue at each settlement event.
- Treasury investment: The DAO may invest treasury assets in low-risk DeFi yield strategies to grow the treasury between settlement events.

**Continuity Mechanisms:**
- **Proxy upgradability**: All core contracts use the UUPS proxy pattern, allowing the DAO to upgrade implementation logic while preserving state.
- **Modular oracle**: Data sources can be added or removed as scientific institutions evolve over decades.
- **Progressive decentralization**: Initial multisig oversight transitions to full DAO control as the protocol matures and governance participation grows.
- **Emergency multisig**: A 4-of-7 multisig (elected by DAO vote, rotated annually) can pause contracts in emergencies. It cannot withdraw funds or change parameters — only pause.

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

**Mitigation**: DAO can add/remove oracle sources. Median aggregation is robust to single-source failure. Minimum 5-source quorum ensures no single point of failure.

### 7.2 Smart Contract Risk

**Risk**: Bugs in smart contract code could result in loss of funds.

**Mitigation**: Proxy upgradability allows bug fixes. Proof-of-concept phase enables thorough testing before significant capital deployment. Formal verification of core payout logic.

### 7.3 Regulatory Risk

**Risk**: Prediction markets may face regulatory challenges in various jurisdictions.

**Mitigation**: Decentralized, permissionless architecture reduces single points of regulatory failure. The protocol surfaces information of genuine public interest (climate forecasting), which strengthens the case for regulatory accommodation.

### 7.4 Liquidity Risk

**Risk**: Long-dated markets (2080-2100) may have insufficient liquidity to produce meaningful prices.

**Mitigation**: LMSR provides a price at all times regardless of liquidity. DAO treasury can subsidize liquidity for less-active markets. Liquidity mining incentives can attract early participants.

### 7.5 Ethereum Platform Risk

**Risk**: Ethereum may undergo fundamental changes (consensus mechanism, state model, fee structure) over the protocol's lifetime.

**Mitigation**: UUPS proxy pattern allows adaptation. Core contract logic is relatively simple (arithmetic payout functions, median computation) and unlikely to be broken by platform changes. The DAO can migrate to a new platform in extremis.

---

## 8. Technical Architecture

### 8.1 Contract Structure

```
ClimateFuturesProtocol/
├── CLMTToken.sol              — ERC-20 governance token
├── ClimateDAO.sol             — Governance (proposals, voting, timelock)
├── TemperatureOracle.sol      — Oracle with bounty-based data source reporting
├── TemperatureMarketFactory.sol — Deploys new markets
├── TemperatureMarket.sol      — Core market logic (mint, redeem, settle)
├── ClimatePosition.sol        — ERC-1155 position tokens
└── ClimateAMM.sol             — LMSR automated market maker
```

### 8.2 Upgrade Strategy

All stateful contracts use the UUPS (Universal Upgradeable Proxy Standard, EIP-1822) pattern:

- **Proxy**: Stores state, delegates calls to implementation.
- **Implementation**: Contains logic, can be replaced by DAO vote.
- **Upgrade authorization**: Only the DAO timelock can authorize upgrades.

### 8.3 Key Invariants

1. **Full collateralization**: For every LONG-SHORT pair in existence, exactly 1 USDC is held in the market contract.
2. **Payout conservation**: At settlement, total LONG payouts + total SHORT payouts = total collateral.
3. **Price bounds**: LMSR prices always satisfy `0 < Price_long < 1` and `Price_long + Price_short = 1`.
4. **Oracle integrity**: Settlement value is always the median of at least 5 independent data source submissions, reported by DAO-authorised submitters and verified by consensus.

---

## 9. Roadmap

### Phase 1: Proof of Concept (Current)
- Deploy contracts on Ethereum testnet (Sepolia)
- Create markets for 2030 and 2040 settlement dates
- Basic web interface for minting, trading, and viewing prices
- Simulated oracle submissions

### Phase 2: Testnet Validation
- Full suite of 8 markets (2030-2100)
- Community testing and bug bounty program
- Formal verification of payout and oracle logic
- Governance simulation

### Phase 3: Mainnet Launch
- Security audit by reputable firm
- Mainnet deployment with conservative liquidity parameters
- CLMT token distribution event
- Oracle reporter onboarding with real institutional commitments

### Phase 4: Ecosystem Growth
- Integration with DeFi protocols (lending, insurance)
- Structured products built on CFP positions
- Cross-chain bridges for broader accessibility
- Academic partnerships for price analysis and research

---

## 10. Conclusion

Climate Futures Protocol transforms climate forecasting from a purely academic exercise into a financially-incentivized information discovery mechanism. By creating transferable, tradeable positions on future temperature outcomes settled by consensus of scientific authorities, the protocol produces a continuously-updated market signal about the trajectory of global warming.

The linear payout structure ensures that market prices directly encode temperature expectations. The LMSR automated market maker guarantees liquidity at all times. The multi-source oracle with staking and dispute resolution ensures settlement integrity. And the DAO governance structure provides the adaptability necessary for a protocol designed to operate for nearly a century.

The result is a new kind of climate instrument: not a derivative of emissions credits or weather events, but a direct forward contract on the planet's temperature trajectory — the most fundamental climate metric there is.

---

*Climate Futures Protocol is open-source software. This white paper describes a proof-of-concept system and does not constitute financial advice or a solicitation of investment.*
