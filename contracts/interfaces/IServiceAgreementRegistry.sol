// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IServiceAgreementRegistry {
    function establishServiceAgreement(address agreementContract) external;

    function hasOngoingServiceAgreement(address indexer, bytes32 deploymentId)
        external
        view
        returns (bool);
}
