// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IIndexerRegistry {
    function isIndexer(address _address) external view returns (bool);

    function isController(address _address) external view returns (bool);

    function controllerToIndexer(address _address)
        external
        view
        returns (address);

    function setCommissionRate(uint256 rate) external;
}
