// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

import './interfaces/IStaking.sol';
import './interfaces/ISettings.sol';
import './interfaces/IEraManager.sol';
import './interfaces/IRewardsDistributer.sol';
import './interfaces/IServiceAgreement.sol';

// RewardsDistributer is managing the rewards for all indexers
contract RewardsDistributer is IRewardsDistributer, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    ISettings public settings;

    struct RewardInfo {
        uint256 accSQTPerStake;
        mapping(address => uint256) rewardDebt;
        uint256 lastClaimEra;
        uint256 eraReward;
        mapping(uint256 => uint256) eraRewardAddTable;
        mapping(uint256 => uint256) eraRewardRemoveTable;
    }

    mapping(address => RewardInfo) info; // indexer -> reward info

    // pendingStakeChangeLength can't tell if there is unapplied changes, >0 could means unapplied changes or changes for next era
    // lastSettledEra is the way to check unapplied changes
    mapping(address => mapping(address => bool)) pendingStakeChange; // indexer=>staker=>applied status
    mapping(address => uint256) pendingStakeChangeLength; // indexer=>length of pending changes
    mapping(address => uint256) pendingCommissionRateChange; // indexer=> era when the change applies
    mapping(address => uint256) lastSettledEra; // indexer=>era

    mapping(address => uint256) totalStakingAmount; // staking amount per indexer address
    mapping(address => mapping(address => uint256)) delegation; // active delegation from delegator to indexer, delegator->indexer->amount
    mapping(address => uint256) public commissionRates; // delegation tax rate per indexer

    uint256 constant ACCUMULATION_MULTIPLIER = 1e12;
    uint256 constant COMMISSION_RATE_MULTIPLIER = 1e3;

    event DistributeRewards(address indexed indexer, uint256 indexed eraIdx);
    event ClaimRewards(address indexed indexer, address indexed delegator, uint256 rewards);
    event RewardsChanged(address indexed indexer, uint256 indexed eraIdx, uint256 additions, uint256 removals);

    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        if (x > y) {
            return y;
        }
        return x;
    }

    function divUp(uint256 x, uint256 y) private pure returns (uint256) {
        return (x - 1) / y + 1;
    }

    function mulDiv(
        uint256 x,
        uint256 y,
        uint256 z
    ) internal pure returns (uint256) {
        return (x * y) / z;
    }

    function safeSub(uint256 x, uint256 y) internal pure returns (uint256) {
        if (x < y) {
            return 0;
        }
        return x - y;
    }

    function initialize(ISettings _settings) external initializer {
        __Ownable_init();

        settings = _settings;
    }

    function setSettings(ISettings _settings) external onlyOwner {
        settings = _settings;
    }

    // distribute contract's remaining balance to stakers
    //
    function distributeRewards(address indexer, uint256 reward) private {
        // send commission reward amount to the indexer directly
        uint256 commission = mulDiv(commissionRates[indexer], reward, COMMISSION_RATE_MULTIPLIER);
        IERC20(settings.getSQToken()).safeTransferFrom(address(this), indexer, commission);

        uint256 totalStake = getTotalStakingAmount(indexer);
        require(totalStake > 0, 'can not distribute rewards for non-indexer');

        info[indexer].accSQTPerStake += mulDiv(reward - commission, ACCUMULATION_MULTIPLIER, totalStake);
    }

    function getTotalStakingAmount(address _indexer) public view returns (uint256) {
        return totalStakingAmount[_indexer];
    }

    function increaseAgreementRewards(address indexer, address agreementContract) external {
        require(
            settings.getServiceAgreementRegistry() == msg.sender,
            'can only be called from service agreement registry'
        );
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();

        IServiceAgreement agreement = IServiceAgreement(agreementContract);

        uint256 agreementPeriod = agreement.period();
        uint256 agreementValue = agreement.value();
        uint256 eraPeriod = eraManager.eraPeriod();

        IERC20(settings.getSQToken()).safeTransferFrom(msg.sender, address(this), agreementValue);

        uint256 estAgreementEnd = block.timestamp + agreementPeriod;
        uint256 firstEraPortion = min(eraManager.eraStartTime() + eraPeriod, estAgreementEnd) - block.timestamp;

        RewardInfo storage rewardInfo = info[indexer];

        if (firstEraPortion == agreementPeriod) {
            // span in one era
            rewardInfo.eraRewardAddTable[currentEra] += agreementValue;
            rewardInfo.eraRewardRemoveTable[currentEra + 1] += agreementValue;
        } else if (agreementPeriod <= eraPeriod + firstEraPortion) {
            // span in two era
            uint256 firstEraReward = mulDiv(firstEraPortion, agreementValue, agreementPeriod);
            uint256 lastEraReward = safeSub(agreementValue, firstEraReward);
            rewardInfo.eraRewardAddTable[currentEra] += firstEraReward;

            uint256 postEndEra = currentEra + 2;
            if (firstEraReward < lastEraReward) {
                rewardInfo.eraRewardAddTable[currentEra + 1] += lastEraReward - firstEraReward;
                rewardInfo.eraRewardRemoveTable[postEndEra] += lastEraReward;
            } else {
                rewardInfo.eraRewardRemoveTable[currentEra + 1] += firstEraReward - lastEraReward;
                rewardInfo.eraRewardRemoveTable[postEndEra] += lastEraReward;
            }

            emit RewardsChanged(
                indexer,
                postEndEra,
                rewardInfo.eraRewardAddTable[postEndEra],
                rewardInfo.eraRewardRemoveTable[postEndEra]
            );
        } else {
            // span in > two eras
            splitEraSpanMore(firstEraPortion, agreementValue, agreementPeriod, currentEra, eraPeriod, rewardInfo);

            uint256 lastEra = divUp(agreementPeriod - firstEraPortion, eraPeriod) + currentEra;
            // Last era
            emit RewardsChanged(
                indexer,
                lastEra,
                rewardInfo.eraRewardAddTable[lastEra],
                rewardInfo.eraRewardRemoveTable[lastEra]
            );

            // Post last era
            emit RewardsChanged(
                indexer,
                lastEra + 1,
                rewardInfo.eraRewardAddTable[lastEra + 1],
                rewardInfo.eraRewardRemoveTable[lastEra + 1]
            );
        }

        // Current era will always change
        emit RewardsChanged(
            indexer,
            currentEra,
            rewardInfo.eraRewardAddTable[currentEra],
            rewardInfo.eraRewardRemoveTable[currentEra]
        );

        // Next era will always change
        emit RewardsChanged(
            indexer,
            currentEra + 1,
            rewardInfo.eraRewardAddTable[currentEra + 1],
            rewardInfo.eraRewardRemoveTable[currentEra + 1]
        );
    }

    function splitEraSpanMore(
        uint256 firstEraPortion,
        uint256 agreementValue,
        uint256 agreementPeriod,
        uint256 currentEra,
        uint256 eraPeriod,
        RewardInfo storage rewardInfo
    ) private {
        // span in > two eras
        uint256 firstEraReward = mulDiv(firstEraPortion, agreementValue, agreementPeriod);
        rewardInfo.eraRewardAddTable[currentEra] += firstEraReward;
        uint256 restEras = divUp(agreementPeriod - firstEraPortion, eraPeriod);
        uint256 rewardForMidEra = mulDiv(eraPeriod, agreementValue, agreementPeriod);
        rewardInfo.eraRewardAddTable[currentEra + 1] += rewardForMidEra - firstEraReward;
        uint256 rewardForLastEra = safeSub(safeSub(agreementValue, firstEraReward), rewardForMidEra * (restEras - 1));
        if (rewardForLastEra <= rewardForMidEra) {
            uint256 rewardMinus = safeSub(rewardForMidEra, rewardForLastEra);
            rewardInfo.eraRewardRemoveTable[restEras + currentEra] += rewardMinus;
            rewardInfo.eraRewardRemoveTable[restEras + currentEra + 1] += rewardForLastEra;
        } else {
            // this could happen due to rounding that rewardForLastEra is one larger than rewardForMidEra
            uint256 rewardAdd = safeSub(rewardForLastEra, rewardForMidEra);
            rewardInfo.eraRewardAddTable[restEras + currentEra] += rewardAdd;
            rewardInfo.eraRewardRemoveTable[restEras + currentEra + 1] += rewardForLastEra;
        }
    }

    function collectAndDistributeRewards(address indexer) public {
        // check current era is after lastClaimEra
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();
        require(info[indexer].lastClaimEra < currentEra, 'current era rewards should be claimed on next era');
        _collectAndDistributeRewards(currentEra, indexer);
    }

    function _collectAndDistributeRewards(uint256 currentEra, address indexer) private returns (uint256) {
        RewardInfo storage rewardInfo = info[indexer];
        if (rewardInfo.lastClaimEra == 0) {
            return 0;
        }
        require(checkAndReflectSettlement(currentEra, indexer), 'should apply pending stake changes');
        rewardInfo.lastClaimEra++;
        rewardInfo.eraReward += rewardInfo.eraRewardAddTable[rewardInfo.lastClaimEra];
        rewardInfo.eraReward -= rewardInfo.eraRewardRemoveTable[rewardInfo.lastClaimEra];
        if (rewardInfo.eraReward != 0) {
            distributeRewards(indexer, rewardInfo.eraReward);
            emit DistributeRewards(indexer, currentEra);
        }
        return rewardInfo.lastClaimEra;
    }

    // collect the last era's reward before this can pass
    function onStakeChange(address _indexer, address _source) external {
        require(msg.sender == settings.getStaking(), 'onStakeChange can only be called from staking contract');
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();
        require(
            _collectAndDistributeRewards(currentEra, _indexer) == currentEra - 1,
            'can not queue stake change unless collect rewards of last era'
        );
        require(checkAndReflectSettlement(currentEra, _indexer), 'apply pending changes first');
        if (pendingStakeChange[_indexer][_source] != true) {
            pendingStakeChange[_indexer][_source] = true;
            pendingStakeChangeLength[_indexer]++;
        }
    }

    // called by staking contract when indexer try to change commitionRate
    // collect the last era's reward before this can pass
    // ICR <=> Indexer Commission Rate
    function onICRChange(address indexer, uint256 startEra) external {
        require(msg.sender == settings.getStaking(), 'onICRChange can only be called from staking contract');
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();
        require(startEra > currentEra);
        require(
            _collectAndDistributeRewards(currentEra, indexer) == currentEra - 1,
            'can not queue stake change unless collect rewards of last era'
        );
        require(checkAndReflectSettlement(currentEra, indexer), 'apply pending changes first');
        pendingCommissionRateChange[indexer] = startEra;
    }

    // claim rewards for msg.sender
    function claim(address indexer) public {
        _claim(indexer, msg.sender);
    }

    function _claim(address indexer, address user) internal {
        uint256 rewards = userRewards(indexer, user);
        IERC20(settings.getSQToken()).safeTransfer(user, rewards);
        info[indexer].rewardDebt[user] += rewards;

        emit ClaimRewards(indexer, user, rewards);
    }

    function getDelegationAmount(address _source, address _indexer) private view returns (uint256) {
        return delegation[_source][_indexer];
    }

    function userRewards(address indexer, address user) public view returns (uint256) {
        uint256 delegationAmount = getDelegationAmount(user, indexer);
        return
            mulDiv(delegationAmount, info[indexer].accSQTPerStake, ACCUMULATION_MULTIPLIER) -
            info[indexer].rewardDebt[user];
    }

    function getRewardsAddTable(
        address indexer,
        uint256 startEra,
        uint256 length
    ) public view returns (uint256[] memory) {
        uint256[] memory table = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            table[i] = info[indexer].eraRewardAddTable[i + startEra];
        }
        return table;
    }

    function getRewardsRemoveTable(
        address indexer,
        uint256 startEra,
        uint256 length
    ) public view returns (uint256[] memory) {
        uint256[] memory table = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            table[i] = info[indexer].eraRewardRemoveTable[i + startEra];
        }
        return table;
    }

    // require to be true when someone try to claimRewards() or onStakeChangeRequested()
    // check if step 2 of previous era has done
    function checkAndReflectSettlement(uint256 currentEra, address indexer) private returns (bool) {
        if (lastSettledEra[indexer] == currentEra - 1) {
            return true;
        }
        if (
            pendingStakeChangeLength[indexer] == 0 &&
            (pendingCommissionRateChange[indexer] == 0 || pendingCommissionRateChange[indexer] > currentEra)
        ) {
            lastSettledEra[indexer] = currentEra - 1;
            return true;
        }
        return false;
    }

    // apply pending change(s)
    function applyStakeChanges(address indexer, address[] memory stakers) public {
        for (uint256 i = 0; i < stakers.length; i++) {
            applyStakeChange(indexer, stakers[i]);
        }
    }

    function applyStakeChange(address indexer, address staker) public {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();
        require(pendingStakeChange[indexer][staker], 'no pending changes');
        // for first stake
        if (info[indexer].lastClaimEra == 0) {
            info[indexer].lastClaimEra = currentEra - 1;
        } else {
            require(
                lastSettledEra[indexer] < info[indexer].lastClaimEra,
                "era reward hasn't been collected, call claimAndDistributeRewards() first"
            );
            _claim(indexer, staker);
        }

        // run hook for delegation change
        IStaking staking = IStaking(settings.getStaking());
        uint256 newDelegation = staking.getDelegationAmount(staker, indexer);
        delegation[staker][indexer] = newDelegation;

        info[indexer].rewardDebt[staker] = mulDiv(newDelegation, info[indexer].accSQTPerStake, ACCUMULATION_MULTIPLIER);

        pendingStakeChange[indexer][staker] = false;
        pendingStakeChangeLength[indexer]--;
        bool settled = checkAndReflectSettlement(currentEra, indexer);
        if (settled) {
            totalStakingAmount[indexer] = staking.getTotalStakingAmount(indexer);
        }
    }

    function applyICRChange(address indexer) public {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 currentEra = eraManager.safeUpdateAndGetEra();
        require(
            pendingCommissionRateChange[indexer] != 0 && pendingCommissionRateChange[indexer] <= currentEra,
            'no pending change'
        );
        require(
            lastSettledEra[indexer] < info[indexer].lastClaimEra,
            "era reward hasn't been collected, call claimAndDistributeRewards() first"
        );

        IStaking staking = IStaking(settings.getStaking());
        commissionRates[indexer] = staking.getCommissionRate(indexer);
        pendingCommissionRateChange[indexer] = 0;
        bool settled = checkAndReflectSettlement(currentEra, indexer);
        if (settled) {
            totalStakingAmount[indexer] = staking.getTotalStakingAmount(indexer);
        }
    }

    // views
    function getAccSQTPerStake(address indexer) public view returns (uint256) {
        return info[indexer].accSQTPerStake;
    }

    function getRewardDebt(address indexer, address staker) public view returns (uint256) {
        return info[indexer].rewardDebt[staker];
    }

    function getLastClaimEra(address indexer) public view returns (uint256) {
        return info[indexer].lastClaimEra;
    }
}
