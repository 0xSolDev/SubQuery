// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './interfaces/IEraManager.sol';
import './interfaces/ISettings.sol';

/**
 * @title EraManager contract
 * @dev Produce epochs based on a period to coordinate contracts
 */
contract EraManager is Initializable, OwnableUpgradeable, IEraManager {
    ISettings public settings;
    uint256 public eraPeriod; // era period
    uint256 public eraNumber; // current era number
    uint256 public eraStartTime; // current era start time

    event EraPeriodUpdate(uint256 indexed era, uint256 eraPeriod);
    event NewEraStart(uint256 indexed era, address caller);

    function initialize(ISettings _settings, uint256 _eraPeriod) external initializer {
        __Ownable_init();

        settings = _settings;
        eraPeriod = _eraPeriod;
        // Emit start of era 0
        emit NewEraStart(eraNumber, msg.sender);
    }

    /**
     * @dev Start a new era if time already passed - anyone can call it
     */
    function startNewEra() public {
        require(eraStartTime + eraPeriod < block.timestamp, 'Current era is still active');

        eraNumber++;
        eraStartTime = block.timestamp;

        emit NewEraStart(eraNumber, msg.sender);
    }

    function safeUpdateAndGetEra() external returns (uint256) {
        if (eraStartTime + eraPeriod < block.timestamp) {
            startNewEra();
        }
        return eraNumber;
    }

    /**
     * @dev Update era period - only admin can call it
     */
    function updateEraPeriod(uint256 newEraPeriod) external onlyOwner {
        eraPeriod = newEraPeriod;

        emit EraPeriodUpdate(eraNumber, eraPeriod);
    }
}
