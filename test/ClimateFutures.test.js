const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Climate Futures Protocol", function () {
  let deployer, alice, bob, submitter1, submitter2, submitter3, submitter4, submitter5, submitter6;
  let clmt, dao, usdc, position, oracle, factory;
  let market2030, amm2030;

  const YEAR = 2030;
  const USDC_UNIT = 1_000_000n; // 6 decimals
  const POSITION_UNIT = ethers.parseEther("1"); // 18 decimals

  // Data source IDs (keccak256 of source name for determinism)
  const SOURCE_IDS = {
    NASA_GISS: ethers.id("NASA_GISS"),
    NOAA: ethers.id("NOAA"),
    HADCRUT5: ethers.id("HADCRUT5"),
    BERKELEY: ethers.id("BERKELEY"),
    JMA: ethers.id("JMA"),
    ERA5: ethers.id("ERA5"),
  };

  before(async function () {
    [deployer, alice, bob, submitter1, submitter2, submitter3, submitter4, submitter5, submitter6] =
      await ethers.getSigners();
  });

  describe("Deployment", function () {
    it("should deploy all contracts", async function () {
      // CLMT Token
      const CLMTToken = await ethers.getContractFactory("CLMTToken");
      clmt = await CLMTToken.deploy(
        deployer.address, deployer.address, deployer.address,
        deployer.address, deployer.address
      );

      // DAO
      const ClimateDAO = await ethers.getContractFactory("ClimateDAO");
      dao = await ClimateDAO.deploy(await clmt.getAddress());

      // Mock USDC
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

      // Position tokens
      const ClimatePosition = await ethers.getContractFactory("ClimatePosition");
      position = await ClimatePosition.deploy();

      // Oracle (now takes USDC for bounties, not CLMT for staking)
      const TemperatureOracle = await ethers.getContractFactory("TemperatureOracle");
      oracle = await TemperatureOracle.deploy(await usdc.getAddress(), deployer.address);

      // Factory
      const Factory = await ethers.getContractFactory("TemperatureMarketFactory");
      factory = await Factory.deploy(
        await usdc.getAddress(),
        await position.getAddress(),
        await oracle.getAddress(),
        deployer.address
      );

      // Grant factory admin on position tokens
      await position.grantRole(await position.DEFAULT_ADMIN_ROLE(), await factory.getAddress());
    });

    it("should create a market for 2030", async function () {
      await factory.createMarket(YEAR);
      const [marketAddr, ammAddr] = await factory.getMarket(YEAR);

      expect(marketAddr).to.not.equal(ethers.ZeroAddress);
      expect(ammAddr).to.not.equal(ethers.ZeroAddress);

      market2030 = await ethers.getContractAt("TemperatureMarket", marketAddr);
      amm2030 = await ethers.getContractAt("ClimateAMM", ammAddr);
    });

    it("should reject duplicate market creation", async function () {
      await expect(factory.createMarket(YEAR)).to.be.revertedWith("Market exists");
    });

    it("should reject invalid settlement years", async function () {
      await expect(factory.createMarket(2025)).to.be.revertedWith("Invalid year");
      await expect(factory.createMarket(2035)).to.be.revertedWith("Must be decade boundary");
    });
  });

  describe("CLMT Token", function () {
    it("should have correct total supply", async function () {
      const totalSupply = await clmt.totalSupply();
      expect(totalSupply).to.equal(ethers.parseEther("100000000"));
    });

    it("should support ERC20Votes delegation", async function () {
      await clmt.delegate(deployer.address);
      const votes = await clmt.getVotes(deployer.address);
      expect(votes).to.equal(await clmt.balanceOf(deployer.address));
    });
  });

  describe("Position Minting and Redemption", function () {
    it("should mint LONG/SHORT pairs when depositing USDC", async function () {
      const depositAmount = 1000n * USDC_UNIT; // 1000 USDC
      await usdc.mint(alice.address, depositAmount);
      await usdc.connect(alice).approve(await market2030.getAddress(), depositAmount);

      await market2030.connect(alice).mint(depositAmount);

      const longId = await position.longTokenId(YEAR);
      const shortId = await position.shortTokenId(YEAR);

      const longBalance = await position.balanceOf(alice.address, longId);
      const shortBalance = await position.balanceOf(alice.address, shortId);

      // After 0.1% issuance fee, net = 999 USDC worth of positions
      const expectedPositions = 999n * POSITION_UNIT;
      expect(longBalance).to.equal(expectedPositions);
      expect(shortBalance).to.equal(expectedPositions);
    });

    it("should redeem LONG/SHORT pairs back to USDC", async function () {
      const redeemAmount = 100n * POSITION_UNIT;

      const balanceBefore = await usdc.balanceOf(alice.address);
      await market2030.connect(alice).redeem(redeemAmount);
      const balanceAfter = await usdc.balanceOf(alice.address);

      // 100 position units => 100 USDC collateral, minus 0.1% redemption fee
      const expectedReturn = 100n * USDC_UNIT - (100n * USDC_UNIT * 10n / 10000n);
      expect(balanceAfter - balanceBefore).to.equal(expectedReturn);
    });
  });

  describe("Oracle — Data Sources and Submitters", function () {
    it("should register data sources", async function () {
      await oracle.addDataSource(SOURCE_IDS.NASA_GISS, "NASA GISS", "GISTEMP v4, 1850-1900 baseline");
      await oracle.addDataSource(SOURCE_IDS.NOAA, "NOAA NCEI", "NOAAGlobalTemp v5");
      await oracle.addDataSource(SOURCE_IDS.HADCRUT5, "HadCRUT5", "UK Met Office / CRU");
      await oracle.addDataSource(SOURCE_IDS.BERKELEY, "Berkeley Earth", "BEST, 1850-1900 baseline");
      await oracle.addDataSource(SOURCE_IDS.JMA, "JMA", "Japan Meteorological Agency");
      await oracle.addDataSource(SOURCE_IDS.ERA5, "ERA5", "Copernicus/ECMWF reanalysis");

      expect(await oracle.activeSourceCount()).to.equal(6);
    });

    it("should reject duplicate data sources", async function () {
      await expect(
        oracle.addDataSource(SOURCE_IDS.NASA_GISS, "Duplicate", "")
      ).to.be.revertedWith("Source exists");
    });

    it("should authorise designated submitters", async function () {
      const sourceKeys = Object.keys(SOURCE_IDS);
      const submitterAddrs = [submitter1, submitter2, submitter3, submitter4, submitter5, submitter6];

      for (let i = 0; i < submitterAddrs.length; i++) {
        await oracle.authoriseSubmitter(submitterAddrs[i].address, SOURCE_IDS[sourceKeys[i]]);
      }

      const info = await oracle.submitters(submitter1.address);
      expect(info.isAuthorised).to.be.true;
      expect(info.sourceId).to.equal(SOURCE_IDS.NASA_GISS);
    });

    it("should reject unauthorised submitters", async function () {
      await expect(
        oracle.connect(alice).submitReport(YEAR, 1450)
      ).to.be.reverted; // either "Reporting not open" or "Not authorised"
    });
  });

  describe("Oracle — Reporting and Settlement", function () {
    before(async function () {
      // Fund the oracle with USDC for bounties
      const fundAmount = 100_000n * USDC_UNIT;
      await usdc.mint(deployer.address, fundAmount);
      await usdc.approve(await oracle.getAddress(), fundAmount);
      await oracle.fundOracle(fundAmount);
    });

    it("should open reporting window", async function () {
      await oracle.openReporting(YEAR);
      const settlement = await oracle.settlements(YEAR);
      expect(settlement.status).to.equal(1); // ReportingOpen
    });

    it("should accept reports from authorised submitters", async function () {
      // Simulated anomaly values in millidegrees (e.g., 1450 = +1.45°C)
      const values = [1450, 1460, 1440, 1470, 1445, 1455];
      const submitterAddrs = [submitter1, submitter2, submitter3, submitter4, submitter5, submitter6];

      for (let i = 0; i < submitterAddrs.length; i++) {
        await oracle.connect(submitterAddrs[i]).submitReport(YEAR, values[i]);
      }

      const settlement = await oracle.settlements(YEAR);
      expect(settlement.sourceReportCount).to.equal(6);
    });

    it("should reject duplicate reports for the same source", async function () {
      await expect(
        oracle.connect(submitter1).submitReport(YEAR, 1450)
      ).to.be.revertedWith("Source already reported");
    });

    it("should aggregate to median after window closes", async function () {
      await time.increase(61 * 24 * 60 * 60); // 61 days

      await oracle.aggregate(YEAR);
      const settlement = await oracle.settlements(YEAR);
      expect(settlement.status).to.equal(2); // Aggregated

      // Median of [1440, 1445, 1450, 1455, 1460, 1470] = (1450+1455)/2 = 1452
      expect(settlement.aggregatedValue).to.equal(1452);
    });

    it("should finalize after dispute window", async function () {
      await time.increase(31 * 24 * 60 * 60); // 31 days

      await oracle.finalize(YEAR);
      const settlement = await oracle.settlements(YEAR);
      expect(settlement.status).to.equal(4); // Finalized

      const value = await oracle.getSettlementValue(YEAR);
      expect(value).to.equal(1452);
    });

    it("should distribute bounties to consensus-aligned submitters", async function () {
      // All six submitted within ±0.1°C of median (1452), so all should be paid
      // Max deviation: |1470 - 1452| = 18 millidegrees = 0.018°C < 0.1°C threshold

      const balanceBefore = await usdc.balanceOf(submitter1.address);
      await oracle.distributeBounties(YEAR);
      const balanceAfter = await usdc.balanceOf(submitter1.address);

      // submitter1 was the first to submit, so gets bounty + early bonus
      const expectedPayout = 5_000n * USDC_UNIT + 1_000n * USDC_UNIT; // 6,000 USDC
      expect(balanceAfter - balanceBefore).to.equal(expectedPayout);

      // Other submitters get base bounty only
      const balance2 = await usdc.balanceOf(submitter2.address);
      expect(balance2).to.equal(5_000n * USDC_UNIT);
    });
  });

  describe("Oracle — Dispute Resolution", function () {
    let disputeYear;

    before(async function () {
      disputeYear = 2040;

      // Register sources for this year's test (reuse existing sources)
      await oracle.openReporting(disputeYear);

      const values = [2100, 2110, 2090, 2120, 2095, 2105];
      const submitterAddrs = [submitter1, submitter2, submitter3, submitter4, submitter5, submitter6];
      for (let i = 0; i < submitterAddrs.length; i++) {
        await oracle.connect(submitterAddrs[i]).submitReport(disputeYear, values[i]);
      }

      await time.increase(61 * 24 * 60 * 60);
      await oracle.aggregate(disputeYear);
    });

    it("should allow raising a dispute with a bond", async function () {
      const bond = await oracle.disputeBond();
      await usdc.mint(alice.address, bond);
      await usdc.connect(alice).approve(await oracle.getAddress(), bond);

      await oracle.connect(alice).raiseDispute(disputeYear, 2150);

      const settlement = await oracle.settlements(disputeYear);
      expect(settlement.status).to.equal(3); // Disputed
    });

    it("should resolve dispute (upheld) and return bond + reward", async function () {
      const balanceBefore = await usdc.balanceOf(alice.address);
      await oracle.resolveDispute(disputeYear, true);
      const balanceAfter = await usdc.balanceOf(alice.address);

      const bond = await oracle.disputeBond();
      const reward = await oracle.disputeReward();
      expect(balanceAfter - balanceBefore).to.equal(bond + reward);

      const value = await oracle.getSettlementValue(disputeYear);
      expect(value).to.equal(2150); // Overridden to disputed value
    });
  });

  describe("Settlement", function () {
    it("should settle the market based on oracle value", async function () {
      await market2030.settle();
      expect(await market2030.settled()).to.be.true;

      const longPayout = await market2030.longPayoutPerUnit();
      // T = 1452 millidegrees, T_MIN = 500, T_RANGE = 3500
      // payout = (1452 - 500) * 1e6 / 3500 = 952 * 1e6 / 3500 = 272000
      expect(longPayout).to.equal(272000n);
    });

    it("should allow claiming settlement payouts", async function () {
      const longId = await position.longTokenId(YEAR);
      const shortId = await position.shortTokenId(YEAR);

      const longBalance = await position.balanceOf(alice.address, longId);
      const shortBalance = await position.balanceOf(alice.address, shortId);

      await position.connect(alice).setApprovalForAll(await market2030.getAddress(), true);

      const usdcBefore = await usdc.balanceOf(alice.address);
      await market2030.connect(alice).claim(longBalance, shortBalance);
      const usdcAfter = await usdc.balanceOf(alice.address);

      expect(usdcAfter).to.be.gt(usdcBefore);
    });
  });

  describe("DAO Governance", function () {
    it("should create a proposal", async function () {
      await clmt.delegate(deployer.address);

      const setFeeData = market2030.interface.encodeFunctionData("setFees", [20, 20, 100]);

      await dao.propose(
        0, // Standard
        "Adjust market fees",
        [await market2030.getAddress()],
        [0],
        [setFeeData]
      );

      const state = await dao.getProposalState(1);
      expect(state).to.equal(0); // Active
    });

    it("should allow voting", async function () {
      await dao.vote(1, true);
      const [forVotes, againstVotes] = await dao.getProposalVotes(1);
      expect(forVotes).to.be.gt(0);
      expect(againstVotes).to.equal(0);
    });

    it("should queue after voting period", async function () {
      await time.increase(8 * 24 * 60 * 60); // 8 days
      await dao.queue(1);
      const state = await dao.getProposalState(1);
      expect(state).to.equal(3); // Queued
    });

    it("should allow emergency veto", async function () {
      const setFeeData = market2030.interface.encodeFunctionData("setFees", [500, 500, 500]);
      await dao.propose(
        1, // Emergency
        "Malicious fee increase",
        [await market2030.getAddress()],
        [0],
        [setFeeData]
      );

      await dao.veto(2);
      const state = await dao.getProposalState(2);
      expect(state).to.equal(5); // Vetoed
    });
  });

  describe("AMM", function () {
    let market2050, amm2050;

    before(async function () {
      // Create a fresh market for AMM tests (2040 used by dispute test)
      await factory.createMarket(2050);
      const [marketAddr, ammAddr] = await factory.getMarket(2050);
      market2050 = await ethers.getContractAt("TemperatureMarket", marketAddr);
      amm2050 = await ethers.getContractAt("ClimateAMM", ammAddr);

      // Mint positions and seed the AMM
      const seedAmount = 50000n * USDC_UNIT;
      await usdc.mint(deployer.address, seedAmount);
      await usdc.approve(await market2050.getAddress(), seedAmount);
      await market2050.mint(seedAmount);

      // Transfer position tokens to AMM for inventory
      const longId = await position.longTokenId(2050);
      const shortId = await position.shortTokenId(2050);
      const posAmount = await position.balanceOf(deployer.address, longId);

      await position.safeTransferFrom(deployer.address, await amm2050.getAddress(), longId, posAmount, "0x");
      await position.safeTransferFrom(deployer.address, await amm2050.getAddress(), shortId, posAmount, "0x");

      // Fund AMM with collateral for payouts
      const fundAmount = 10000n * USDC_UNIT;
      await usdc.mint(deployer.address, fundAmount);
      await usdc.approve(await amm2050.getAddress(), fundAmount);
      await amm2050.fund(fundAmount);
    });

    it("should start with equal prices", async function () {
      const longP = await amm2050.longPrice();
      const shortP = await amm2050.shortPrice();

      const halfUnit = POSITION_UNIT / 2n;
      const tolerance = POSITION_UNIT / 100n; // 1% tolerance

      expect(longP).to.be.closeTo(halfUnit, tolerance);
      expect(shortP).to.be.closeTo(halfUnit, tolerance);
    });

    it("should provide buy quotes", async function () {
      const buyAmount = 100n * POSITION_UNIT;
      const cost = await amm2050.quoteBuy(true, buyAmount);
      expect(cost).to.be.gt(0);
    });

    it("should execute a buy trade", async function () {
      const buyAmount = 100n * POSITION_UNIT;
      const cost = await amm2050.quoteBuy(true, buyAmount);

      await usdc.mint(bob.address, cost);
      await usdc.connect(bob).approve(await amm2050.getAddress(), cost);
      await amm2050.connect(bob).buy(true, buyAmount);

      const longId = await position.longTokenId(2050);
      const balance = await position.balanceOf(bob.address, longId);
      expect(balance).to.equal(buyAmount);
    });

    it("should shift prices after a trade", async function () {
      const longP = await amm2050.longPrice();
      const shortP = await amm2050.shortPrice();

      expect(longP).to.be.gt(POSITION_UNIT / 2n);
      expect(shortP).to.be.lt(POSITION_UNIT / 2n);
    });

    it("should report implied anomaly", async function () {
      const anomaly = await amm2050.impliedAnomaly();
      // Should be > midpoint (2250) since we bought LONG
      expect(anomaly).to.be.gt(2250);
    });

    it("should execute a sell trade", async function () {
      const sellAmount = 50n * POSITION_UNIT;

      await position.connect(bob).setApprovalForAll(await amm2050.getAddress(), true);

      const balanceBefore = await usdc.balanceOf(bob.address);
      await amm2050.connect(bob).sell(true, sellAmount);
      const balanceAfter = await usdc.balanceOf(bob.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
});
