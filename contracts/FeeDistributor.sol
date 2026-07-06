// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VotingEscrow.sol";

/// @notice Distributes protocol fees according to the hardcoded split:
///         60% to veCLMT stakers, 25% to Foundation, 15% to Oracle Fund.
///         The split is immutable — it cannot be changed by any governance action.
contract FeeDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateralToken; // USDC
    VotingEscrow public immutable votingEscrow;

    address public immutable foundationAddress;
    address public immutable oracleFundAddress;

    // Hardcoded fee split in basis points (total = 10000)
    uint256 public constant STAKER_SHARE_BPS = 6000;     // 60%
    uint256 public constant FOUNDATION_SHARE_BPS = 2500;  // 25%
    uint256 public constant ORACLE_FUND_SHARE_BPS = 1500; // 15%

    // Staker reward tracking
    uint256 public totalDistributed;
    uint256 public accRewardPerVePower; // accumulated reward per unit of voting power (scaled by 1e18)
    uint256 internal constant PRECISION = 1e18;

    mapping(address => uint256) public userRewardDebt;
    mapping(address => uint256) public pendingRewards;

    event FeesReceived(uint256 total, uint256 toStakers, uint256 toFoundation, uint256 toOracleFund);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(
        address _collateralToken,
        address _votingEscrow,
        address _foundationAddress,
        address _oracleFundAddress
    ) {
        collateralToken = IERC20(_collateralToken);
        votingEscrow = VotingEscrow(_votingEscrow);
        foundationAddress = _foundationAddress;
        oracleFundAddress = _oracleFundAddress;
    }

    /// @notice Called by market contracts and AMMs to distribute fees.
    ///         Anyone can call this with fees already transferred to this contract.
    function distributeFees(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 stakerAmount = (amount * STAKER_SHARE_BPS) / 10000;
        uint256 foundationAmount = (amount * FOUNDATION_SHARE_BPS) / 10000;
        uint256 oracleFundAmount = amount - stakerAmount - foundationAmount;

        // Send Foundation and Oracle Fund shares immediately
        collateralToken.safeTransfer(foundationAddress, foundationAmount);
        collateralToken.safeTransfer(oracleFundAddress, oracleFundAmount);

        // Accumulate staker rewards
        uint256 totalVePower = votingEscrow.totalLocked();
        if (totalVePower > 0) {
            accRewardPerVePower += (stakerAmount * PRECISION) / totalVePower;
        }

        totalDistributed += amount;
        emit FeesReceived(amount, stakerAmount, foundationAmount, oracleFundAmount);
    }

    /// @notice Claim accumulated staker rewards.
    function claim() external nonReentrant {
        _updateRewards(msg.sender);

        uint256 reward = pendingRewards[msg.sender];
        require(reward > 0, "Nothing to claim");

        pendingRewards[msg.sender] = 0;
        collateralToken.safeTransfer(msg.sender, reward);

        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice View pending rewards for an account.
    function pendingReward(address account) external view returns (uint256) {
        (uint256 lockedAmount,,) = votingEscrow.lockInfo(account);
        if (lockedAmount == 0) return pendingRewards[account];

        uint256 newReward = (lockedAmount * accRewardPerVePower / PRECISION) - userRewardDebt[account];
        return pendingRewards[account] + newReward;
    }

    function _updateRewards(address account) internal {
        (uint256 lockedAmount,,) = votingEscrow.lockInfo(account);
        if (lockedAmount > 0) {
            uint256 accumulatedReward = lockedAmount * accRewardPerVePower / PRECISION;
            pendingRewards[account] += accumulatedReward - userRewardDebt[account];
            userRewardDebt[account] = accumulatedReward;
        }
    }
}
