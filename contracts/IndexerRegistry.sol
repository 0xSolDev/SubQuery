// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/utils/Address.sol';

import './interfaces/IIndexerRegistry.sol';
import './interfaces/IStaking.sol';
import './interfaces/ISettings.sol';
import './interfaces/IQueryRegistry.sol';
import './interfaces/IEraManager.sol';
import './interfaces/IRewardsDistributer.sol';

contract IndexerRegistry is Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    ISettings public settings;

    // Main Account:
    // The main account is stored in the indexer’s own wallet.
    // The indexer can use the main account to make the following actions:
    // - staking/unstaking
    // - register/unregisterIndexer
    // - set/remove a controller account
    // - start an indexing for a query project with specific controller account

    // Controller Account:
    // The controller account is set by the main account, which can execute some actions on the behalf of the main account.
    // These actions include
    // - reporting / updating the status of the indexing service on chain

    mapping(address => bool) public isIndexer;
    mapping(address => bytes32) public metadataByIndexer;
    mapping(address => address) public indexerToController;
    mapping(address => address) public controllerToIndexer;

    uint256 public minimumStakingAmont;

    event RegisterIndexer(address indexed indexer, uint256 amount, bytes32 metadata);
    event UnregisterIndexer(address indexed indexer);
    event UpdateMetadata(address indexed indexer, bytes32 metadata);
    event SetControllerAccount(address indexed indexer, address indexed controller);
    event RemoveControllerAccount(address indexed indexer, address indexed controller);
    event Stake(address indexed indexer, uint256 amount);
    event Unstake(address indexed indexer, uint256 amount);

    function initialize(ISettings _settings) external initializer {
        __Ownable_init();

        settings = _settings;
        minimumStakingAmont = 1000;
    }

    function setSettings(ISettings _settings) external onlyOwner {
        settings = _settings;
    }

    function setMinimumStakingAmont(uint256 _amount) external onlyOwner {
        minimumStakingAmont = _amount;
    }

    function registerIndexer(
        uint256 _amount,
        bytes32 _metadata,
        uint256 _rate
    ) external {
        require(!isIndexer[msg.sender], 'Already registered');
        require(_amount >= minimumStakingAmont, 'Not meet the minimum staking amount');

        IStaking staking = IStaking(settings.getStaking());
        staking.stake(msg.sender, _amount);
        staking.setInitialCommissionRate(msg.sender, _rate);

        isIndexer[msg.sender] = true;
        metadataByIndexer[msg.sender] = _metadata;

        emit RegisterIndexer(msg.sender, _amount, _metadata);
    }

    function stake(uint256 _amount) external {
        require(isIndexer[msg.sender], 'Not registered');
        IStaking(settings.getStaking()).stake(msg.sender, _amount);

        emit Stake(msg.sender, _amount);
    }

    function unstake(uint256 _amount) external {
        require(isIndexer[msg.sender], 'Not registered');

        IStaking staking = IStaking(settings.getStaking());
        uint256 totalAmount = staking.getDelegationAmount(msg.sender, msg.sender);
        require(
            totalAmount - _amount >= minimumStakingAmont,
            'Existential amount should be greater than minimum amount'
        );

        staking.unstake(msg.sender, _amount);
        emit Unstake(msg.sender, _amount);
    }

    function unregisterIndexer() external {
        require(isIndexer[msg.sender], 'Not registered');
        require(
            IQueryRegistry(settings.getQueryRegistry()).numberOfIndexingDeployments(msg.sender) == 0,
            'Can not unregister from the network due to running indexing projects'
        );

        IStaking staking = IStaking(settings.getStaking());
        uint256 amount = staking.getDelegationAmount(msg.sender, msg.sender);
        staking.unstake(msg.sender, amount);

        removeControllerAccount();
        isIndexer[msg.sender] = false;
        delete metadataByIndexer[msg.sender];

        emit UnregisterIndexer(msg.sender);
    }

    function updateMetadata(bytes32 _metadata) external {
        require(isIndexer[msg.sender], 'Not an indexer');
        metadataByIndexer[msg.sender] = _metadata;
        emit UpdateMetadata(msg.sender, _metadata);
    }

    function setControllerAccount(address _controller) external {
        // ensure to not use a controller used by someone else
        require(isIndexer[msg.sender], 'Only indexer can set controller account');
        require(controllerToIndexer[_controller] == address(0x0), 'Controller account is used by an indexer already');

        // remove previous controller to indexer link
        address prevController = indexerToController[msg.sender];
        delete controllerToIndexer[prevController];

        // add 2 directional links between indexer and controller
        indexerToController[msg.sender] = _controller;
        controllerToIndexer[_controller] = msg.sender;
        emit SetControllerAccount(msg.sender, _controller);
    }

    function removeControllerAccount() public {
        require(isIndexer[msg.sender], 'Only indexer can remove controller account');
        // remove 2 directional links between indexer and controller
        address _controller = indexerToController[msg.sender];
        delete indexerToController[msg.sender];
        delete controllerToIndexer[_controller];
        emit RemoveControllerAccount(msg.sender, _controller);
    }

    function isController(address _address) external view returns (bool) {
        return controllerToIndexer[_address] != address(0x0);
    }
}
