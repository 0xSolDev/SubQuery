// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IRewardsDistributer {
    function collectAndDistributeRewards(address indexer) external;

    function onStakeChange(address indexer, address user) external;
    function onICRChange(address indexer, uint256 startEra) external;

    function increaseAgreementRewards(
        address indexer,
        address agreementContract
    ) external;

    function claim(address indexer) external;

    function userRewards(address indexer, address user)
        external
        view
        returns (uint256);
}
