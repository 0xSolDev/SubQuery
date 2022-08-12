// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface ISQToken {
    function mint(address destination, uint256 amount) external;

    function burn(uint256 amount) external;
}
