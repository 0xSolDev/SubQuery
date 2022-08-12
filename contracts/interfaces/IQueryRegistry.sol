// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IQueryRegistry {
    function numberOfIndexingDeployments(address _address)
        external
        view
        returns (uint256);

    function isIndexingAvailable(bytes32 deploymentId, address indexer)
        external
        view
        returns (bool);
}
