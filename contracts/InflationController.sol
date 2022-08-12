// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IInflationDestination.sol";
import "./interfaces/ISettings.sol";
import "./interfaces/ISQToken.sol";
import "./interfaces/IEraManager.sol";

/// #invariant {:msg "settings variable is not zero address"} address(settings) != address(0x00);
/// #invariant {:msg "inflationRateBP in in range 0 to 10000"} inflationRateBP > 0 && inflationRateBP < 10000 ;
/// #invariant {:msg "inflationPeriod is always positive"} inflationPeriod > 0;
/// #invariant {:msg "_inflationStartTime should be always positive"} _inflationStartTime > 0;
contract InflationController is Initializable, OwnableUpgradeable {
    ISettings public settings;
    uint256 public inflationRateBP;
    address public inflationDestination;
    uint256 private _lastInflatedEra;

    /// #if_succeeds {:msg "settings should be set"} settings == _settings;
    /// #if_succeeds {:msg "inflationRateBP should be set"} inflationRateBP == _inflationRateBP;
    /// #if_succeeds {:msg "inflationPeriod should be set"} inflationPeriod == _inflationPeriod;
    /// #if_succeeds {:msg "inflationDestination should be set"} inflationDestination == _inflationDestination;
    function initialize(
        ISettings _settings,
        uint256 _inflationRateBP,
        address _inflationDestination
    ) external initializer {
        __Ownable_init();
        settings = _settings;
        inflationRateBP = _inflationRateBP;
        inflationDestination = _inflationDestination;
    }

    /// #if_succeeds {:msg "inflationRateBP should be updated"} inflationRateBP == _inflationRateBP;
    /// #if_succeeds {:msg "owner functionality"} old(msg.sender == address(owner));
    function setInflationRateBP(uint256 _inflationRateBP) external onlyOwner {
        require(
            _inflationRateBP >= 0 && _inflationRateBP < 10000,
            "InflationRateBP value is out of range"
        );
        inflationRateBP = _inflationRateBP;
    }

    /// #if_succeeds {:msg "inflationDestination should be updated"} inflationDestination == _inflationDestination;
    /// #if_succeeds {:msg "owner functionality"} old(msg.sender == address(owner));
    function setInflationDestination(address _inflationDestination) external onlyOwner
    {
        inflationDestination = _inflationDestination;
    }

    /// #if_succeeds {:msg "_claimedCount should be increased"} _claimedCount > old(_claimedCount);
    /// #if_succeeds {:msg "getMissingClaimCount should be decreased"} getMissingClaimCount() < old(getMissingClaimCount());
    /// #if_succeeds {:msg "inflationDestination should have increased balance"} IERC20(settings.getSQToken()).balanceOf(inflationDestination) > old(IERC20(settings.getSQToken()).balanceOf(inflationDestination));
    /// #if_succeeds {:msg "owner functionality"} old(msg.sender == address(owner));
    function mintInflatedTokens() external {
        uint256 missingClaimCount = getNotInflatedEras();
        require(missingClaimCount > 0, "Already minted in the current era");

        if (missingClaimCount > 10) {
            missingClaimCount = 10;
        }
        address sqToken = settings.getSQToken();
        uint256 totalSupply = IERC20(sqToken).totalSupply();
        uint256 newSupply = totalSupply;
        for (uint256 i = 0; i < missingClaimCount; i++) {
            newSupply = (newSupply * (10000 + inflationRateBP)) / 10000;
        }
        uint256 claimAmount = newSupply - totalSupply;
        ISQToken(sqToken).mint(inflationDestination, claimAmount);
        _lastInflatedEra += missingClaimCount;

        if (AddressUpgradeable.isContract(inflationDestination)) {
            IInflationDestination(inflationDestination)
            .afterReceiveInflatedTokens(claimAmount);
        }
    }

    function getNotInflatedEras() public view returns (uint256) {
        IEraManager eraManager = IEraManager(settings.getEraManager());
        uint256 eraNumber = eraManager.eraNumber();
        return eraNumber - _lastInflatedEra;
    }

    function getLastInflatedEra() public view returns (uint256) {
        return _lastInflatedEra;
    }
}
