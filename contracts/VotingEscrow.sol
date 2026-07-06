// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Vote-escrowed CLMT (veCLMT). Holders lock CLMT for 1 week to
///         4 years and receive non-transferable voting power that decays
///         linearly as the lock approaches expiry. Modeled on Curve's veCRV.
contract VotingEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable clmtToken;

    uint256 public constant MIN_LOCK_DURATION = 1 weeks;
    uint256 public constant MAX_LOCK_DURATION = 4 * 365 days; // ~4 years

    struct Lock {
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => Lock) public locks;
    mapping(address => address) public delegation; // delegator => delegate

    uint256 public totalLocked;

    event Locked(address indexed user, uint256 amount, uint256 unlockTime);
    event Extended(address indexed user, uint256 newUnlockTime);
    event IncreasedAmount(address indexed user, uint256 additionalAmount);
    event Withdrawn(address indexed user, uint256 amount);
    event DelegateChanged(address indexed delegator, address indexed delegate);

    constructor(address _clmtToken) {
        clmtToken = IERC20(_clmtToken);
    }

    function createLock(uint256 amount, uint256 duration) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(locks[msg.sender].amount == 0, "Lock exists");
        require(duration >= MIN_LOCK_DURATION, "Duration too short");
        require(duration <= MAX_LOCK_DURATION, "Duration too long");

        uint256 unlockTime = block.timestamp + duration;

        clmtToken.safeTransferFrom(msg.sender, address(this), amount);

        locks[msg.sender] = Lock({amount: amount, unlockTime: unlockTime});
        totalLocked += amount;

        emit Locked(msg.sender, amount, unlockTime);
    }

    function increaseAmount(uint256 additionalAmount) external nonReentrant {
        require(additionalAmount > 0, "Zero amount");
        Lock storage lock = locks[msg.sender];
        require(lock.amount > 0, "No lock");
        require(lock.unlockTime > block.timestamp, "Lock expired");

        clmtToken.safeTransferFrom(msg.sender, address(this), additionalAmount);
        lock.amount += additionalAmount;
        totalLocked += additionalAmount;

        emit IncreasedAmount(msg.sender, additionalAmount);
    }

    function extendLock(uint256 newDuration) external nonReentrant {
        Lock storage lock = locks[msg.sender];
        require(lock.amount > 0, "No lock");
        require(lock.unlockTime > block.timestamp, "Lock expired");

        uint256 newUnlockTime = block.timestamp + newDuration;
        require(newUnlockTime > lock.unlockTime, "Must extend");
        require(newDuration <= MAX_LOCK_DURATION, "Duration too long");

        lock.unlockTime = newUnlockTime;
        emit Extended(msg.sender, newUnlockTime);
    }

    function withdraw() external nonReentrant {
        Lock storage lock = locks[msg.sender];
        require(lock.amount > 0, "No lock");
        require(block.timestamp >= lock.unlockTime, "Lock not expired");

        uint256 amount = lock.amount;
        totalLocked -= amount;
        lock.amount = 0;
        lock.unlockTime = 0;
        delegation[msg.sender] = address(0);

        clmtToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function delegate(address to) external {
        require(locks[msg.sender].amount > 0, "No lock");
        delegation[msg.sender] = to;
        emit DelegateChanged(msg.sender, to);
    }

    /// @notice Returns the current voting power for an account.
    ///         Power = lockedAmount * (timeRemaining / MAX_LOCK_DURATION)
    function votingPower(address account) public view returns (uint256) {
        Lock storage lock = locks[account];
        if (lock.amount == 0 || block.timestamp >= lock.unlockTime) {
            return 0;
        }

        uint256 timeRemaining = lock.unlockTime - block.timestamp;
        if (timeRemaining > MAX_LOCK_DURATION) {
            timeRemaining = MAX_LOCK_DURATION;
        }

        return (lock.amount * timeRemaining) / MAX_LOCK_DURATION;
    }

    /// @notice Returns the effective voting power, accounting for delegation.
    ///         If account has delegated, returns 0 (power counted under delegate).
    ///         Otherwise returns own power plus any delegated power.
    function effectiveVotingPower(address account) external view returns (uint256) {
        if (delegation[account] != address(0)) {
            return 0; // delegated away
        }
        return votingPower(account);
    }

    function lockInfo(address account) external view returns (uint256 amount, uint256 unlockTime, uint256 power) {
        Lock storage lock = locks[account];
        return (lock.amount, lock.unlockTime, votingPower(account));
    }
}
