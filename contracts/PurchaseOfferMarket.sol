// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './interfaces/IIndexerRegistry.sol';

import './interfaces/IServiceAgreementRegistry.sol';
import './interfaces/ISettings.sol';
import './ClosedServiceAgreement.sol';
import './interfaces/IPurchaseOfferMarket.sol';

struct PurchaseOffer {
    address contractee; // query consumer
    bool renewable; // allow renew with same detail and price
    bool cancelled;
    uint16 replicas; // how many indexer can accept the offer
    uint16 numAcceptedContracts; // number of contracts created from this offer
    uint256 expireDate;
    bytes32 deploymentId;
    uint256 deposit; // amount of SQT for each indexer, total deposit = deposit * replicas
    uint256 minimumAcceptHeight; // indexer must indexed to this height before accept the offer
    uint256 planTemplateId;
    uint256 contractPeriod;
}

// This contract is the place Consumer publish a purchase offer for a specific deployment.
// And also the place indexers can search and take these purchase offer.
contract PurchaseOfferMarket is Initializable, OwnableUpgradeable, IPurchaseOfferMarket {
    ISettings public settings;

    // offerId -> Offer
    mapping(uint256 => PurchaseOffer) public offers;
    uint256 public numOffers;

    // offerId -> indexer -> accepted
    mapping(uint256 => mapping(address => bool)) public acceptedOffer;

    event PurchaseOfferCreated(
        address contractee,
        bytes32 deploymentId,
        uint256 planTemplateId,
        uint256 deposit,
        uint16 replicas,
        uint256 minimumAcceptHeight,
        uint256 expireDate,
        uint256 contractPeriod,
        bool renewable
    );
    event PurchaseOfferCancelled(address indexed creator, uint256 offerId);

    modifier onlyIndexer() {
        require(IIndexerRegistry(settings.getIndexerRegistry()).isIndexer(msg.sender), 'caller is not an indexer');
        _;
    }

    function initialize(ISettings _settings) external initializer {
        __Ownable_init();

        settings = _settings;
    }

    // consumer function
    function createPurchaseOffer(
        bytes32 _deploymentId,
        uint256 _planTemplateId,
        uint16 _deposit,
        uint16 _replicas,
        uint256 _minimumAcceptHeight,
        uint256 _expireDate,
        uint256 _contractPeriod,
        bool _renewable
    ) external {
        require(_expireDate > block.timestamp, 'invalid expiration');
        require(_deposit > 0, 'should deposit positive amount');
        require(_replicas > 0, 'should replicas positive amount');
        // TODO: need to check `_planTemplateId` is active

        // send SQToken from msg.sender to the contract (this) - deposit * replicas
        IERC20(settings.getSQToken()).transferFrom(msg.sender, address(this), _deposit * _replicas);

        offers[numOffers] = PurchaseOffer(
            msg.sender,
            _renewable,
            false,
            _replicas,
            0,
            _expireDate,
            _deploymentId,
            _deposit,
            _minimumAcceptHeight,
            _planTemplateId,
            _contractPeriod
        );

        numOffers++;

        emit PurchaseOfferCreated(
            msg.sender,
            _deploymentId,
            _planTemplateId,
            _deposit,
            _replicas,
            _minimumAcceptHeight,
            _expireDate,
            _contractPeriod,
            _renewable
        );
    }

    // consumer function
    function cancelPurchaseOffer(uint256 _offerId) external {
        require(msg.sender == offers[_offerId].contractee, 'only offerer can cancel the offer');

        offers[_offerId].cancelled = true;

        // send remaining SQToken from the contract to contractee (this) - deposit * replicas
        IERC20(settings.getSQToken()).transfer(
            msg.sender,
            offers[_offerId].deposit * (offers[_offerId].replicas - offers[_offerId].numAcceptedContracts)
        );

        emit PurchaseOfferCancelled(msg.sender, _offerId);
    }

    // indexer function
    function acceptPurchaseOffer(uint256 _offerId) external onlyIndexer {
        require(_offerId < numOffers, 'invalid offerId');
        require(offers[_offerId].expireDate > block.timestamp, 'offer expired');
        require(!acceptedOffer[_offerId][msg.sender], 'offer accepted already');
        require(!offers[_offerId].cancelled, 'offer cancelled');
        require(
            offers[_offerId].replicas > offers[_offerId].numAcceptedContracts,
            'number of contracts already reached replicas'
        );

        // increate number of accepted contracts
        offers[_offerId].numAcceptedContracts++;

        // flag offer accept to avoid double accept
        acceptedOffer[_offerId][msg.sender] = true;

        PurchaseOffer memory offer = offers[_offerId];

        // create closed service agreement contract
        ClosedServiceAgreement subsContract = new ClosedServiceAgreement(
            address(settings),
            offer.contractee,
            msg.sender,
            offer.deploymentId,
            offer.deposit,
            offer.contractPeriod,
            offer.planTemplateId,
            offer.renewable
        );

        // deposit SQToken into the service agreement registry contract
        IERC20(settings.getSQToken()).transfer(settings.getServiceAgreementRegistry(), offer.deposit);

        // Register agreement globally
        IServiceAgreementRegistry(settings.getServiceAgreementRegistry()).establishServiceAgreement(
            address(subsContract)
        );
    }
}
