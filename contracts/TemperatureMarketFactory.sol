// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./TemperatureMarket.sol";
import "./ClimateAMM.sol";
import "./ClimatePosition.sol";
import "./TemperatureOracle.sol";

contract TemperatureMarketFactory is AccessControl {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    address public immutable collateralToken;
    ClimatePosition public immutable positionToken;
    TemperatureOracle public immutable oracle;
    address public daoTreasury;

    uint256 public defaultLiquidityParam = 10_000 * 1e18; // b = 10,000

    struct MarketInfo {
        address market;
        address amm;
        uint256 settlementYear;
        uint256 createdAt;
    }

    mapping(uint256 => MarketInfo) public markets; // year => market info
    uint256[] public settlementYears;

    event MarketCreated(
        uint256 indexed settlementYear,
        address market,
        address amm
    );

    constructor(
        address _collateralToken,
        address _positionToken,
        address _oracle,
        address _daoTreasury
    ) {
        collateralToken = _collateralToken;
        positionToken = ClimatePosition(_positionToken);
        oracle = TemperatureOracle(_oracle);
        daoTreasury = _daoTreasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
    }

    function createMarket(uint256 settlementYear) external onlyRole(GOVERNANCE_ROLE) returns (address, address) {
        return _createMarket(settlementYear, defaultLiquidityParam);
    }

    function createMarketWithParams(uint256 settlementYear, uint256 liquidityParam)
        external
        onlyRole(GOVERNANCE_ROLE)
        returns (address, address)
    {
        return _createMarket(settlementYear, liquidityParam);
    }

    function _createMarket(uint256 settlementYear, uint256 liquidityParam)
        internal
        returns (address marketAddr, address ammAddr)
    {
        require(markets[settlementYear].market == address(0), "Market exists");
        require(settlementYear >= 2030 && settlementYear <= 2100, "Invalid year");
        require(settlementYear % 10 == 0, "Must be decade boundary");

        TemperatureMarket market = new TemperatureMarket(
            collateralToken,
            address(positionToken),
            address(oracle),
            daoTreasury,
            settlementYear
        );

        ClimateAMM amm = new ClimateAMM(
            collateralToken,
            address(positionToken),
            address(market),
            daoTreasury,
            liquidityParam
        );

        // Grant the market contract permission to mint/burn positions
        positionToken.grantRole(positionToken.MINTER_ROLE(), address(market));
        positionToken.grantRole(positionToken.BURNER_ROLE(), address(market));

        markets[settlementYear] = MarketInfo({
            market: address(market),
            amm: address(amm),
            settlementYear: settlementYear,
            createdAt: block.timestamp
        });

        settlementYears.push(settlementYear);

        emit MarketCreated(settlementYear, address(market), address(amm));
        return (address(market), address(amm));
    }

    function getMarket(uint256 year) external view returns (address market, address amm) {
        MarketInfo storage info = markets[year];
        return (info.market, info.amm);
    }

    function getSettlementYears() external view returns (uint256[] memory) {
        return settlementYears;
    }

    function setDefaultLiquidityParam(uint256 _param) external onlyRole(GOVERNANCE_ROLE) {
        require(_param > 0, "Must be positive");
        defaultLiquidityParam = _param;
    }

    function setDaoTreasury(address _treasury) external onlyRole(GOVERNANCE_ROLE) {
        require(_treasury != address(0), "Zero address");
        daoTreasury = _treasury;
    }
}
