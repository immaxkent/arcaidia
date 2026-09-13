// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import {UniswapV2Pair} from "./UniswapV2Pair.sol";

/// @title UniswapV2Factory
/// @notice The canonical factory, ported to 0.8.28.
/// @dev Delta from the 0.5.16 original: the pair is deployed with `new ... {salt:}`
///      rather than inline `create2` assembly. Same opcode, same address derivation,
///      same salt (`keccak256(token0, token1)`).
contract UniswapV2Factory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "UniswapV2: PAIR_EXISTS");

        pair = address(new UniswapV2Pair{salt: keccak256(abi.encodePacked(token0, token1))}());
        UniswapV2Pair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        // Populate both directions: the mapping is the only pair lookup this fork uses.
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
