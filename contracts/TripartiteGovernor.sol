// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VotingEscrow.sol";

/// @notice Tripartite governance: proposals require approval from all three
///         governing bodies — veCLMT holders, the Science Advisory Board (SAB),
///         and the Foundation Board — before execution.
///
///         SAB and Foundation are represented by Gnosis Safe multisigs.
///         Their addresses can only be changed through the tripartite process itself.
contract TripartiteGovernor {
    VotingEscrow public immutable votingEscrow;

    address public sabMultisig;        // Science Advisory Board multisig
    address public foundationMultisig; // Foundation Board multisig

    uint256 public constant PROPOSAL_THRESHOLD = 100_000 * 1e18; // 0.1% of max supply in veCLMT power
    uint256 public constant VECLMT_VOTING_PERIOD = 14 days;
    uint256 public constant SAB_REVIEW_PERIOD = 14 days;
    uint256 public constant FOUNDATION_REVIEW_PERIOD = 14 days;
    uint256 public constant EXECUTION_TIMELOCK = 7 days;
    uint256 public constant QUORUM_BPS = 1000; // 10% of veCLMT

    enum ProposalPhase {
        VeCLMTVoting,
        SABReview,
        FoundationReview,
        Timelocked,
        Executed,
        Defeated,
        Vetoed
    }

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        bool isOracleRelated;
        ProposalPhase phase;
        // Phase timestamps
        uint256 voteStart;
        uint256 voteEnd;
        uint256 sabDeadline;
        uint256 foundationDeadline;
        uint256 executionTime;
        // Voting
        uint256 forVotes;
        uint256 againstVotes;
        // Approvals
        bool sabApproved;
        bool foundationApproved;
        // Tracking
        mapping(address => bool) hasVoted;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address indexed proposer, bool isOracleRelated, string description);
    event VeCLMTVoted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event PhaseAdvanced(uint256 indexed proposalId, ProposalPhase newPhase);
    event SABApproved(uint256 indexed proposalId);
    event SABVetoed(uint256 indexed proposalId);
    event FoundationApproved(uint256 indexed proposalId);
    event FoundationVetoed(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);
    event EmergencyPause(address indexed triggeredBy, address indexed secondBody);

    bool public paused;

    modifier notPaused() {
        require(!paused, "Protocol paused");
        _;
    }

    constructor(address _votingEscrow, address _sabMultisig, address _foundationMultisig) {
        votingEscrow = VotingEscrow(_votingEscrow);
        sabMultisig = _sabMultisig;
        foundationMultisig = _foundationMultisig;
    }

    // =====================================================================
    //  PROPOSAL CREATION
    // =====================================================================

    function propose(
        string calldata description,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bool isOracleRelated
    ) external returns (uint256) {
        require(votingEscrow.votingPower(msg.sender) >= PROPOSAL_THRESHOLD, "Below threshold");
        require(targets.length == values.length && values.length == calldatas.length, "Length mismatch");
        require(targets.length > 0, "Empty proposal");

        proposalCount++;
        Proposal storage p = proposals[proposalCount];
        p.id = proposalCount;
        p.proposer = msg.sender;
        p.description = description;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;
        p.isOracleRelated = isOracleRelated;
        p.phase = ProposalPhase.VeCLMTVoting;
        p.voteStart = block.timestamp;
        p.voteEnd = block.timestamp + VECLMT_VOTING_PERIOD;

        emit ProposalCreated(proposalCount, msg.sender, isOracleRelated, description);
        return proposalCount;
    }

    // =====================================================================
    //  PHASE 1: veCLMT VOTING
    // =====================================================================

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.VeCLMTVoting, "Not in voting phase");
        require(block.timestamp <= p.voteEnd, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        uint256 weight = votingEscrow.votingPower(msg.sender);
        require(weight > 0, "No voting power");

        p.hasVoted[msg.sender] = true;
        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit VeCLMTVoted(proposalId, msg.sender, support, weight);
    }

    function advanceFromVoting(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.VeCLMTVoting, "Not in voting phase");
        require(block.timestamp > p.voteEnd, "Voting not ended");

        uint256 totalVotes = p.forVotes + p.againstVotes;
        uint256 quorum = (votingEscrow.totalLocked() * QUORUM_BPS) / 10000;

        if (totalVotes < quorum || p.forVotes <= p.againstVotes) {
            p.phase = ProposalPhase.Defeated;
            emit PhaseAdvanced(proposalId, ProposalPhase.Defeated);
            return;
        }

        // Oracle-related proposals go to SAB; others skip to Foundation
        if (p.isOracleRelated) {
            p.phase = ProposalPhase.SABReview;
            p.sabDeadline = block.timestamp + SAB_REVIEW_PERIOD;
        } else {
            p.phase = ProposalPhase.FoundationReview;
            p.sabApproved = true; // implicitly approved (not oracle-related)
            p.foundationDeadline = block.timestamp + FOUNDATION_REVIEW_PERIOD;
        }

        emit PhaseAdvanced(proposalId, p.phase);
    }

    // =====================================================================
    //  PHASE 2: SAB REVIEW (oracle-related proposals only)
    // =====================================================================

    function sabApprove(uint256 proposalId) external {
        require(msg.sender == sabMultisig, "Not SAB");
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.SABReview, "Not in SAB review");
        require(block.timestamp <= p.sabDeadline, "SAB review expired");

        p.sabApproved = true;
        p.phase = ProposalPhase.FoundationReview;
        p.foundationDeadline = block.timestamp + FOUNDATION_REVIEW_PERIOD;

        emit SABApproved(proposalId);
        emit PhaseAdvanced(proposalId, ProposalPhase.FoundationReview);
    }

    function sabVeto(uint256 proposalId) external {
        require(msg.sender == sabMultisig, "Not SAB");
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.SABReview, "Not in SAB review");

        p.phase = ProposalPhase.Vetoed;
        emit SABVetoed(proposalId);
        emit PhaseAdvanced(proposalId, ProposalPhase.Vetoed);
    }

    /// @notice If SAB doesn't act within the review period, the proposal is
    ///         defeated (silence = no approval). This prevents the SAB from
    ///         being captured and used to rubber-stamp proposals by inaction.
    function expireSABReview(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.SABReview, "Not in SAB review");
        require(block.timestamp > p.sabDeadline, "Review period active");

        p.phase = ProposalPhase.Defeated;
        emit PhaseAdvanced(proposalId, ProposalPhase.Defeated);
    }

    // =====================================================================
    //  PHASE 3: FOUNDATION BOARD REVIEW
    // =====================================================================

    function foundationApprove(uint256 proposalId) external {
        require(msg.sender == foundationMultisig, "Not Foundation");
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.FoundationReview, "Not in Foundation review");
        require(block.timestamp <= p.foundationDeadline, "Foundation review expired");

        p.foundationApproved = true;
        p.phase = ProposalPhase.Timelocked;
        p.executionTime = block.timestamp + EXECUTION_TIMELOCK;

        emit FoundationApproved(proposalId);
        emit PhaseAdvanced(proposalId, ProposalPhase.Timelocked);
    }

    function foundationVeto(uint256 proposalId) external {
        require(msg.sender == foundationMultisig, "Not Foundation");
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.FoundationReview, "Not in Foundation review");

        p.phase = ProposalPhase.Vetoed;
        emit FoundationVetoed(proposalId);
        emit PhaseAdvanced(proposalId, ProposalPhase.Vetoed);
    }

    function expireFoundationReview(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.FoundationReview, "Not in Foundation review");
        require(block.timestamp > p.foundationDeadline, "Review period active");

        p.phase = ProposalPhase.Defeated;
        emit PhaseAdvanced(proposalId, ProposalPhase.Defeated);
    }

    // =====================================================================
    //  PHASE 4: EXECUTION
    // =====================================================================

    function execute(uint256 proposalId) external notPaused {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.Timelocked, "Not timelocked");
        require(block.timestamp >= p.executionTime, "Timelock active");
        require(p.sabApproved && p.foundationApproved, "Missing approvals");

        p.phase = ProposalPhase.Executed;

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success,) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    // =====================================================================
    //  EMERGENCY PAUSE (any 2 of 3 bodies)
    // =====================================================================

    mapping(bytes32 => bool) public pauseSignals;

    function signalPause() external {
        bytes32 key;
        if (msg.sender == sabMultisig) {
            key = keccak256("pause_sab");
        } else if (msg.sender == foundationMultisig) {
            key = keccak256("pause_foundation");
        } else {
            require(votingEscrow.votingPower(msg.sender) >= PROPOSAL_THRESHOLD, "Not authorized");
            key = keccak256("pause_veclmt");
        }

        pauseSignals[key] = true;

        uint256 signals = 0;
        if (pauseSignals[keccak256("pause_sab")]) signals++;
        if (pauseSignals[keccak256("pause_foundation")]) signals++;
        if (pauseSignals[keccak256("pause_veclmt")]) signals++;

        if (signals >= 2) {
            paused = true;
            // Reset signals
            pauseSignals[keccak256("pause_sab")] = false;
            pauseSignals[keccak256("pause_foundation")] = false;
            pauseSignals[keccak256("pause_veclmt")] = false;

            emit EmergencyPause(msg.sender, address(0));
        }
    }

    /// @notice Unpausing requires full tripartite proposal process.
    function unpause(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.phase == ProposalPhase.Timelocked, "Not timelocked");
        require(block.timestamp >= p.executionTime, "Timelock active");
        require(p.sabApproved && p.foundationApproved, "Missing approvals");

        paused = false;
        p.phase = ProposalPhase.Executed;
    }

    // =====================================================================
    //  MULTISIG ADDRESS UPDATES (requires tripartite approval)
    // =====================================================================

    function setSABMultisig(address newSab) external {
        require(msg.sender == address(this), "Only via governance");
        sabMultisig = newSab;
    }

    function setFoundationMultisig(address newFoundation) external {
        require(msg.sender == address(this), "Only via governance");
        foundationMultisig = newFoundation;
    }

    // =====================================================================
    //  VIEW FUNCTIONS
    // =====================================================================

    function getProposalPhase(uint256 proposalId) external view returns (ProposalPhase) {
        return proposals[proposalId].phase;
    }

    function getProposalVotes(uint256 proposalId) external view returns (uint256 forVotes, uint256 againstVotes) {
        Proposal storage p = proposals[proposalId];
        return (p.forVotes, p.againstVotes);
    }

    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }

    receive() external payable {}
}
