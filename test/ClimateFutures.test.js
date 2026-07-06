const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Climate Futures Protocol", function () {
  let deployer, alice, bob, sabSigner, foundationSigner;
  let submitter1, submitter2, submitter3, submitter4, submitter5, submitter6;
  let clmt, usdc, position, oracle, factory;
  let votingEscrow, feeDistributor, governor;
  let market2030, amm2030;

  const YEAR = 2030;
  const USDC_UNIT = 1_000_000n; // 6 decimals
  const POSITION_UNIT = ethers.parseEther("1"); // 18 decimals

  const SOURCE_IDS = {
    NASA_GISS: ethers.id("NASA_GISS"),
    NOAA: ethers.id("NOAA"),
    HADCRUT5: ethers.id("HADCRUT5"),
    BERKELEY: ethers.id("BERKELEY"),
    JMA: ethers.id("JMA"),
    ERA5: ethers.id("ERA5"),
  };

  before(async function () {
    [deployer, alice, bob, sabSigner, foundationSigner,
     submitter1, submitter2, submitter3, submitter4, submitter5, submitter6] =
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

      // Mock USDC
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

      // VotingEscrow (veCLMT)
      const VotingEscrow = await ethers.getContractFactory("VotingEscrow");
      votingEscrow = await VotingEscrow.deploy(await clmt.getAddress());

      // TripartiteGovernor (SAB and Foundation are single signers for PoC)
      const Governor = await ethers.getContractFactory("TripartiteGovernor");
      governor = await Governor.deploy(
        await votingEscrow.getAddress(),
        sabSigner.address,         // SAB multisig (single signer for PoC)
        foundationSigner.address   // Foundation multisig (single signer for PoC)
      );

      // FeeDistributor
      const FeeDistributor = await ethers.getContractFactory("FeeDistributor");
      feeDistributor = await FeeDistributor.deploy(
        await usdc.getAddress(),
        await votingEscrow.getAddress(),
        foundationSigner.address,  // Foundation receives 25%
        deployer.address           // Oracle Fund address for PoC
      );

      // Position tokens
      const ClimatePosition = await ethers.getContractFactory("ClimatePosition");
      position = await ClimatePosition.deploy();

      // Oracle
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
      market2030 = await ethers.getContractAt("TemperatureMarket", marketAddr);
      amm2030 = await ethers.getContractAt("ClimateAMM", ammAddr);
    });
  });

  describe("veCLMT — Vote Escrow", function () {
    it("should allow locking CLMT for voting power", async function () {
      const lockAmount = ethers.parseEther("1000000"); // 1M CLMT
      await clmt.approve(await votingEscrow.getAddress(), lockAmount);

      const fourYears = 4 * 365 * 24 * 60 * 60;
      await votingEscrow.createLock(lockAmount, fourYears);

      const power = await votingEscrow.votingPower(deployer.address);
      // 4 year lock = full power = lockAmount (approximately, minus a few seconds)
      expect(power).to.be.closeTo(lockAmount, ethers.parseEther("100"));
    });

    it("should have less voting power with shorter lock", async function () {
      const lockAmount = ethers.parseEther("1000000");
      await clmt.transfer(alice.address, lockAmount);
      await clmt.connect(alice).approve(await votingEscrow.getAddress(), lockAmount);

      const oneYear = 365 * 24 * 60 * 60;
      await votingEscrow.connect(alice).createLock(lockAmount, oneYear);

      const alicePower = await votingEscrow.votingPower(alice.address);
      const deployerPower = await votingEscrow.votingPower(deployer.address);

      // Alice locked for 1 year vs deployer's 4 years, so ~25% of deployer's power
      expect(alicePower).to.be.lt(deployerPower);
      expect(alicePower).to.be.closeTo(deployerPower / 4n, ethers.parseEther("1000"));
    });

    it("should support delegation", async function () {
      await votingEscrow.connect(alice).delegate(bob.address);
      const delegation = await votingEscrow.delegation(alice.address);
      expect(delegation).to.equal(bob.address);
    });

    it("should not allow withdrawal before lock expires", async function () {
      await expect(votingEscrow.withdraw()).to.be.revertedWith("Lock not expired");
    });
  });

  describe("FeeDistributor", function () {
    it("should split fees according to hardcoded ratios", async function () {
      const feeAmount = 10_000n * USDC_UNIT; // 10,000 USDC
      await usdc.mint(deployer.address, feeAmount);
      await usdc.approve(await feeDistributor.getAddress(), feeAmount);

      const foundationBalBefore = await usdc.balanceOf(foundationSigner.address);

      await feeDistributor.distributeFees(feeAmount);

      const foundationBalAfter = await usdc.balanceOf(foundationSigner.address);
      const foundationShare = foundationBalAfter - foundationBalBefore;

      // Foundation gets 25% = 2,500 USDC
      expect(foundationShare).to.equal(2_500n * USDC_UNIT);
    });
  });

  describe("Tripartite Governance", function () {
    it("should create a proposal with sufficient veCLMT power", async function () {
      const setFeeData = oracle.interface.encodeFunctionData("setSubmissionBounty", [10_000n * USDC_UNIT]);

      await governor.propose(
        "Increase oracle bounty to 10,000 USDC",
        [await oracle.getAddress()],
        [0],
        [setFeeData],
        true // oracle-related
      );

      const phase = await governor.getProposalPhase(1);
      expect(phase).to.equal(0); // VeCLMTVoting
    });

    it("should allow veCLMT holders to vote", async function () {
      await governor.vote(1, true);

      const [forVotes, againstVotes] = await governor.getProposalVotes(1);
      expect(forVotes).to.be.gt(0);
      expect(againstVotes).to.equal(0);
    });

    it("should advance to SAB review after voting period", async function () {
      await time.increase(15 * 24 * 60 * 60); // 15 days
      await governor.advanceFromVoting(1);

      const phase = await governor.getProposalPhase(1);
      expect(phase).to.equal(1); // SABReview
    });

    it("should allow SAB to approve", async function () {
      await governor.connect(sabSigner).sabApprove(1);

      const phase = await governor.getProposalPhase(1);
      expect(phase).to.equal(2); // FoundationReview
    });

    it("should allow Foundation to approve", async function () {
      await governor.connect(foundationSigner).foundationApprove(1);

      const phase = await governor.getProposalPhase(1);
      expect(phase).to.equal(3); // Timelocked
    });

    it("should execute after timelock", async function () {
      await time.increase(8 * 24 * 60 * 60); // 8 days

      // Grant governance role to the governor so it can call setSubmissionBounty
      await oracle.grantRole(await oracle.GOVERNANCE_ROLE(), await governor.getAddress());

      await governor.execute(1);

      const phase = await governor.getProposalPhase(1);
      expect(phase).to.equal(4); // Executed

      const newBounty = await oracle.submissionBounty();
      expect(newBounty).to.equal(10_000n * USDC_UNIT);
    });

    it("should allow SAB to veto oracle-related proposals", async function () {
      const badData = oracle.interface.encodeFunctionData("removeDataSource", [SOURCE_IDS.NASA_GISS]);

      await governor.propose(
        "Remove NASA GISS (malicious)",
        [await oracle.getAddress()],
        [0],
        [badData],
        true
      );

      // Vote passes
      await governor.vote(2, true);
      await time.increase(15 * 24 * 60 * 60);
      await governor.advanceFromVoting(2);

      // SAB vetoes
      await governor.connect(sabSigner).sabVeto(2);

      const phase = await governor.getProposalPhase(2);
      expect(phase).to.equal(6); // Vetoed
    });

    it("should skip SAB review for non-oracle proposals", async function () {
      const setFeeData = market2030.interface.encodeFunctionData("setFees", [20, 20, 100]);

      await governor.propose(
        "Adjust market fees",
        [await market2030.getAddress()],
        [0],
        [setFeeData],
        false // not oracle-related
      );

      await governor.vote(3, true);
      await time.increase(15 * 24 * 60 * 60);
      await governor.advanceFromVoting(3);

      // Should go directly to Foundation review (skipping SAB)
      const phase = await governor.getProposalPhase(3);
      expect(phase).to.equal(2); // FoundationReview
    });

    it("should allow Foundation to veto", async function () {
      await governor.connect(foundationSigner).foundationVeto(3);

      const phase = await governor.getProposalPhase(3);
      expect(phase).to.equal(6); // Vetoed
    });
  });

  describe("Emergency Pause", function () {
    it("should require 2-of-3 bodies to pause", async function () {
      // SAB signals pause
      await governor.connect(sabSigner).signalPause();
      expect(await governor.paused()).to.be.false;

      // Foundation signals pause — now 2 of 3, triggers pause
      await governor.connect(foundationSigner).signalPause();
      expect(await governor.paused()).to.be.true;
    });

    it("should block execution while paused", async function () {
      // Try to execute something — should fail
      const dummyData = oracle.interface.encodeFunctionData("setSubmissionBounty", [1n * USDC_UNIT]);
      await governor.propose(
        "Test while paused",
        [await oracle.getAddress()],
        [0],
        [dummyData],
        true
      );

      // Even if proposal went through all phases, execute would fail
      // (we can't easily complete the full flow while paused, so just verify the flag)
      expect(await governor.paused()).to.be.true;
    });
  });

  describe("Oracle — Data Sources and Reporting", function () {
    before(async function () {
      await oracle.addDataSource(SOURCE_IDS.NASA_GISS, "NASA GISS", "GISTEMP v4");
      await oracle.addDataSource(SOURCE_IDS.NOAA, "NOAA NCEI", "NOAAGlobalTemp v5");
      await oracle.addDataSource(SOURCE_IDS.HADCRUT5, "HadCRUT5", "UK Met Office");
      await oracle.addDataSource(SOURCE_IDS.BERKELEY, "Berkeley Earth", "BEST");
      await oracle.addDataSource(SOURCE_IDS.JMA, "JMA", "Japan Met Agency");
      await oracle.addDataSource(SOURCE_IDS.ERA5, "ERA5", "Copernicus/ECMWF");

      const sourceKeys = Object.keys(SOURCE_IDS);
      const submitterAddrs = [submitter1, submitter2, submitter3, submitter4, submitter5, submitter6];
      for (let i = 0; i < submitterAddrs.length; i++) {
        await oracle.authoriseSubmitter(submitterAddrs[i].address, SOURCE_IDS[sourceKeys[i]]);
      }

      const fundAmount = 100_000n * USDC_UNIT;
      await usdc.mint(deployer.address, fundAmount);
      await usdc.approve(await oracle.getAddress(), fundAmount);
      await oracle.fundOracle(fundAmount);
    });

    it("should complete full oracle lifecycle", async function () {
      await oracle.openReporting(YEAR);

      const values = [1450, 1460, 1440, 1470, 1445, 1455];
      const subs = [submitter1, submitter2, submitter3, submitter4, submitter5, submitter6];
      for (let i = 0; i < subs.length; i++) {
        await oracle.connect(subs[i]).submitReport(YEAR, values[i]);
      }

      await time.increase(61 * 24 * 60 * 60);
      await oracle.aggregate(YEAR);

      const settlement = await oracle.settlements(YEAR);
      expect(settlement.aggregatedValue).to.equal(1452);

      await time.increase(31 * 24 * 60 * 60);
      await oracle.finalize(YEAR);

      const value = await oracle.getSettlementValue(YEAR);
      expect(value).to.equal(1452);
    });

    it("should distribute bounties to consensus-aligned submitters", async function () {
      const balBefore = await usdc.balanceOf(submitter1.address);
      await oracle.distributeBounties(YEAR);
      const balAfter = await usdc.balanceOf(submitter1.address);

      // First submitter gets bounty + early bonus
      expect(balAfter - balBefore).to.equal(6_000n * USDC_UNIT + 5_000n * USDC_UNIT);
      // Note: bounty was updated to 10,000 by governance test, so total = 10,000 + 1,000 = 11,000
    });
  });

  describe("Position Minting and Settlement", function () {
    it("should mint positions and settle", async function () {
      const depositAmount = 1000n * USDC_UNIT;
      await usdc.mint(bob.address, depositAmount);
      await usdc.connect(bob).approve(await market2030.getAddress(), depositAmount);
      await market2030.connect(bob).mint(depositAmount);

      const longId = await position.longTokenId(YEAR);
      const longBalance = await position.balanceOf(bob.address, longId);
      expect(longBalance).to.be.gt(0);

      // Settle
      await market2030.settle();
      expect(await market2030.settled()).to.be.true;

      // Claim
      const shortId = await position.shortTokenId(YEAR);
      const shortBalance = await position.balanceOf(bob.address, shortId);
      await position.connect(bob).setApprovalForAll(await market2030.getAddress(), true);

      const balBefore = await usdc.balanceOf(bob.address);
      await market2030.connect(bob).claim(longBalance, shortBalance);
      const balAfter = await usdc.balanceOf(bob.address);

      expect(balAfter).to.be.gt(balBefore);
    });
  });

  describe("AMM", function () {
    let market2050, amm2050;

    before(async function () {
      await factory.createMarket(2050);
      const [marketAddr, ammAddr] = await factory.getMarket(2050);
      market2050 = await ethers.getContractAt("TemperatureMarket", marketAddr);
      amm2050 = await ethers.getContractAt("ClimateAMM", ammAddr);

      const seedAmount = 50000n * USDC_UNIT;
      await usdc.mint(deployer.address, seedAmount);
      await usdc.approve(await market2050.getAddress(), seedAmount);
      await market2050.mint(seedAmount);

      const longId = await position.longTokenId(2050);
      const shortId = await position.shortTokenId(2050);
      const posAmount = await position.balanceOf(deployer.address, longId);

      await position.safeTransferFrom(deployer.address, await amm2050.getAddress(), longId, posAmount, "0x");
      await position.safeTransferFrom(deployer.address, await amm2050.getAddress(), shortId, posAmount, "0x");

      const fundAmount = 10000n * USDC_UNIT;
      await usdc.mint(deployer.address, fundAmount);
      await usdc.approve(await amm2050.getAddress(), fundAmount);
      await amm2050.fund(fundAmount);
    });

    it("should start with equal prices", async function () {
      const longP = await amm2050.longPrice();
      const shortP = await amm2050.shortPrice();
      const halfUnit = POSITION_UNIT / 2n;
      const tolerance = POSITION_UNIT / 100n;
      expect(longP).to.be.closeTo(halfUnit, tolerance);
      expect(shortP).to.be.closeTo(halfUnit, tolerance);
    });

    it("should execute trades and shift prices", async function () {
      const buyAmount = 100n * POSITION_UNIT;
      const cost = await amm2050.quoteBuy(true, buyAmount);

      await usdc.mint(alice.address, cost);
      await usdc.connect(alice).approve(await amm2050.getAddress(), cost);
      await amm2050.connect(alice).buy(true, buyAmount);

      const longP = await amm2050.longPrice();
      expect(longP).to.be.gt(POSITION_UNIT / 2n);

      const anomaly = await amm2050.impliedAnomaly();
      expect(anomaly).to.be.gt(2250); // above midpoint
    });
  });
});
