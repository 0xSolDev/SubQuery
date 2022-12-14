// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract SQToken is ERC20, Ownable, ERC20Burnable {
    using SafeERC20 for IERC20;
    address public minter;

    modifier isMinter() {
        require(minter == msg.sender, "Not minter");
        _;
    }

    constructor(address _minter) ERC20("SubQueryToken", "SQT") Ownable() {
        minter = _minter;
        _mint(msg.sender, 10**28); // Initial Supply: 10,000,000,000 (10 billion)
    }

    function mint(address destination, uint256 amount) external isMinter {
        _mint(destination, amount);
    }

    /// #if_succeeds {:msg "minter should be set"} minter == _minter;
    /// #if_succeeds {:msg "owner functionality"} old(msg.sender == address(owner));
    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    function getMinter() external view returns (address) {
        return minter;
    }
}
