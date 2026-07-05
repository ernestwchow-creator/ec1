// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ClimatePosition.sol";
import "./TemperatureOracle.sol";

contract TemperatureMarket is ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    IERC20 public immutable collateralToken; // USDC
    ClimatePosition public immutable positionToken;
    TemperatureOracle public immutable oracle;
    address public daoTreasury;

    uint256 public immutable settlementYear;
    uint256 public immutable marketId;

    // Anomaly range in millidegrees Celsius
    int256 public constant T_MIN = 500;   // +0.5°C
    int256 public constant T_MAX = 4000;  // +4.0°C
    int256 public constant T_RANGE = T_MAX - T_MIN; // 3500 millidegrees

    // Fees in basis points
    uint256 public issuanceFee = 10;    // 0.1%
    uint256 public redemptionFee = 10;  // 0.1%
    uint256 public settlementFee = 50;  // 0.5%

    // Collateral unit: 1 USDC = 1e6 (USDC has 6 decimals)
    uint256 public constant COLLATERAL_DECIMALS = 6;
    uint256 public constant COLLATERAL_UNIT = 10 ** COLLATERAL_DECIMALS;

    // Position tokens use 18 decimals for precision
    uint256 public constant POSITION_DECIMALS = 18;
    uint256 public constant POSITION_UNIT = 10 ** POSITION_DECIMALS;

    uint256 public totalCollateral;
    bool public settled;
    int256 public settlementValue; // millidegrees
    uint256 public longPayoutPerUnit; // in collateral units per POSITION_UNIT of long tokens

    event PositionsMinted(address indexed user, uint256 collateralAmount, uint256 positionAmount);
    event PositionsRedeemed(address indexed user, uint256 collateralAmount, uint256 positionAmount);
    event MarketSettled(int256 anomalyMilliCelsius, uint256 longPayoutPerUnit);
    event SettlementClaimed(address indexed user, uint256 longAmount, uint256 shortAmount, uint256 payout);
    event FeesUpdated(uint256 issuanceFee, uint256 redemptionFee, uint256 settlementFee);

    constructor(
        address _collateralToken,
        address _positionToken,
        address _oracle,
        address _daoTreasury,
        uint256 _settlementYear
    ) {
        collateralToken = IERC20(_collateralToken);
        positionToken = ClimatePosition(_positionToken);
        oracle = TemperatureOracle(_oracle);
        daoTreasury = _daoTreasury;
        settlementYear = _settlementYear;
        marketId = _settlementYear;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
    }

    function mint(uint256 collateralAmount) external nonReentrant {
        require(!settled, "Market settled");
        require(collateralAmount > 0, "Zero amount");

        uint256 fee = (collateralAmount * issuanceFee) / 10000;
        uint256 netCollateral = collateralAmount - fee;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount);
        if (fee > 0) {
            collateralToken.safeTransfer(daoTreasury, fee);
        }

        uint256 positionAmount = _collateralToPositionAmount(netCollateral);

        totalCollateral += netCollateral;
        positionToken.mintPair(msg.sender, marketId, positionAmount);

        emit PositionsMinted(msg.sender, collateralAmount, positionAmount);
    }

    function redeem(uint256 positionAmount) external nonReentrant {
        require(!settled, "Market settled");
        require(positionAmount > 0, "Zero amount");

        uint256 collateralAmount = _positionToCollateralAmount(positionAmount);
        uint256 fee = (collateralAmount * redemptionFee) / 10000;
        uint256 netCollateral = collateralAmount - fee;

        positionToken.burnPair(msg.sender, marketId, positionAmount);
        totalCollateral -= collateralAmount;

        if (fee > 0) {
            collateralToken.safeTransfer(daoTreasury, fee);
        }
        collateralToken.safeTransfer(msg.sender, netCollateral);

        emit PositionsRedeemed(msg.sender, netCollateral, positionAmount);
    }

    function settle() external nonReentrant {
        require(!settled, "Already settled");
        require(oracle.isFinalized(settlementYear), "Oracle not finalized");

        settlementValue = oracle.getSettlementValue(settlementYear);

        int256 clamped = settlementValue;
        if (clamped < T_MIN) clamped = T_MIN;
        if (clamped > T_MAX) clamped = T_MAX;

        // longPayoutPerUnit = how much collateral per POSITION_UNIT of LONG tokens
        // Scaled by COLLATERAL_UNIT for precision
        longPayoutPerUnit = uint256(clamped - T_MIN) * COLLATERAL_UNIT / uint256(T_RANGE);

        settled = true;
        emit MarketSettled(settlementValue, longPayoutPerUnit);
    }

    function claim(uint256 longAmount, uint256 shortAmount) external nonReentrant {
        require(settled, "Not settled");

        uint256 longPayout = 0;
        uint256 shortPayout = 0;

        if (longAmount > 0) {
            positionToken.burnSingle(msg.sender, positionToken.longTokenId(marketId), longAmount);
            longPayout = (longAmount * longPayoutPerUnit) / POSITION_UNIT;
        }

        if (shortAmount > 0) {
            positionToken.burnSingle(msg.sender, positionToken.shortTokenId(marketId), shortAmount);
            uint256 shortPayoutPerUnit = COLLATERAL_UNIT - longPayoutPerUnit;
            shortPayout = (shortAmount * shortPayoutPerUnit) / POSITION_UNIT;
        }

        uint256 totalPayout = longPayout + shortPayout;
        uint256 fee = (totalPayout * settlementFee) / 10000;
        uint256 netPayout = totalPayout - fee;

        totalCollateral -= totalPayout;

        if (fee > 0) {
            collateralToken.safeTransfer(daoTreasury, fee);
        }
        if (netPayout > 0) {
            collateralToken.safeTransfer(msg.sender, netPayout);
        }

        emit SettlementClaimed(msg.sender, longAmount, shortAmount, netPayout);
    }

    function setFees(uint256 _issuanceFee, uint256 _redemptionFee, uint256 _settlementFee)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        require(_issuanceFee <= 500, "Fee too high"); // max 5%
        require(_redemptionFee <= 500, "Fee too high");
        require(_settlementFee <= 500, "Fee too high");

        issuanceFee = _issuanceFee;
        redemptionFee = _redemptionFee;
        settlementFee = _settlementFee;

        emit FeesUpdated(_issuanceFee, _redemptionFee, _settlementFee);
    }

    function impliedAnomaly() external view returns (int256) {
        // Returns the current implied anomaly based on the AMM price
        // This is informational only - actual price comes from the AMM
        return T_MIN + (T_RANGE / 2); // midpoint when no AMM connected
    }

    function _collateralToPositionAmount(uint256 collateralAmount) internal pure returns (uint256) {
        return (collateralAmount * POSITION_UNIT) / COLLATERAL_UNIT;
    }

    function _positionToCollateralAmount(uint256 positionAmount) internal pure returns (uint256) {
        return (positionAmount * COLLATERAL_UNIT) / POSITION_UNIT;
    }
}
