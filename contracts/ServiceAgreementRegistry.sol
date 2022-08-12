// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/utils/introspection/ERC165CheckerUpgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import './interfaces/IServiceAgreement.sol';
import './interfaces/IServiceAgreementRegistry.sol';
import './interfaces/ISettings.sol';
import './interfaces/IQueryRegistry.sol';
import './interfaces/IIndexerRegistry.sol';
import './interfaces/IRewardsDistributer.sol';
import './interfaces/IStaking.sol';

contract ServiceAgreementRegistry is Initializable, OwnableUpgradeable, IServiceAgreementRegistry {
    ISettings public settings;
    using ERC165CheckerUpgradeable for address;

    // mapping(address => mapping(bytes32 => address[])) public serviceAgreements; // contractor => deploymentId => IServiceAgreement[]

    mapping(address => mapping(uint256 => address)) public serviceAgreements;
    mapping(address => uint256) public indexerSaLength;
    mapping(address => mapping(bytes32 => uint256)) public indexerDeploymentSaLength;

    mapping(address => bool) public establisherWhitelist; // should be PurchaceOfferMarket and PlanManager addresses
    mapping(address => uint256) public sumDailyReward;

    uint256 public allowanceMultiplerBP;
    uint256 constant SECONDS_IN_DAY = 86400;

    event ServiceAgreementCreated(
        address indexed consumer,
        address indexed indexer,
        bytes32 indexed deploymentId,
        address serviceAgreement
    );

    function initialize(ISettings _settings, address[] calldata _whitelist) external initializer {
        __Ownable_init();

        settings = _settings;

        for (uint256 i; i < _whitelist.length; i++) {
            establisherWhitelist[_whitelist[i]] = true;
        }
    }

    function setSettings(ISettings _settings) external onlyOwner {
        settings = _settings;
    }

    function setAllowanceMultipler(uint256 _allowanceMultiplerBP) external onlyOwner {
        allowanceMultiplerBP = _allowanceMultiplerBP;
    }

    function addEstablisher(address establisher) external onlyOwner {
        establisherWhitelist[establisher] = true;
    }

    function removeEstablisher(address establisher) external onlyOwner {
        establisherWhitelist[establisher] = false;
    }

    function establishServiceAgreement(address agreementContract) external {
        require(establisherWhitelist[msg.sender], 'Address is not authorised to establish agreements');
        require(
            agreementContract.supportsInterface(type(IServiceAgreement).interfaceId),
            'Contract is not a service agreement'
        );

        address indexer = IServiceAgreement(agreementContract).indexer();
        address consumer = IServiceAgreement(agreementContract).consumer();
        bytes32 deploymentId = IServiceAgreement(agreementContract).deploymentId();

        require(
            IQueryRegistry(settings.getQueryRegistry()).isIndexingAvailable(deploymentId, indexer),
            'Indexing service is not available to establish agreements'
        );

        IStaking staking = IStaking(settings.getStaking());
        uint256 totalStake = staking.getTotalStakingAmount(indexer);

        uint256 lockedAmount = IServiceAgreement(agreementContract).value();
        uint256 contractPeriod = IServiceAgreement(agreementContract).period() / SECONDS_IN_DAY;

        if (contractPeriod == 0) {
            contractPeriod = 1;
        }
        sumDailyReward[indexer] += lockedAmount / contractPeriod;

        require(
            totalStake >= (sumDailyReward[indexer] * allowanceMultiplerBP) / 10000,
            'Indexer reward reached to the limit'
        );
        // serviceAgreements[indexer][deploymentId].push(agreementContract);

        serviceAgreements[indexer][indexerSaLength[indexer]] = agreementContract;
        indexerSaLength[indexer] += 1;
        indexerDeploymentSaLength[indexer][deploymentId] += 1;

        // approve token to reward distributor contract
        address SQToken = settings.getSQToken();
        IERC20(SQToken).approve(settings.getRewardsDistributer(), IServiceAgreement(agreementContract).value());

        // increase agreement rewards
        IRewardsDistributer rewardsDistributer = IRewardsDistributer(settings.getRewardsDistributer());
        rewardsDistributer.increaseAgreementRewards(indexer, agreementContract);

        emit ServiceAgreementCreated(consumer, indexer, deploymentId, agreementContract);
    }

    function clearEndedAgreements(address indexer, uint256 id) external {
        address agreement = getServiceAgreements(indexer, id);

        if (IServiceAgreement(agreement).hasEnded()) {
            uint256 lockedAmount = IServiceAgreement(agreement).value();
            uint256 contractPeriod = IServiceAgreement(agreement).period() / SECONDS_IN_DAY;
            if (contractPeriod == 0) {
                contractPeriod = 1;
            }
            sumDailyReward[indexer] -= lockedAmount / contractPeriod;
            serviceAgreements[indexer][id] = serviceAgreements[indexer][indexerSaLength[indexer] - 1];
            delete serviceAgreements[indexer][indexerSaLength[indexer] - 1];
            indexerSaLength[indexer] -= 1;

            bytes32 deploymentId = IServiceAgreement(agreement).deploymentId();
            indexerDeploymentSaLength[indexer][deploymentId] -= 1;
        }
    }

    function getServiceAgreements(address indexer, uint256 id) public view returns (address) {
        return serviceAgreements[indexer][id];
    }

    function hasOngoingServiceAgreement(address indexer, bytes32 deploymentId) external view returns (bool) {
        if (indexerDeploymentSaLength[indexer][deploymentId] > 0) {
            return true;
        }
        return false;
    }
}
