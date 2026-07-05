// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ClimatePosition is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    // Token ID encoding: marketId * 2 for LONG, marketId * 2 + 1 for SHORT
    // marketId is the settlement year (2030, 2040, ..., 2100)

    mapping(uint256 => uint256) public totalSupplyOf;

    event PositionsMinted(uint256 indexed marketId, address indexed to, uint256 amount);
    event PositionsBurned(uint256 indexed marketId, address indexed from, uint256 amount);

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function longTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    function shortTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    function mintPair(address to, uint256 marketId, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 longId = longTokenId(marketId);
        uint256 shortId = shortTokenId(marketId);

        _mint(to, longId, amount, "");
        _mint(to, shortId, amount, "");

        totalSupplyOf[longId] += amount;
        totalSupplyOf[shortId] += amount;

        emit PositionsMinted(marketId, to, amount);
    }

    function burnPair(address from, uint256 marketId, uint256 amount) external onlyRole(BURNER_ROLE) {
        uint256 longId = longTokenId(marketId);
        uint256 shortId = shortTokenId(marketId);

        _burn(from, longId, amount);
        _burn(from, shortId, amount);

        totalSupplyOf[longId] -= amount;
        totalSupplyOf[shortId] -= amount;

        emit PositionsBurned(marketId, from, amount);
    }

    function burnSingle(address from, uint256 tokenId, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, tokenId, amount);
        totalSupplyOf[tokenId] -= amount;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
