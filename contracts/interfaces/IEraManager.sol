// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IEraManager {
    function eraStartTime() external view returns (uint256);

    function eraPeriod() external view returns (uint256);

    function eraNumber() external view returns (uint256);

    function safeUpdateAndGetEra() external returns (uint256);
}
