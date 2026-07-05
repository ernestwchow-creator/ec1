// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract ClimateDAO is AccessControl {
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    ERC20Votes public immutable governanceToken;

    uint256 public constant PROPOSAL_THRESHOLD = 100_000 * 1e18; // 0.1% of supply
    uint256 public constant STANDARD_VOTING_PERIOD = 7 days;
    uint256 public constant EMERGENCY_VOTING_PERIOD = 3 days;
    uint256 public constant STANDARD_QUORUM_BPS = 1000; // 10%
    uint256 public constant EMERGENCY_QUORUM_BPS = 500; // 5%
    uint256 public constant STANDARD_APPROVAL_BPS = 5000; // 50%
    uint256 public constant SUPERMAJORITY_BPS = 6600; // 66%
    uint256 public constant STANDARD_TIMELOCK = 48 hours;
    uint256 public constant EMERGENCY_TIMELOCK = 24 hours;

    enum ProposalType {
        Standard,
        Emergency,
        Upgrade
    }

    enum ProposalState {
        Active,
        Defeated,
        Succeeded,
        Queued,
        Executed,
        Vetoed
    }

    struct Proposal {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        string description;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 executionTime;
        ProposalState state;
        mapping(address => bool) hasVoted;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        ProposalType proposalType,
        string description
    );
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId);

    constructor(address _governanceToken) {
        governanceToken = ERC20Votes(_governanceToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    function propose(
        ProposalType proposalType,
        string calldata description,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external returns (uint256) {
        require(
            governanceToken.getVotes(msg.sender) >= PROPOSAL_THRESHOLD,
            "Below proposal threshold"
        );
        require(targets.length == values.length && values.length == calldatas.length, "Length mismatch");
        require(targets.length > 0, "Empty proposal");

        proposalCount++;
        Proposal storage p = proposals[proposalCount];
        p.id = proposalCount;
        p.proposer = msg.sender;
        p.proposalType = proposalType;
        p.description = description;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;
        p.startTime = block.timestamp;
        p.state = ProposalState.Active;

        if (proposalType == ProposalType.Emergency) {
            p.endTime = block.timestamp + EMERGENCY_VOTING_PERIOD;
        } else {
            p.endTime = block.timestamp + STANDARD_VOTING_PERIOD;
        }

        emit ProposalCreated(proposalCount, msg.sender, proposalType, description);
        return proposalCount;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp <= p.endTime, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        uint256 weight = governanceToken.getVotes(msg.sender);
        require(weight > 0, "No voting power");

        p.hasVoted[msg.sender] = true;
        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function queue(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp > p.endTime, "Voting not ended");

        uint256 totalVotes = p.forVotes + p.againstVotes;
        uint256 totalSupply = governanceToken.totalSupply();

        uint256 quorumBps = p.proposalType == ProposalType.Emergency
            ? EMERGENCY_QUORUM_BPS
            : STANDARD_QUORUM_BPS;
        require(totalVotes >= (totalSupply * quorumBps) / 10000, "Quorum not met");

        uint256 approvalBps = (p.proposalType == ProposalType.Emergency || p.proposalType == ProposalType.Upgrade)
            ? SUPERMAJORITY_BPS
            : STANDARD_APPROVAL_BPS;
        require(p.forVotes * 10000 / totalVotes >= approvalBps, "Approval threshold not met");

        uint256 timelock = p.proposalType == ProposalType.Emergency
            ? EMERGENCY_TIMELOCK
            : STANDARD_TIMELOCK;

        p.state = ProposalState.Queued;
        p.executionTime = block.timestamp + timelock;

        emit ProposalQueued(proposalId, p.executionTime);
    }

    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Queued, "Not queued");
        require(block.timestamp >= p.executionTime, "Timelock active");

        p.state = ProposalState.Executed;

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success, ) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    function veto(uint256 proposalId) external onlyRole(EMERGENCY_ROLE) {
        Proposal storage p = proposals[proposalId];
        require(
            p.state == ProposalState.Active || p.state == ProposalState.Queued,
            "Cannot veto"
        );
        p.state = ProposalState.Vetoed;
        emit ProposalVetoed(proposalId);
    }

    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        return proposals[proposalId].state;
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
