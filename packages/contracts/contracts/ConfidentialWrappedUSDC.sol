// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984.sol";
import {ERC20ToERC7984Wrapper} from "@iexec-nox/nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984Wrapper.sol";

contract ConfidentialWrappedUSDC is ERC20ToERC7984Wrapper {
    constructor(IERC20 usdc)
        ERC20ToERC7984Wrapper(usdc)
        ERC7984("Confidential USDC (Nox)", "cUSDC", "")
    {}
}
