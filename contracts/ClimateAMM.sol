// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ClimatePosition.sol";
import "./TemperatureMarket.sol";

/// @notice LMSR-based automated market maker for climate position tokens.
/// Uses fixed-point arithmetic with 18 decimal precision to avoid floating point.
contract ClimateAMM is ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    IERC20 public immutable collateralToken;
    ClimatePosition public immutable positionToken;
    TemperatureMarket public immutable market;
    address public daoTreasury;

    uint256 public immutable marketId;

    // LMSR liquidity parameter (in position-token units, 18 decimals)
    uint256 public liquidityParam; // b

    // Outstanding quantities of each outcome token held by the AMM's cost function
    // These track net tokens "sold" by the AMM (positive = AMM has sold these)
    int256 public qLong;
    int256 public qShort;

    // Trading fee in basis points
    uint256 public tradingFee = 30; // 0.3%

    // Fixed-point constants (18 decimals)
    int256 internal constant FIXED_ONE = 1e18;
    int256 internal constant LN2 = 693147180559945309; // ln(2) * 1e18

    event Trade(
        address indexed trader,
        bool isLong,
        bool isBuy,
        uint256 amount,
        uint256 cost,
        uint256 fee
    );
    event LiquidityParamUpdated(uint256 newParam);
    event TradingFeeUpdated(uint256 newFee);

    constructor(
        address _collateralToken,
        address _positionToken,
        address _market,
        address _daoTreasury,
        uint256 _liquidityParam
    ) {
        require(_liquidityParam > 0, "b must be positive");

        collateralToken = IERC20(_collateralToken);
        positionToken = ClimatePosition(_positionToken);
        market = TemperatureMarket(_market);
        daoTreasury = _daoTreasury;
        marketId = market.marketId();
        liquidityParam = _liquidityParam;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
    }

    /// @notice Fund the AMM's initial liquidity. The funder deposits collateral
    ///         equal to the maximum possible subsidy: b * ln(2).
    function fund(uint256 amount) external nonReentrant {
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Buy outcome tokens from the AMM.
    /// @param isLong true to buy LONG tokens, false to buy SHORT
    /// @param amount quantity of tokens to buy (18 decimals)
    /// @return cost total cost including fee (in collateral units)
    function buy(bool isLong, uint256 amount) external nonReentrant returns (uint256 cost) {
        require(amount > 0, "Zero amount");
        require(!market.settled(), "Market settled");

        int256 iAmount = int256(amount);
        int256 costBefore = _lmsrCost(qLong, qShort);

        int256 newQLong = qLong;
        int256 newQShort = qShort;

        if (isLong) {
            newQLong += iAmount;
        } else {
            newQShort += iAmount;
        }

        int256 costAfter = _lmsrCost(newQLong, newQShort);
        int256 rawCost = costAfter - costBefore;
        require(rawCost > 0, "Invalid cost");

        // Convert from 18-decimal fixed point to collateral decimals (6)
        uint256 collateralCost = uint256(rawCost) / 1e12;
        uint256 fee = (collateralCost * tradingFee) / 10000;
        cost = collateralCost + fee;

        collateralToken.safeTransferFrom(msg.sender, address(this), cost);
        if (fee > 0) {
            collateralToken.safeTransfer(daoTreasury, fee);
        }

        qLong = newQLong;
        qShort = newQShort;

        // Mint the position tokens to the buyer via the market
        // The AMM needs to mint a pair and give only the requested side
        // Actually, we transfer from AMM inventory or mint fresh pairs
        _deliverTokens(msg.sender, isLong, amount);

        emit Trade(msg.sender, isLong, true, amount, cost, fee);
    }

    /// @notice Sell outcome tokens back to the AMM.
    /// @param isLong true to sell LONG tokens, false to sell SHORT
    /// @param amount quantity of tokens to sell (18 decimals)
    /// @return payout total payout after fee (in collateral units)
    function sell(bool isLong, uint256 amount) external nonReentrant returns (uint256 payout) {
        require(amount > 0, "Zero amount");
        require(!market.settled(), "Market settled");

        int256 iAmount = int256(amount);
        int256 costBefore = _lmsrCost(qLong, qShort);

        int256 newQLong = qLong;
        int256 newQShort = qShort;

        if (isLong) {
            newQLong -= iAmount;
        } else {
            newQShort -= iAmount;
        }

        int256 costAfter = _lmsrCost(newQLong, newQShort);
        int256 rawPayout = costBefore - costAfter;
        require(rawPayout > 0, "Invalid payout");

        // Take the tokens from seller
        uint256 tokenId = isLong
            ? positionToken.longTokenId(marketId)
            : positionToken.shortTokenId(marketId);

        positionToken.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        uint256 collateralPayout = uint256(rawPayout) / 1e12;
        uint256 fee = (collateralPayout * tradingFee) / 10000;
        payout = collateralPayout - fee;

        qLong = newQLong;
        qShort = newQShort;

        if (fee > 0) {
            collateralToken.safeTransfer(daoTreasury, fee);
        }
        collateralToken.safeTransfer(msg.sender, payout);

        emit Trade(msg.sender, isLong, false, amount, payout, fee);
    }

    /// @notice Get the current price of a LONG token (18 decimal fixed point).
    function longPrice() public view returns (uint256) {
        return _price(true);
    }

    /// @notice Get the current price of a SHORT token (18 decimal fixed point).
    function shortPrice() public view returns (uint256) {
        return _price(false);
    }

    /// @notice Returns the implied temperature anomaly in millidegrees Celsius.
    function impliedAnomaly() external view returns (int256) {
        uint256 p = longPrice();
        // anomaly = T_MIN + p * T_RANGE / 1e18
        return market.T_MIN() + int256((p * uint256(market.T_RANGE())) / 1e18);
    }

    /// @notice Cost to buy a given amount of tokens (quote, no state change).
    function quoteBuy(bool isLong, uint256 amount) external view returns (uint256) {
        int256 iAmount = int256(amount);
        int256 newQLong = isLong ? qLong + iAmount : qLong;
        int256 newQShort = isLong ? qShort : qShort + iAmount;

        int256 rawCost = _lmsrCost(newQLong, newQShort) - _lmsrCost(qLong, qShort);
        uint256 collateralCost = uint256(rawCost) / 1e12;
        uint256 fee = (collateralCost * tradingFee) / 10000;
        return collateralCost + fee;
    }

    /// @notice Payout for selling a given amount of tokens (quote, no state change).
    function quoteSell(bool isLong, uint256 amount) external view returns (uint256) {
        int256 iAmount = int256(amount);
        int256 newQLong = isLong ? qLong - iAmount : qLong;
        int256 newQShort = isLong ? qShort : qShort - iAmount;

        int256 rawPayout = _lmsrCost(qLong, qShort) - _lmsrCost(newQLong, newQShort);
        uint256 collateralPayout = uint256(rawPayout) / 1e12;
        uint256 fee = (collateralPayout * tradingFee) / 10000;
        return collateralPayout - fee;
    }

    function setLiquidityParam(uint256 _liquidityParam) external onlyRole(GOVERNANCE_ROLE) {
        require(_liquidityParam > 0, "b must be positive");
        liquidityParam = _liquidityParam;
        emit LiquidityParamUpdated(_liquidityParam);
    }

    function setTradingFee(uint256 _tradingFee) external onlyRole(GOVERNANCE_ROLE) {
        require(_tradingFee <= 500, "Fee too high");
        tradingFee = _tradingFee;
        emit TradingFeeUpdated(_tradingFee);
    }

    // --- LMSR Math ---
    // All internal math uses 18-decimal fixed point.
    // C(q_long, q_short) = b * ln(e^(q_long/b) + e^(q_short/b))
    //
    // We use the log-sum-exp trick for numerical stability:
    // C = b * (max(q_long, q_short)/b + ln(1 + e^(-(|q_long - q_short|)/b)))

    function _lmsrCost(int256 _qLong, int256 _qShort) internal view returns (int256) {
        int256 b = int256(liquidityParam);

        int256 maxQ = _qLong > _qShort ? _qLong : _qShort;
        int256 diff = _qLong > _qShort ? _qLong - _qShort : _qShort - _qLong;

        // x = diff / b (scaled)
        int256 negX = -(diff * FIXED_ONE / b);

        // e^(negX) using our exp approximation
        int256 expVal = _expFixed(negX);

        // ln(1 + expVal)
        int256 lnVal = _lnFixed(FIXED_ONE + expVal);

        // C = maxQ + b * lnVal / FIXED_ONE
        return maxQ + (b * lnVal / FIXED_ONE);
    }

    function _price(bool isLong) internal view returns (uint256) {
        int256 b = int256(liquidityParam);

        int256 diff;
        if (isLong) {
            diff = qLong - qShort;
        } else {
            diff = qShort - qLong;
        }

        // price = e^(q/b) / (e^(q_long/b) + e^(q_short/b))
        // = 1 / (1 + e^(-diff/b))
        // = sigmoid(diff/b)

        int256 x = diff * FIXED_ONE / b;
        return uint256(_sigmoid(x));
    }

    /// @dev Sigmoid function: 1 / (1 + e^(-x)), x in 18-decimal fixed point.
    function _sigmoid(int256 x) internal pure returns (int256) {
        int256 negX = -x;
        int256 expNeg = _expFixed(negX);
        return FIXED_ONE * FIXED_ONE / (FIXED_ONE + expNeg);
    }

    /// @dev Fixed-point exponential using a 6th-order Taylor series.
    ///      Accurate for |x| < 10 * 1e18. For larger values, clamps.
    function _expFixed(int256 x) internal pure returns (int256) {
        // Clamp to avoid overflow
        if (x > 40 * FIXED_ONE) return type(int256).max / 1e18;
        if (x < -40 * FIXED_ONE) return 0;

        // Use the identity e^x = 2^(x / ln(2))
        // and compute 2^k * e^r where x = k*ln(2) + r, |r| < ln(2)/2

        // For simplicity and gas efficiency, we use a Padé approximant
        // e^x ≈ (1 + x/2 + x²/12) / (1 - x/2 + x²/12) for small x
        // For larger x, we decompose into integer and fractional parts

        bool neg = x < 0;
        if (neg) x = -x;

        // Decompose: x = k * ln(2) + r
        int256 k = x / LN2;
        int256 r = x - k * LN2;

        // e^r using Taylor series (r < ln(2) ≈ 0.693)
        int256 r2 = r * r / FIXED_ONE;
        int256 r3 = r2 * r / FIXED_ONE;
        int256 r4 = r3 * r / FIXED_ONE;
        int256 r5 = r4 * r / FIXED_ONE;

        int256 expR = FIXED_ONE + r + r2 / 2 + r3 / 6 + r4 / 24 + r5 / 120;

        // e^x = 2^k * e^r
        int256 result = expR;
        for (int256 i = 0; i < k && i < 80; i++) {
            result = result * 2;
            if (result > type(int256).max / 2) {
                result = type(int256).max / 1e18;
                break;
            }
        }

        if (neg) {
            return FIXED_ONE * FIXED_ONE / result;
        }
        return result;
    }

    /// @dev Fixed-point natural log for x > 0 (18-decimal fixed point).
    ///      ln(x) where x is in [0.5 * 1e18, 3 * 1e18] approximately.
    function _lnFixed(int256 x) internal pure returns (int256) {
        require(x > 0, "ln of non-positive");

        // ln(x) = ln(x/1) using the series ln(1+u) = u - u²/2 + u³/3 - ...
        // where u = (x - 1e18) / 1e18

        int256 u = x - FIXED_ONE;

        // For better convergence, use more terms
        int256 u2 = u * u / FIXED_ONE;
        int256 u3 = u2 * u / FIXED_ONE;
        int256 u4 = u3 * u / FIXED_ONE;
        int256 u5 = u4 * u / FIXED_ONE;
        int256 u6 = u5 * u / FIXED_ONE;

        return u - u2 / 2 + u3 / 3 - u4 / 4 + u5 / 5 - u6 / 6;
    }

    /// @dev Deliver tokens to buyer. The AMM mints a pair via the market
    ///      and keeps the side it doesn't need.
    function _deliverTokens(address buyer, bool isLong, uint256 amount) internal {
        // The AMM holds inventory. If it has enough of the requested token, transfer.
        // Otherwise, we'd need to mint new pairs — but the AMM doesn't mint directly.
        // In this design, the AMM transfers from its own balance.
        uint256 tokenId = isLong
            ? positionToken.longTokenId(marketId)
            : positionToken.shortTokenId(marketId);

        uint256 balance = positionToken.balanceOf(address(this), tokenId);
        require(balance >= amount, "Insufficient AMM inventory");

        positionToken.safeTransferFrom(address(this), buyer, tokenId, amount, "");
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}
