// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IPurchaseOfferMarket {
    function createPurchaseOffer(
        bytes32 _deploymentId,
        uint256 _planTemplateId,
        uint16 _deposit,
        uint16 _replicas,
        uint256 _minimumAcceptHeight,
        uint256 _expireDate,
        uint256 _contractPeriod,
        bool _renewable
    ) external;

    function cancelPurchaseOffer(uint256 _offerId) external;

    function acceptPurchaseOffer(uint256 _offerId) external;
}
