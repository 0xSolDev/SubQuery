// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface ISettings {
    function setAllAddresses(
        address _sqToken,
        address _staking,
        address _indexerRegistry,
        address _queryRegistry,
        address _eraManager,
        address _planManager,
        address _serviceAgreementRegistry,
        address _rewardsDistributer
    ) external;

    function setSQToken(address _sqToken) external;

    function getSQToken() external view returns (address);

    function setStaking(address _staking) external;

    function getStaking() external view returns (address);

    function setIndexerRegistry(address _indexerRegistry) external;

    function getIndexerRegistry() external view returns (address);

    function setQueryRegistry(address _queryRegistry) external;

    function getQueryRegistry() external view returns (address);

    function setEraManager(address _eraManager) external;

    function getEraManager() external view returns (address);

    function getPlanManager() external view returns (address);

    function setServiceAgreementRegistry(address _serviceAgreementRegistry)
        external;

    function getServiceAgreementRegistry() external view returns (address);

    function setRewardsDistributer(address _rewardsDistributer) external;

    function getRewardsDistributer() external view returns (address);
}
