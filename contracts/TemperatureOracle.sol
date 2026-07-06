// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Oracle that pays data providers for reporting, rather than requiring
///         them to stake. Designed for government/academic institutions (NASA,
///         NOAA, etc.) that publish temperature data but will not custody tokens.
///
///         Two-tier model:
///           - Data Sources: the authoritative institutions whose data we use.
///             Each source has a designated submitter address that may be the
///             institution itself or a DAO-approved intermediary.
///           - Designated Submitters: on-chain addresses authorised to submit
///             a value on behalf of exactly one data source. Multiple
///             independent submitters per source are supported for redundancy.
///
///         Incentives flow *to* reporters via bounties paid from the Oracle
///         Fund (seeded by protocol fees and the CLMT oracle-incentives
///         allocation). Submitters whose values land within the consensus
///         band receive the full bounty; outliers receive nothing.
contract TemperatureOracle is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    IERC20 public immutable collateralToken; // USDC — bounties paid in stablecoin
    address public daoTreasury;

    uint256 public constant MIN_SOURCES_FOR_QUORUM = 5;
    uint256 public constant REPORTING_WINDOW_DAYS = 60;
    uint256 public constant DISPUTE_WINDOW_DAYS = 30;
    uint256 public constant MAX_CONSENSUS_DEVIATION_MILLICELS = 100; // 0.1°C

    // Bounty paid per timely, consensus-aligned submission (in collateral units)
    uint256 public submissionBounty = 5_000 * 1e6; // 5,000 USDC default

    // Bonus for being the first valid submitter for a source (encourages speed)
    uint256 public earlyBountyBonus = 1_000 * 1e6; // 1,000 USDC

    // Dispute bond (paid in collateral so anyone can raise without holding CLMT)
    uint256 public disputeBond = 10_000 * 1e6; // 10,000 USDC
    uint256 public disputeReward = 5_000 * 1e6; // 5,000 USDC

    // --- Data Source Registry ---

    struct DataSource {
        bool isActive;
        string name;       // e.g. "NASA GISS", "NOAA NCEI"
        string methodology; // e.g. "GISTEMP v4, 1850-1900 baseline"
    }

    struct SubmitterInfo {
        bool isAuthorised;
        bytes32 sourceId;  // which data source this submitter represents
    }

    mapping(bytes32 => DataSource) public dataSources;      // sourceId => source
    bytes32[] public sourceIds;

    mapping(address => SubmitterInfo) public submitters;     // address => info
    mapping(bytes32 => address[]) public sourceSubmitters;   // sourceId => submitter[]

    // --- Settlement State ---

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
        int256 aggregatedValue;
        uint256 sourceReportCount;  // distinct sources that reported
        uint256 extensionCount;
    }

    struct SourceReport {
        bool submitted;
        address submitter;       // who submitted (for bounty payment)
        int256 value;            // millidegrees Celsius
        uint256 submittedAt;
        bool bountyClaimed;
    }

    mapping(uint256 => SettlementData) public settlements;
    mapping(uint256 => mapping(bytes32 => SourceReport)) public sourceReports; // year => sourceId => report
    mapping(uint256 => int256[]) internal _submissions;

    // Dispute tracking
    mapping(uint256 => address) public disputeRaiser;
    mapping(uint256 => int256) public disputeProposedValue;

    // Oracle Fund balance (protocol deposits USDC here to pay bounties)
    uint256 public oracleFundBalance;

    event DataSourceAdded(bytes32 indexed sourceId, string name);
    event DataSourceRemoved(bytes32 indexed sourceId);
    event SubmitterAuthorised(address indexed submitter, bytes32 indexed sourceId);
    event SubmitterRevoked(address indexed submitter, bytes32 indexed sourceId);
    event OracleFunded(address indexed funder, uint256 amount);
    event ReportingOpened(uint256 indexed year, uint256 opensAt, uint256 closesAt);
    event ValueReported(uint256 indexed year, bytes32 indexed sourceId, address indexed submitter, int256 valueMilliCelsius);
    event ValueAggregated(uint256 indexed year, int256 medianMilliCelsius, uint256 sourceCount);
    event BountyPaid(uint256 indexed year, bytes32 indexed sourceId, address indexed submitter, uint256 amount);
    event BountyWithheld(uint256 indexed year, bytes32 indexed sourceId, string reason);
    event DisputeRaised(uint256 indexed year, address indexed disputer, int256 proposedValue);
    event DisputeResolved(uint256 indexed year, bool upheld, int256 finalValue);
    event SettlementFinalized(uint256 indexed year, int256 finalValueMilliCelsius);

    constructor(address _collateralToken, address _daoTreasury) {
        collateralToken = IERC20(_collateralToken);
        daoTreasury = _daoTreasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
    }

    // =====================================================================
    //  DATA SOURCE & SUBMITTER MANAGEMENT
    // =====================================================================

    function addDataSource(bytes32 sourceId, string calldata name, string calldata methodology)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        require(!dataSources[sourceId].isActive, "Source exists");
        dataSources[sourceId] = DataSource({isActive: true, name: name, methodology: methodology});
        sourceIds.push(sourceId);
        emit DataSourceAdded(sourceId, name);
    }

    function removeDataSource(bytes32 sourceId) external onlyRole(GOVERNANCE_ROLE) {
        require(dataSources[sourceId].isActive, "Not active");
        dataSources[sourceId].isActive = false;
        emit DataSourceRemoved(sourceId);
    }

    function authoriseSubmitter(address submitter, bytes32 sourceId) external onlyRole(GOVERNANCE_ROLE) {
        require(dataSources[sourceId].isActive, "Source not active");
        require(!submitters[submitter].isAuthorised, "Already authorised");

        submitters[submitter] = SubmitterInfo({isAuthorised: true, sourceId: sourceId});
        sourceSubmitters[sourceId].push(submitter);
        emit SubmitterAuthorised(submitter, sourceId);
    }

    function revokeSubmitter(address submitter) external onlyRole(GOVERNANCE_ROLE) {
        require(submitters[submitter].isAuthorised, "Not authorised");
        bytes32 sourceId = submitters[submitter].sourceId;
        submitters[submitter].isAuthorised = false;
        emit SubmitterRevoked(submitter, sourceId);
    }

    function activeSourceCount() public view returns (uint256 count) {
        for (uint256 i = 0; i < sourceIds.length; i++) {
            if (dataSources[sourceIds[i]].isActive) count++;
        }
    }

    // =====================================================================
    //  ORACLE FUND
    // =====================================================================

    function fundOracle(uint256 amount) external {
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        oracleFundBalance += amount;
        emit OracleFunded(msg.sender, amount);
    }

    // =====================================================================
    //  REPORTING
    // =====================================================================

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

        SubmitterInfo storage info = submitters[msg.sender];
        require(info.isAuthorised, "Not authorised submitter");

        bytes32 sourceId = info.sourceId;
        require(dataSources[sourceId].isActive, "Source not active");

        SourceReport storage report = sourceReports[year][sourceId];
        require(!report.submitted, "Source already reported");

        report.submitted = true;
        report.submitter = msg.sender;
        report.value = valueMilliCelsius;
        report.submittedAt = block.timestamp;

        _submissions[year].push(valueMilliCelsius);
        s.sourceReportCount++;

        emit ValueReported(year, sourceId, msg.sender, valueMilliCelsius);
    }

    function extendReportingWindow(uint256 year) external onlyRole(GOVERNANCE_ROLE) {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.ReportingOpen, "Not in reporting");
        require(block.timestamp > s.reportingClosesAt, "Window not closed yet");
        require(s.sourceReportCount < MIN_SOURCES_FOR_QUORUM, "Quorum met");
        require(s.extensionCount < 3, "Max extensions reached");

        s.reportingClosesAt += 30 days;
        s.extensionCount++;
    }

    // =====================================================================
    //  AGGREGATION
    // =====================================================================

    function aggregate(uint256 year) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.ReportingOpen, "Not in reporting");
        require(block.timestamp > s.reportingClosesAt, "Window still open");
        require(s.sourceReportCount >= MIN_SOURCES_FOR_QUORUM, "Insufficient reports");

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

        emit ValueAggregated(year, s.aggregatedValue, s.sourceReportCount);
    }

    // =====================================================================
    //  BOUNTY DISTRIBUTION
    // =====================================================================

    /// @notice Called after finalization. Pays bounties to submitters whose
    ///         reported values are within the consensus band of the median.
    ///         Sources that reported outside the band or failed to report
    ///         receive nothing (but are not penalised — they simply aren't paid).
    function distributeBounties(uint256 year) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Finalized, "Not finalized");

        int256 median = s.aggregatedValue;
        uint256 earliest = type(uint256).max;

        // First pass: find the earliest valid submission time (for early bonus)
        for (uint256 i = 0; i < sourceIds.length; i++) {
            bytes32 sid = sourceIds[i];
            SourceReport storage report = sourceReports[year][sid];
            if (!report.submitted || report.bountyClaimed) continue;

            int256 dev = report.value > median ? report.value - median : median - report.value;
            if (uint256(dev) <= MAX_CONSENSUS_DEVIATION_MILLICELS && report.submittedAt < earliest) {
                earliest = report.submittedAt;
            }
        }

        // Second pass: pay bounties
        for (uint256 i = 0; i < sourceIds.length; i++) {
            bytes32 sid = sourceIds[i];
            SourceReport storage report = sourceReports[year][sid];

            if (!report.submitted) {
                emit BountyWithheld(year, sid, "no submission");
                continue;
            }
            if (report.bountyClaimed) continue;
            report.bountyClaimed = true;

            int256 dev = report.value > median ? report.value - median : median - report.value;

            if (uint256(dev) > MAX_CONSENSUS_DEVIATION_MILLICELS) {
                emit BountyWithheld(year, sid, "outside consensus band");
                continue;
            }

            uint256 payout = submissionBounty;
            if (report.submittedAt == earliest) {
                payout += earlyBountyBonus;
            }

            if (payout > oracleFundBalance) {
                payout = oracleFundBalance;
            }
            if (payout == 0) continue;

            oracleFundBalance -= payout;
            collateralToken.safeTransfer(report.submitter, payout);
            emit BountyPaid(year, sid, report.submitter, payout);
        }
    }

    // =====================================================================
    //  DISPUTE RESOLUTION
    // =====================================================================

    function raiseDispute(uint256 year, int256 proposedValue) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Aggregated, "Not in aggregated state");
        require(block.timestamp <= s.disputeDeadline, "Dispute window closed");
        require(disputeRaiser[year] == address(0), "Dispute already raised");

        collateralToken.safeTransferFrom(msg.sender, address(this), disputeBond);
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
            collateralToken.safeTransfer(disputer, disputeBond + disputeReward);
        } else {
            collateralToken.safeTransfer(daoTreasury, disputeBond);
        }

        s.status = SettlementStatus.Finalized;
        emit DisputeResolved(year, upheld, s.aggregatedValue);
        emit SettlementFinalized(year, s.aggregatedValue);
    }

    function finalize(uint256 year) external {
        SettlementData storage s = settlements[year];
        require(s.status == SettlementStatus.Aggregated, "Not aggregated");
        require(block.timestamp > s.disputeDeadline, "Dispute window open");

        s.status = SettlementStatus.Finalized;
        emit SettlementFinalized(year, s.aggregatedValue);
    }

    function getSettlementValue(uint256 year) external view returns (int256) {
        require(settlements[year].status == SettlementStatus.Finalized, "Not finalized");
        return settlements[year].aggregatedValue;
    }

    function isFinalized(uint256 year) external view returns (bool) {
        return settlements[year].status == SettlementStatus.Finalized;
    }

    // =====================================================================
    //  GOVERNANCE SETTERS
    // =====================================================================

    function setSubmissionBounty(uint256 _bounty) external onlyRole(GOVERNANCE_ROLE) {
        submissionBounty = _bounty;
    }

    function setEarlyBountyBonus(uint256 _bonus) external onlyRole(GOVERNANCE_ROLE) {
        earlyBountyBonus = _bonus;
    }

    function setDisputeParams(uint256 _bond, uint256 _reward) external onlyRole(GOVERNANCE_ROLE) {
        disputeBond = _bond;
        disputeReward = _reward;
    }

    // =====================================================================
    //  INTERNAL
    // =====================================================================

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
