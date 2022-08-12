// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/ISettings.sol";

contract Settings is ISettings, Ownable {
    address public sqToken;
    address public staking;
    address public indexerRegistry;
    address public queryRegistry;
    address public eraManager;
    address public planManager;
    address public serviceAgreementRegistry;
    address public rewardsDistributer;

    constructor() Ownable() {}

    function setAllAddresses(
        address _sqToken,
        address _staking,
        address _indexerRegistry,
        address _queryRegistry,
        address _eraManager,
        address _planManager,
        address _serviceAgreementRegistry,
        address _rewardsDistributer
    ) external override onlyOwner {
        sqToken = _sqToken;
        staking = _staking;
        indexerRegistry = _indexerRegistry;
        queryRegistry = _queryRegistry;
        eraManager = _eraManager;
        planManager = _planManager;
        serviceAgreementRegistry = _serviceAgreementRegistry;
        rewardsDistributer = _rewardsDistributer;
    }

    function setSQToken(address _sqToken) external override onlyOwner {
        sqToken = _sqToken;
    }

    function getSQToken() external view override returns (address) {
        return sqToken;
    }

    function setStaking(address _staking) external override onlyOwner {
        staking = _staking;
    }

    function getStaking() external view override returns (address) {
        return staking;
    }

    function setIndexerRegistry(address _indexerRegistry)
        external
        override
        onlyOwner
    {
        indexerRegistry = _indexerRegistry;
    }

    function getIndexerRegistry() external view override returns (address) {
        return indexerRegistry;
    }

    function setQueryRegistry(address _queryRegistry)
        external
        override
        onlyOwner
    {
        queryRegistry = _queryRegistry;
    }

    function getQueryRegistry() external view override returns (address) {
        return queryRegistry;
    }

    function setEraManager(address _eraManager) external override onlyOwner {
        eraManager = _eraManager;
    }

    function getEraManager() external view override returns (address) {
        return eraManager;
    }

    function getPlanManager() external view override returns (address) {
        return planManager;
    }

    function setServiceAgreementRegistry(address _serviceAgreementRegistry)
        external
        override
        onlyOwner
    {
        serviceAgreementRegistry = _serviceAgreementRegistry;
    }

    function getServiceAgreementRegistry()
        external
        view
        override
        returns (address)
    {
        return serviceAgreementRegistry;
    }

    function setRewardsDistributer(address _rewardsDistributer)
        external
        override
        onlyOwner
    {
        rewardsDistributer = _rewardsDistributer;
    }

    function getRewardsDistributer() external view returns (address) {
        return rewardsDistributer;
    }
}
