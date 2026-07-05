// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract CLMTToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 1e18;

    uint256 public constant DAO_TREASURY_SHARE = 40_000_000 * 1e18;
    uint256 public constant DEVELOPMENT_SHARE = 20_000_000 * 1e18;
    uint256 public constant COMMUNITY_SHARE = 25_000_000 * 1e18;
    uint256 public constant CONTRIBUTORS_SHARE = 10_000_000 * 1e18;
    uint256 public constant ORACLE_INCENTIVES_SHARE = 5_000_000 * 1e18;

    constructor(
        address daoTreasury,
        address development,
        address community,
        address contributors,
        address oracleIncentives
    ) ERC20("Climate Futures Token", "CLMT") ERC20Permit("Climate Futures Token") {
        _mint(daoTreasury, DAO_TREASURY_SHARE);
        _mint(development, DEVELOPMENT_SHARE);
        _mint(community, COMMUNITY_SHARE);
        _mint(contributors, CONTRIBUTORS_SHARE);
        _mint(oracleIncentives, ORACLE_INCENTIVES_SHARE);
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
