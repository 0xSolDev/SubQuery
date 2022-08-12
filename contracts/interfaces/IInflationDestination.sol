// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IInflationDestination {
    function afterReceiveInflatedTokens(uint256 tokenAmount) external;
}
