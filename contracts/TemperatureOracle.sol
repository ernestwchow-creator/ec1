// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TemperatureOracle is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    IERC20 public immutable clmtToken;
    address public daoTreasury;

    uint256 public constant MIN_REPORTER_STAKE = 100_000 * 1e18;
    uint256 public constant MIN_REPORTERS_FOR_QUORUM = 5;
    uint256 public constant REPORTING_WINDOW_DAYS = 60;
    uint256 public constant DISPUTE_WINDOW_DAYS = 30;
    uint256 public constant DISPUTE_BOND = 10_000 * 1e18;
    uint256 public constant DISPUTE_REWARD = 5_000 * 1e18;
    uint256 public constant MAX_DEVIATION_MILLICELS = 100; // 0.1°C in millidegrees
    uint256 public constant SLASH_DEVIATION_BPS = 1000; // 10%
    uint256 public constant SLASH_ABSENCE_BPS = 500; // 5%

    struct ReporterInfo {
        bool isActive;
        uint256 stakedAmount;
    }

    enum SettlementStatus {
        Pending,
        ReportingOpen,
        Aggregated,
        Disputed,
        Finalized
    }

    struct SettlementData {
        SettlementStatus status;
        uint256 reportingOpensAt;
        uint256 reportingClosesAt;
        uint256 disputeDeadline;
        int256 aggregatedValue; // millidegrees Celsius
        uint256 reportCount;
        uint256 extensionCount;
    }

    mapping(address => ReporterInfo) public reporters;
    address[] public reporterList;

    mapping(uint256 => SettlementData) public settlements; // year => data
    mapping(uint256 => mapping(address => int256)) public reportedValues; // year => reporter => value
    mapping(uint256 => mapping(address => bool)) public hasReported; // year => reporter => bool
    mapping(uint256 => int256[]) internal _submissions; // year => sorted values

    // Dispute tracking
    mapping(uint256 => address) public disputeRaiser;
    mapping(uint256 => int256) public disputeProposedValue;

    event ReporterAdded(address indexed reporter);
    event ReporterRemoved(address indexed reporter);
    event ReporterStaked(address indexed reporter, uint256 amount);
    event ReportingOpened(uint256 indexed year, uint256 opensAt, uint256 closesAt);
    event ValueReported(uint256 indexed year, address indexed reporter, int256 valueMilliCelsius);
    event ValueAggregated(uint256 indexed year, int256 medianMilliCelsius, uint256 reportCount);
    event DisputeRaised(uint256 indexed year, address indexed disputer, int256 proposedValue);
    event DisputeResolved(uint256 indexed year, bool upheld, int256 finalValue);
    event ReporterSlashed(address indexed reporter, uint256 amount, string reason);
    event SettlementFinalized(uint256 indexed year, int256 finalValueMilliCelsius);

    constructor(address _clmtToken, address _daoTreasury) {
        clmtToken = IERC20(_clmtToken);
        daoTreasury = _daoTreasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
    }

    // --- Reporter Management ---

    function addReporter(address reporter) external onlyRole(GOVERNANCE_ROLE) {
        require(!reporters[reporter].isActive, "Already active");
        reporters[reporter].isActive = true;
        reporterList.push(reporter);
        emit ReporterAdded(reporter);
    }

    function removeReporter(address reporter) external onlyRole(GOVERNANCE_ROLE) {
        require(reporters[reporter].isActive, "Not active");
        reporters[reporter].isActive = false;
        emit ReporterRemoved(reporter);
    }

    function stake(uint256 amount) external {
        require(reporters[msg.sender].isActive, "Not a reporter");
        clmtToken.safeTransferFrom(msg.sender, address(this), amount);
        reporters[msg.sender].stakedAmount += amount;
        emit ReporterStaked(msg.sender, amount);
    }

    function activeReporterCount() public view returns (uint256 count) {
        for (uint256 i = 0; i < reporterList.length; i++) {
            if (reporters[reporterList[i]].isActive) count++;
        }
    }

    // --- Reporting ---

    function openReporting(uint256 year) external onlyRole(GOVERNANCE_ROLE) {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Pending, "Not pending");

        s.status = SettlementStatus.ReportingOpen;
        s.reportingOpensAt = block.timestamp;
        s.reportingClosesAt = block.timestamp + (REPORTING_WINDOW_DAYS * 1 days);
        s.extensionCount = 0;

        emit ReportingOpened(year, s.reportingOpensAt, s.reportingClosesAt);
    }

    function submitReport(uint256 year, int256 valueMilliCelsius) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.ReportingOpen, "Reporting not open");
        require(block.timestamp >= s.reportingOpensAt, "Too early");
        require(block.timestamp <= s.reportingClosesAt, "Window closed");
        require(reporters[msg.sender].isActive, "Not active reporter");
        require(reporters[msg.sender].stakedAmount >= MIN_REPORTER_STAKE, "Insufficient stake");
        require(!hasReported[year][msg.sender], "Already reported");

        hasReported[year][msg.sender] = true;
        reportedValues[year][msg.sender] = valueMilliCelsius;
        _submissions[year].push(valueMilliCelsius);
        s.reportCount++;

        emit ValueReported(year, msg.sender, valueMilliCelsius);
    }

    function extendReportingWindow(uint256 year) external onlyRole(GOVERNANCE_ROLE) {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.ReportingOpen, "Not in reporting");
        require(block.timestamp > s.reportingClosesAt, "Window not closed yet");
        require(s.reportCount < MIN_REPORTERS_FOR_QUORUM, "Quorum met");
        require(s.extensionCount < 3, "Max extensions reached");

        s.reportingClosesAt += 30 days;
        s.extensionCount++;
    }

    function aggregate(uint256 year) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.ReportingOpen, "Not in reporting");
        require(block.timestamp > s.reportingClosesAt, "Window still open");
        require(s.reportCount >= MIN_REPORTERS_FOR_QUORUM, "Insufficient reports");

        int256[] storage subs = _submissions[year];
        _sort(subs);

        uint256 mid = subs.length / 2;
        if (subs.length % 2 == 0) {
            s.aggregatedValue = (subs[mid - 1] + subs[mid]) / 2;
        } else {
            s.aggregatedValue = subs[mid];
        }

        s.status = SettlementStatus.Aggregated;
        s.disputeDeadline = block.timestamp + (DISPUTE_WINDOW_DAYS * 1 days);

        emit ValueAggregated(year, s.aggregatedValue, s.reportCount);
    }

    // --- Dispute Resolution ---

    function raiseDispute(uint256 year, int256 proposedValue) external {
        SettlementData storage s = settlements[year];
        require(
            s.status == SettlementStatus.Aggregated,
            "Not in aggregated state"
        );
        require(block.timestamp <= s.disputeDeadline, "Dispute window closed");
        require(disputeRaiser[year] == address(0), "Dispute already raised");

        clmtToken.safeTransferFrom(msg.sender, address(this), DISPUTE_BOND);
        disputeRaiser[year] = msg.sender;
        disputeProposedValue[year] = proposedValue;
        s.status = SettlementStatus.Disputed;

        emit DisputeRaised(year, msg.sender, proposedValue);
    }

    function resolveDispute(uint256 year, bool upheld) external onlyRole(GOVERNANCE_ROLE) {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Disputed, "No active dispute");

        address disputer = disputeRaiser[year];

        if (upheld) {
            s.aggregatedValue = disputeProposedValue[year];
            clmtToken.safeTransfer(disputer, DISPUTE_BOND + DISPUTE_REWARD);
        } else {
            clmtToken.safeTransfer(daoTreasury, DISPUTE_BOND);
        }

        s.status = SettlementStatus.Finalized;
        emit DisputeResolved(year, upheld, s.aggregatedValue);
        emit SettlementFinalized(year, s.aggregatedValue);
    }

    function finalize(uint256 year) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Aggregated, "Not aggregated");
        require(block.timestamp > s.disputeDeadline, "Dispute window open");

        _slashDeviators(year, s.aggregatedValue);

        s.status = SettlementStatus.Finalized;
        emit SettlementFinalized(year, s.aggregatedValue);
    }

    function getSettlementValue(uint256 year) external view returns (int256) {
        require(
            settlements[year].status == SettlementStatus.Finalized,
            "Not finalized"
        );
        return settlements[year].aggregatedValue;
    }

    function isFinalized(uint256 year) external view returns (bool) {
        return settlements[year].status == SettlementStatus.Finalized;
    }

    // --- Internal ---

    function _slashDeviators(uint256 year, int256 median) internal {
        for (uint256 i = 0; i < reporterList.length; i++) {
            address reporter = reporterList[i];
            if (!reporters[reporter].isActive) continue;

            if (hasReported[year][reporter]) {
                int256 reported = reportedValues[year][reporter];
                int256 deviation = reported > median ? reported - median : median - reported;

                if (uint256(deviation) > MAX_DEVIATION_MILLICELS) {
                    uint256 slashAmount = (reporters[reporter].stakedAmount * SLASH_DEVIATION_BPS) / 10000;
                    reporters[reporter].stakedAmount -= slashAmount;
                    clmtToken.safeTransfer(daoTreasury, slashAmount);
                    emit ReporterSlashed(reporter, slashAmount, "deviation");
                }
            } else {
                uint256 slashAmount = (reporters[reporter].stakedAmount * SLASH_ABSENCE_BPS) / 10000;
                reporters[reporter].stakedAmount -= slashAmount;
                clmtToken.safeTransfer(daoTreasury, slashAmount);
                emit ReporterSlashed(reporter, slashAmount, "absence");
            }
        }
    }

    function _sort(int256[] storage arr) internal {
        uint256 n = arr.length;
        for (uint256 i = 1; i < n; i++) {
            int256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }
}
