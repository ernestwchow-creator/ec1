const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // For proof of concept, deployer receives all token allocations
  // In production, these would be separate multisig addresses
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

  // 5. Deploy Temperature Oracle
  const TemperatureOracle = await hre.ethers.getContractFactory("TemperatureOracle");
  const oracle = await TemperatureOracle.deploy(await clmt.getAddress(), treasury);
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

  // 7. Grant factory the admin role on ClimatePosition so it can grant minter/burner
  await position.grantRole(await position.DEFAULT_ADMIN_ROLE(), await factory.getAddress());
  console.log("Factory granted admin role on ClimatePosition");

  // 8. Create markets for 2030 and 2040
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
  console.log("1. Mint test USDC: MockUSDC.mint(yourAddress, amount)");
  console.log("2. Approve market to spend USDC");
  console.log("3. Mint positions: TemperatureMarket.mint(amount)");
  console.log("4. Fund AMM with initial liquidity");
  console.log("5. Trade on the AMM: ClimateAMM.buy(isLong, amount)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
