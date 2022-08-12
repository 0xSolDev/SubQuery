// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

import './interfaces/IStaking.sol';
import './interfaces/ISettings.sol';
import './interfaces/IEraManager.sol';
import './interfaces/IRewardsDistributer.sol';
import './interfaces/IIndexerRegistry.sol';
import './interfaces/ISQToken.sol';

contract Staking is IStaking, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    struct StakingAmount {
        uint256 era; // last update era
        uint256 valueAt; // value at the era
        uint256 valueAfter; // value to be refresed from next era
    }

    struct UnbondAmount {
        uint256 amount; // pending unbonding amount
        uint256 startTime; // unbond start time
    }

    struct CommissionRate {
        uint256 era; // last update era
        uint256 valueAt; // value at the era
        uint256 valueAfter; // value to be refresed from next era
    }

    uint256 public indexerLeverageLimit;
    uint256 public unbondFeeRateBP;
    uint256 public lockPeriod; // timestamp unit
    ISettings public settings;

    uint256 public indexerLength; // number of registered indexers
    mapping(uint256 => address) public indexers; // staking address by indexer number.
    mapping(address => uint256) public indexerNo; // indexer number by staking address.
    mapping(address => StakingAmount) totalStakingAmount; // staking amount per indexer address

    mapping(address => mapping(uint256 => UnbondAmount)) unbondingAmount; // delegator address -> unbond request index -> amount&startTime
    mapping(address => uint256) public unbondingLength; // delegator address -> length of unbond requests
    mapping(address => uint256) public withdrawnLength; // delegator address -> length of widthdrawn requests

    mapping(address => mapping(address => StakingAmount)) delegation; // active delegation from delegator to indexer, delegator->indexer->amount
    mapping(address => mapping(uint256 => address)) public stakingIndexers; // actively staking indexers by delegator
    mapping(address => mapping(address => uint256)) public stakingIndexerNos; // delegating indexer number by delegator and indexer
    mapping(address => uint256) stakingIndexerLengths; // staking indexer lengths

    mapping(address => CommissionRate) public commissionRates; // delegation tax rate per indexer

    uint256 public constant UNNOMINATE_BURNRATE_MULTIPLIER = 1e3; // TODO: make it constant out of contract, since BP assume it is 1/10000
    uint256 constant COMMISSION_RATE_MULTIPLIER = 1e3;

    event DelegationAdded(address indexed source, address indexed indexer, uint256 amount);
    event DelegationRemoved(address indexed source, address indexed indexer, uint256 amount);
    event UnbondRequested(address indexed source, address indexed indexer, uint256 amount, uint256 index);

    event UnbondWithdrawn(address indexed source, uint256 amount, uint256 index);

    event SetCommissionRate(address indexed indexer, uint256 amount);

    function initialize(uint256 _lockPeriod, ISettings _settings) external initializer {
        __Ownable_init();

        indexerLeverageLimit = 10;
        unbondFeeRateBP = 10;

        lockPeriod = _lockPeriod;
        settings = _settings;
    }

    /// contract config
    function setSettings(ISettings _settings) external onlyOwner {
        settings = _settings;
    }

    function setLockPeriod(uint256 _lockPeriod) external onlyOwner {
        lockPeriod = _lockPeriod;
    }

    function setIndexerLeverageLimit(uint256 _indexerLeverageLimit) external onlyOwner {
        indexerLeverageLimit = _indexerLeverageLimit;
    }

    function setUnbondFeeRateBP(uint256 _unbondFeeRateBP) external onlyOwner {
        unbondFeeRateBP = _unbondFeeRateBP;
    }

    function setInitialCommissionRate(address indexer, uint256 rate) public {
        require(msg.sender == settings.getIndexerRegistry(), 'Caller is not indexerRegistry');
        require(rate <= COMMISSION_RATE_MULTIPLIER, 'Invalid commission rate');
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.safeUpdateAndGetEra();
        commissionRates[indexer] = CommissionRate(eraNumber, rate, rate);

        emit SetCommissionRate(indexer, rate);
    }

    function setCommissionRate(uint256 rate) public {
        IIndexerRegistry indexerRegistry = IIndexerRegistry(settings.getIndexerRegistry());
        IRewardsDistributer rewardsDistributer = IRewardsDistributer(settings.getRewardsDistributer());
        require(indexerRegistry.isIndexer(msg.sender), 'Not an indexer');
        require(rate <= COMMISSION_RATE_MULTIPLIER, 'Invalid commission rate');
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.safeUpdateAndGetEra();
        rewardsDistributer.onICRChange(msg.sender, eraNumber + 2);
        CommissionRate storage commissionRate = commissionRates[msg.sender];
        if (commissionRate.era < eraNumber) {
            commissionRate.era = eraNumber;
            commissionRate.valueAt = commissionRate.valueAfter;
        }
        commissionRate.valueAfter = rate;

        emit SetCommissionRate(msg.sender, rate);
    }

    function getCommissionRate(address indexer) external view returns (uint256) {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.eraNumber();
        CommissionRate memory commissionRate = commissionRates[indexer];
        if (commissionRate.era < eraNumber - 1) {
            return commissionRate.valueAfter;
        } else {
            return commissionRate.valueAt;
        }
    }

    function _reflectStakingAmount(uint256 eraNumber, StakingAmount storage stakeAmount) private {
        if (stakeAmount.era < eraNumber) {
            stakeAmount.era = eraNumber;
            stakeAmount.valueAt = stakeAmount.valueAfter;
        }
    }

    function _reflectEraUpdate(
        uint256 eraNumber,
        address _source,
        address _indexer
    ) private {
        _reflectStakingAmount(eraNumber, delegation[_source][_indexer]);
        _reflectStakingAmount(eraNumber, totalStakingAmount[_indexer]);
    }

    // when valueAfter is the effective value, swap it to valueAt,
    // so later on we can update valueAfter without change current value
    // require it idempotent
    function reflectEraUpdate(address _source, address _indexer) public {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.safeUpdateAndGetEra();
        _reflectEraUpdate(eraNumber, _source, _indexer);
    }

    function _addDelegation(
        address _source,
        address _indexer,
        uint256 _amount
    ) internal {
        if (_isEmptyDelegation(_source, _indexer)) {
            stakingIndexerNos[_source][_indexer] = stakingIndexerLengths[_source];
            stakingIndexers[_source][stakingIndexerLengths[_source]] = _indexer;
            stakingIndexerLengths[_source]++;
        }
        // first stake from indexer
        bool firstStake = _isEmptyDelegation(_indexer, _indexer);
        if (firstStake) {
            require(_source == _indexer, 'can not delegate to non-indexer');
            delegation[_source][_indexer].valueAt = _amount;
            totalStakingAmount[_indexer].valueAt = _amount;
            delegation[_source][_indexer].valueAfter = _amount;
            totalStakingAmount[_indexer].valueAfter = _amount;
        } else {
            delegation[_source][_indexer].valueAfter += _amount;
            totalStakingAmount[_indexer].valueAfter += _amount;
        }
        _onDelegationChange(_source, _indexer);

        emit DelegationAdded(_source, _indexer, _amount);
    }

    function _delegateToIndexer(
        address _source,
        address _indexer,
        uint256 _amount
    ) internal {
        IERC20(settings.getSQToken()).safeTransferFrom(_source, address(this), _amount);

        _addDelegation(_source, _indexer, _amount);
    }

    function stake(address _indexer, uint256 _amount) external override {
        require(msg.sender == settings.getIndexerRegistry(), 'Caller is not indexerRegistry');

        if (_isEmptyDelegation(_indexer, _indexer)) {
            indexers[indexerLength] = _indexer;
            indexerNo[_indexer] = indexerLength;
            indexerLength++;
        }

        reflectEraUpdate(_indexer, _indexer);
        _delegateToIndexer(_indexer, _indexer, _amount);
    }

    function delegate(address _indexer, uint256 _amount) external override {
        reflectEraUpdate(msg.sender, _indexer);

        // delegation limit should not exceed
        require(
            delegation[_indexer][_indexer].valueAfter * indexerLeverageLimit >=
                totalStakingAmount[_indexer].valueAfter + _amount,
            'Delegation limitation reached'
        );

        _delegateToIndexer(msg.sender, _indexer, _amount);
    }

    function _removeDelegation(
        address _source,
        address _indexer,
        uint256 _amount
    ) internal {
        require(_amount > 0, 'Amount should be positive');
        require(
            delegation[_source][_indexer].valueAfter >= _amount,
            'Removed delegation cannot be greater than current amount'
        );

        delegation[_source][_indexer].valueAfter -= _amount;
        totalStakingAmount[_indexer].valueAfter -= _amount;

        _onDelegationChange(_source, _indexer);

        emit DelegationRemoved(_source, _indexer, _amount);
    }

    function _onDelegationChange(address _source, address _indexer) internal {
        IRewardsDistributer rewardsDistributer = IRewardsDistributer(settings.getRewardsDistributer());
        rewardsDistributer.onStakeChange(_indexer, _source);
    }

    // TODO: introduction of redelegate history to punish
    function redelegate(
        address from_indexer,
        address to_indexer,
        uint256 _amount
    ) external override {
        address _source = msg.sender;

        require(from_indexer != msg.sender, 'Self delegation can not be redelegated');

        // delegation limit should not exceed
        require(
            delegation[to_indexer][to_indexer].valueAfter * indexerLeverageLimit >=
                totalStakingAmount[to_indexer].valueAfter + _amount,
            'Delegation limitation reached'
        );

        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.safeUpdateAndGetEra();
        _reflectEraUpdate(eraNumber, _source, from_indexer);
        _removeDelegation(_source, from_indexer, _amount);
        _reflectEraUpdate(eraNumber, _source, to_indexer);
        _addDelegation(_source, to_indexer, _amount);
    }

    function _startUnbond(
        address _source,
        address _indexer,
        uint256 _amount
    ) internal {
        _removeDelegation(_source, _indexer, _amount);

        uint256 index = unbondingLength[_source];
        unbondingAmount[_source][index].amount = _amount;
        unbondingAmount[_source][index].startTime = block.timestamp;
        unbondingLength[_source]++;

        emit UnbondRequested(_source, _indexer, _amount, index);
    }

    function unstake(address _indexer, uint256 _amount) external override {
        require(msg.sender == settings.getIndexerRegistry(), 'Caller is not indexerRegistry');

        reflectEraUpdate(_indexer, _indexer);
        if (delegation[_indexer][_indexer].valueAfter == _amount) {
            indexers[indexerNo[_indexer]] = indexers[indexerLength - 1];
            indexerNo[indexers[indexerLength - 1]] = indexerNo[_indexer];
            indexerLength--;
        }

        _startUnbond(_indexer, _indexer, _amount);
    }

    // request a unbond from an indexer for specific amount
    function undelegate(address _indexer, uint256 _amount) external override {
        // check if called by an indexer
        require(_indexer != msg.sender, 'Self delegation can not unbond from staking');
        reflectEraUpdate(msg.sender, _indexer);
        _startUnbond(msg.sender, _indexer, _amount);
    }

    function _withdrawARequest(uint256 _index) internal {
        // burn specific percentage
        uint256 amount = unbondingAmount[msg.sender][_index].amount;
        uint256 burnAmount = (unbondFeeRateBP * amount) / UNNOMINATE_BURNRATE_MULTIPLIER;
        uint256 availableAmount = amount - burnAmount;

        address SQToken = settings.getSQToken();
        ISQToken(SQToken).burn(burnAmount);
        IERC20(SQToken).safeTransfer(msg.sender, availableAmount);

        withdrawnLength[msg.sender]++;

        emit UnbondWithdrawn(msg.sender, availableAmount, _index);
    }

    // withdraw max 10 mature unbond requests from an indexer
    function widthdraw() external override {
        uint256 withdrawingLength = unbondingLength[msg.sender] - withdrawnLength[msg.sender];
        require(withdrawingLength > 0, 'Need to request unbond before withdraw');

        // withdraw the max top 10 requests
        if (withdrawingLength > 10) {
            withdrawingLength = 10;
        }

        uint256 time;
        uint256 latestWithdrawnLength = withdrawnLength[msg.sender];
        for (uint256 i = latestWithdrawnLength; i < latestWithdrawnLength + withdrawingLength; i++) {
            time = block.timestamp - unbondingAmount[msg.sender][i].startTime;
            if (time < lockPeriod) {
                break;
            }

            _withdrawARequest(i);
        }
    }

    function _isEmptyDelegation(address _source, address _indexer) internal view returns (bool) {
        return delegation[_source][_indexer].valueAt == 0 && delegation[_source][_indexer].valueAfter == 0;
    }

    // FIXME: reuse eraNumber
    function _parseStakingAmount(StakingAmount memory amount) internal view returns (uint256) {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.eraNumber();
        if (amount.era < eraNumber) {
            return amount.valueAfter;
        }
        return amount.valueAt;
    }

    function getTotalEffectiveStake(address _indexer) external view override returns (uint256) {
        uint256 effectiveStake = _parseStakingAmount(totalStakingAmount[_indexer]);
        uint256 selfDelegation = _parseStakingAmount(delegation[_indexer][_indexer]);
        if (effectiveStake > selfDelegation * indexerLeverageLimit) {
            effectiveStake = selfDelegation * indexerLeverageLimit;
        }
        return effectiveStake;
    }

    function getTotalStakingAmount(address _indexer) external view override returns (uint256) {
        return _parseStakingAmount(totalStakingAmount[_indexer]);
    }

    function getDelegationAmount(address _source, address _indexer) external view override returns (uint256) {
        return delegation[_source][_indexer].valueAfter;
    }

    function getStakingIndexersLength(address _address) external view returns (uint256) {
        return stakingIndexerLengths[_address];
    }

    function getStakingAmount(address _source, address _indexer) external view returns (StakingAmount memory) {
        return delegation[_source][_indexer];
    }

    function getUnbondingAmount(address _source, uint256 _id) external view returns (UnbondAmount memory) {
        return unbondingAmount[_source][_id];
    }

    function getUnbondingAmounts(address _source) external view returns (UnbondAmount[] memory) {
        uint256 withdrawingLength = unbondingLength[_source] - withdrawnLength[_source];
        UnbondAmount[] memory unbondAmounts = new UnbondAmount[](withdrawingLength);

        uint256 i;
        uint256 latestWithdrawnLength = withdrawnLength[_source];
        for (uint256 j = latestWithdrawnLength; j < latestWithdrawnLength + withdrawingLength; j++) {
            unbondAmounts[i] = unbondingAmount[_source][j];
            i++;
        }

        return unbondAmounts;
    }

    // Notes: slashing is applied to indexer's self staking
    // commenting this out for low priorities right now
    // function slashIndexer(address _indexer, uint256 _amount)
    //     external
    //     onlyOwner
    // {
    //     reflectEraUpdateOnNomination(_indexer, _indexer);
    //     reflectEraUpdateOnTotalStaking(_indexer);

    //     require(_amount > 0, "Should slash positive amount");
    //     require(
    //         nomination[_indexer][_indexer].valueAfter >= _amount,
    //         "Can not slash more than nomination"
    //     );

    //     nomination[msg.sender][_indexer].valueAfter -= _amount;
    //     totalStakingAmount[_indexer].valueAfter -= _amount;
    //     onNominationChange(msg.sender, _indexer);

    //     // TODO: For now sending tokens to owner when slash
    //     IERC20(settings.getSQToken()).safeTransferFrom(
    //         address(this),
    //         msg.sender,
    //         _amount
    //     );
    // }
}
