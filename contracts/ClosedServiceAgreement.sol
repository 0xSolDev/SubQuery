// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import "./interfaces/IServiceAgreement.sol";
import "./interfaces/ISettings.sol";
import "./interfaces/IIndexerRegistry.sol";

// This contract is the place Consumer publish a purchase offer or accept a plan for a specific deployment.
// And also the place indexers can search and take these purchase offer.
contract ClosedServiceAgreement is IServiceAgreement, ERC165 {
    address settings;

    address public consumer;
    address public indexer;
    bytes32 public deploymentId;
    uint256 public lockedAmount;
    uint256 public contractPeriod;
    uint256 public endDate;
    uint256 public planTemplateId;
    bool public renewable;

    constructor(
        address _settings,
        address _consumer,
        address _indexer,
        bytes32 _deploymentId,
        uint256 _lockedAmount,
        uint256 _contractPeriod,
        uint256 _planTemplateId,
        bool _renewable
    ) {
        settings = _settings;
        consumer = _consumer;
        indexer = _indexer;
        deploymentId = _deploymentId;
        lockedAmount = _lockedAmount;
        contractPeriod = _contractPeriod;
        endDate = block.timestamp + _contractPeriod;
        renewable = _renewable;
        planTemplateId = _planTemplateId;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC165)
        returns (bool)
    {
        return
            interfaceId == type(IServiceAgreement).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // consumer function
    function renewContract() external {
//        require(renewable, "contract is not renewable");
//        require(msg.sender == consumer, "sender is not consumer");
//        if (block.timestamp > endDate) {
//            endDate = block.timestamp + contractPeriod;
//        } else {
//            endDate += contractPeriod;
//        }
//
//        // deposit SQToken into the contract
//        IERC20(ISettings(settings).getSQToken()).transferFrom(
//            msg.sender,
//            address(this),
//            lockedAmount
//        );
    }

    // IServiceAgreement
    function hasEnded() external view returns (bool) {
        return block.timestamp > endDate;
    }

    // anyone function
    function fireDispute() external {
        // TODO: if dispute wins, staking of indexer could be slashed
    }

    function period() external view returns (uint256) {
        return contractPeriod;
    }

    function value() external view returns (uint256) {
        return lockedAmount;
    }
}
