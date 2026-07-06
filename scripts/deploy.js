const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const treasury = deployer.address;
  const development = deployer.address;
  const community = deployer.address;
  const contributors = deployer.address;
  const oracleIncentives = deployer.address;

  // 1. Deploy CLMT Token
  const CLMTToken = await hre.ethers.getContractFactory("CLMTToken");
  const clmt = await CLMTToken.deploy(treasury, development, community, contributors, oracleIncentives);
  await clmt.waitForDeployment();
  console.log("CLMTToken:", await clmt.getAddress());

  // 2. Deploy Climate DAO
  const ClimateDAO = await hre.ethers.getContractFactory("ClimateDAO");
  const dao = await ClimateDAO.deploy(await clmt.getAddress());
  await dao.waitForDeployment();
  console.log("ClimateDAO:", await dao.getAddress());

  // 3. Deploy a mock USDC for testing (6 decimals)
  const MockUSDC = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  console.log("MockUSDC:", await usdc.getAddress());

  // 4. Deploy ClimatePosition (ERC-1155)
  const ClimatePosition = await hre.ethers.getContractFactory("ClimatePosition");
  const position = await ClimatePosition.deploy();
  await position.waitForDeployment();
  console.log("ClimatePosition:", await position.getAddress());

  // 5. Deploy Temperature Oracle (takes USDC for bounty payments)
  const TemperatureOracle = await hre.ethers.getContractFactory("TemperatureOracle");
  const oracle = await TemperatureOracle.deploy(await usdc.getAddress(), treasury);
  await oracle.waitForDeployment();
  console.log("TemperatureOracle:", await oracle.getAddress());

  // 6. Deploy Market Factory
  const Factory = await hre.ethers.getContractFactory("TemperatureMarketFactory");
  const factory = await Factory.deploy(
    await usdc.getAddress(),
    await position.getAddress(),
    await oracle.getAddress(),
    treasury
  );
  await factory.waitForDeployment();
  console.log("TemperatureMarketFactory:", await factory.getAddress());

  // 7. Grant factory the admin role on ClimatePosition
  await position.grantRole(await position.DEFAULT_ADMIN_ROLE(), await factory.getAddress());
  console.log("Factory granted admin role on ClimatePosition");

  // 8. Register data sources
  const sources = [
    { id: hre.ethers.id("NASA_GISS"), name: "NASA GISS", method: "GISTEMP v4, 1850-1900 baseline" },
    { id: hre.ethers.id("NOAA"), name: "NOAA NCEI", method: "NOAAGlobalTemp v5" },
    { id: hre.ethers.id("HADCRUT5"), name: "HadCRUT5", method: "UK Met Office / CRU" },
    { id: hre.ethers.id("BERKELEY"), name: "Berkeley Earth", method: "BEST, 1850-1900 baseline" },
    { id: hre.ethers.id("JMA"), name: "JMA", method: "Japan Meteorological Agency" },
    { id: hre.ethers.id("ERA5"), name: "ERA5", method: "Copernicus/ECMWF reanalysis" },
  ];
  for (const src of sources) {
    await oracle.addDataSource(src.id, src.name, src.method);
    console.log(`Data source registered: ${src.name}`);
  }

  // 9. Fund the oracle with initial bounty pool
  const oracleFund = 100_000n * 1_000_000n; // 100,000 USDC
  await usdc.mint(deployer.address, oracleFund);
  await usdc.approve(await oracle.getAddress(), oracleFund);
  await oracle.fundOracle(oracleFund);
  console.log("Oracle funded with 100,000 USDC for bounties");

  // 10. Create markets for 2030 and 2040
  const SETTLEMENT_YEARS = [2030, 2040];
  for (const year of SETTLEMENT_YEARS) {
    const tx = await factory.createMarket(year);
    await tx.wait();
    const [market, amm] = await factory.getMarket(year);
    console.log(`Market ${year}: market=${market}, amm=${amm}`);
  }

  console.log("\nDeployment complete!");
  console.log("---");
  console.log("Next steps:");
  console.log("1. Authorise submitter addresses: oracle.authoriseSubmitter(addr, sourceId)");
  console.log("2. Mint test USDC: MockUSDC.mint(yourAddress, amount)");
  console.log("3. Approve market to spend USDC");
  console.log("4. Mint positions: TemperatureMarket.mint(amount)");
  console.log("5. Fund AMM with initial liquidity");
  console.log("6. Trade on the AMM: ClimateAMM.buy(isLong, amount)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
