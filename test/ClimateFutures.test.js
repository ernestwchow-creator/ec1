const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Climate Futures Protocol", function () {
  let deployer, alice, bob, reporter1, reporter2, reporter3, reporter4, reporter5, reporter6;
  let clmt, dao, usdc, position, oracle, factory;
  let market2030, amm2030;

  const YEAR = 2030;
  const USDC_UNIT = 1_000_000n; // 6 decimals
  const POSITION_UNIT = ethers.parseEther("1"); // 18 decimals
  const MIN_STAKE = ethers.parseEther("100000");

  before(async function () {
    [deployer, alice, bob, reporter1, reporter2, reporter3, reporter4, reporter5, reporter6] =
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

      // Oracle
      const TemperatureOracle = await ethers.getContractFactory("TemperatureOracle");
      oracle = await TemperatureOracle.deploy(await clmt.getAddress(), deployer.address);

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
      // 999 * 1e6 collateral => 999 * 1e18 position tokens (scaled up by 1e12)
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

  describe("Oracle", function () {
    before(async function () {
      // Set up reporters
      const reporters = [reporter1, reporter2, reporter3, reporter4, reporter5, reporter6];
      for (const r of reporters) {
        await oracle.addReporter(r.address);
        await clmt.transfer(r.address, MIN_STAKE);
        await clmt.connect(r).approve(await oracle.getAddress(), MIN_STAKE);
        await oracle.connect(r).stake(MIN_STAKE);
      }
    });

    it("should open reporting window", async function () {
      await oracle.openReporting(YEAR);
      const settlement = await oracle.settlements(YEAR);
      expect(settlement.status).to.equal(1); // ReportingOpen
    });

    it("should accept reports from staked reporters", async function () {
      // Simulated anomaly values in millidegrees (e.g., 1450 = +1.45°C)
      const values = [1450, 1460, 1440, 1470, 1445, 1455];
      const reporters = [reporter1, reporter2, reporter3, reporter4, reporter5, reporter6];

      for (let i = 0; i < reporters.length; i++) {
        await oracle.connect(reporters[i]).submitReport(YEAR, values[i]);
      }

      const settlement = await oracle.settlements(YEAR);
      expect(settlement.reportCount).to.equal(6);
    });

    it("should reject duplicate reports", async function () {
      await expect(
        oracle.connect(reporter1).submitReport(YEAR, 1450)
      ).to.be.revertedWith("Already reported");
    });

    it("should aggregate to median after window closes", async function () {
      // Fast forward past the reporting window
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
  });

  describe("Settlement", function () {
    it("should settle the market based on oracle value", async function () {
      await market2030.settle();
      expect(await market2030.settled()).to.be.true;

      const longPayout = await market2030.longPayoutPerUnit();
      // T = 1452 millidegrees, T_MIN = 500, T_RANGE = 3500
      // payout = (1452 - 500) * 1e6 / 3500 = 952 * 1e6 / 3500 = 272000
      // (integer division)
      expect(longPayout).to.equal(272000n);
    });

    it("should allow claiming settlement payouts", async function () {
      const longId = await position.longTokenId(YEAR);
      const shortId = await position.shortTokenId(YEAR);

      const longBalance = await position.balanceOf(alice.address, longId);
      const shortBalance = await position.balanceOf(alice.address, shortId);

      // Approve the market to burn positions
      await position.connect(alice).setApprovalForAll(await market2030.getAddress(), true);

      const usdcBefore = await usdc.balanceOf(alice.address);
      await market2030.connect(alice).claim(longBalance, shortBalance);
      const usdcAfter = await usdc.balanceOf(alice.address);

      // Should receive something back (exact amount depends on payout ratios and fees)
      expect(usdcAfter).to.be.gt(usdcBefore);
    });
  });

  describe("DAO Governance", function () {
    it("should create a proposal", async function () {
      await clmt.delegate(deployer.address);

      // Propose changing the trading fee
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
    let market2040, amm2040;

    before(async function () {
      // Create a fresh market for AMM tests
      await factory.createMarket(2040);
      const [marketAddr, ammAddr] = await factory.getMarket(2040);
      market2040 = await ethers.getContractAt("TemperatureMarket", marketAddr);
      amm2040 = await ethers.getContractAt("ClimateAMM", ammAddr);

      // Mint positions and seed the AMM
      const seedAmount = 50000n * USDC_UNIT;
      await usdc.mint(deployer.address, seedAmount);
      await usdc.approve(await market2040.getAddress(), seedAmount);
      await market2040.mint(seedAmount);

      // Transfer position tokens to AMM for inventory
      const longId = await position.longTokenId(2040);
      const shortId = await position.shortTokenId(2040);
      const posAmount = await position.balanceOf(deployer.address, longId);

      await position.safeTransferFrom(deployer.address, await amm2040.getAddress(), longId, posAmount, "0x");
      await position.safeTransferFrom(deployer.address, await amm2040.getAddress(), shortId, posAmount, "0x");

      // Fund AMM with collateral for payouts
      const fundAmount = 10000n * USDC_UNIT;
      await usdc.mint(deployer.address, fundAmount);
      await usdc.approve(await amm2040.getAddress(), fundAmount);
      await amm2040.fund(fundAmount);
    });

    it("should start with equal prices", async function () {
      const longP = await amm2040.longPrice();
      const shortP = await amm2040.shortPrice();

      // At q_long = q_short = 0, both prices should be 0.5
      const halfUnit = POSITION_UNIT / 2n;
      const tolerance = POSITION_UNIT / 100n; // 1% tolerance

      expect(longP).to.be.closeTo(halfUnit, tolerance);
      expect(shortP).to.be.closeTo(halfUnit, tolerance);
    });

    it("should provide buy quotes", async function () {
      const buyAmount = 100n * POSITION_UNIT;
      const cost = await amm2040.quoteBuy(true, buyAmount);
      expect(cost).to.be.gt(0);
    });

    it("should execute a buy trade", async function () {
      const buyAmount = 100n * POSITION_UNIT;
      const cost = await amm2040.quoteBuy(true, buyAmount);

      await usdc.mint(bob.address, cost);
      await usdc.connect(bob).approve(await amm2040.getAddress(), cost);
      await amm2040.connect(bob).buy(true, buyAmount);

      const longId = await position.longTokenId(2040);
      const balance = await position.balanceOf(bob.address, longId);
      expect(balance).to.equal(buyAmount);
    });

    it("should shift prices after a trade", async function () {
      const longP = await amm2040.longPrice();
      const shortP = await amm2040.shortPrice();

      // After buying LONG, long price should be > 0.5
      expect(longP).to.be.gt(POSITION_UNIT / 2n);
      // Short price should be < 0.5
      expect(shortP).to.be.lt(POSITION_UNIT / 2n);
    });

    it("should report implied anomaly", async function () {
      const anomaly = await amm2040.impliedAnomaly();
      // Should be > midpoint (2250) since we bought LONG
      expect(anomaly).to.be.gt(2250);
    });

    it("should execute a sell trade", async function () {
      const sellAmount = 50n * POSITION_UNIT;
      const longId = await position.longTokenId(2040);

      await position.connect(bob).setApprovalForAll(await amm2040.getAddress(), true);

      const balanceBefore = await usdc.balanceOf(bob.address);
      await amm2040.connect(bob).sell(true, sellAmount);
      const balanceAfter = await usdc.balanceOf(bob.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
});
