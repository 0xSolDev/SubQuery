// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IServiceAgreement {
    function hasEnded() external view returns (bool);

    function deploymentId() external view returns (bytes32);

    function indexer() external view returns (address);

    function consumer() external view returns (address);

    /* Returns true if renewed successfully */
    // function renew() external returns (bool);

    function period() external view returns (uint256);

    function value() external view returns (uint256);
}
