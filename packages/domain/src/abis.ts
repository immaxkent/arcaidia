/**
 * ABI barrel — GENERATED, do not edit.
 *
 * Regenerate with `pnpm abi:generate` after changing any contract. The
 * `abi:check` script fails the build when this file is stale, so a downstream
 * package can never be compiled against an interface the contracts no longer have.
 */

export const ABIS = {
  ArcaidiaIntentRouter: [
    {
      "type": "function",
      "name": "createIntent",
      "inputs": [
        {
          "name": "recipient",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "maxFeeBps",
          "type": "uint16",
          "internalType": "uint16"
        },
        {
          "name": "deadline",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "nonce",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "tokenOut",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "targetMinOut",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "destinationReceiver",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initialize",
      "inputs": [
        {
          "name": "owner_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "settlementAsset_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "settlementInitiator_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "maxIntentAmount_",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "maxInFlightValue_",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "initialized",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "intentExists",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxInFlightValue",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxIntentAmount",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "nonceUsed",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "owner",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "paused",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "quoteIntentId",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "recipient",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "maxFeeBps",
          "type": "uint16",
          "internalType": "uint16"
        },
        {
          "name": "deadline",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "nonce",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "tokenOut",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "targetMinOut",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "releaseInFlight",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setDestination",
      "inputs": [
        {
          "name": "chainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setLimits",
      "inputs": [
        {
          "name": "maxIntentAmount_",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "maxInFlightValue_",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setPaused",
      "inputs": [
        {
          "name": "paused_",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setTradeIntentsAllowed",
      "inputs": [
        {
          "name": "allowed",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settlementAsset",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "settlementInitiator",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract ISettlementInitiator"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "totalInFlight",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "tradeIntentsAllowed",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "transferOwnership",
      "inputs": [
        {
          "name": "newOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "DestinationConfigured",
      "inputs": [
        {
          "name": "chainId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "InFlightReleased",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "IntentCreated",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "sender",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "recipient",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "intentVersion",
          "type": "uint8",
          "indexed": false,
          "internalType": "uint8"
        },
        {
          "name": "inputToken",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "sourceChainId",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "maxFeeBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        },
        {
          "name": "deadline",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "nonce",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "tokenOut",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "targetMinOut",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "settlementRef",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "LimitsConfigured",
      "inputs": [
        {
          "name": "maxIntentAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "maxInFlightValue",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "OwnerTransferred",
      "inputs": [
        {
          "name": "previousOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "newOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "PausedSet",
      "inputs": [
        {
          "name": "paused",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "RouterInitialized",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "settlementAsset",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "settlementInitiator",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "TradeIntentsAllowedSet",
      "inputs": [
        {
          "name": "allowed",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyInitialized",
      "inputs": []
    },
    {
      "type": "error",
      "name": "DeadlineInPast",
      "inputs": [
        {
          "name": "deadline",
          "type": "uint64",
          "internalType": "uint64"
        }
      ]
    },
    {
      "type": "error",
      "name": "DestinationIsSourceChain",
      "inputs": []
    },
    {
      "type": "error",
      "name": "DestinationNotAllowed",
      "inputs": [
        {
          "name": "chainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "FeeCeilingAboveDenominator",
      "inputs": [
        {
          "name": "maxFeeBps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ]
    },
    {
      "type": "error",
      "name": "InFlightCapExceeded",
      "inputs": [
        {
          "name": "attempted",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "cap",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAlreadyExists",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAmountAboveCap",
      "inputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "cap",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidTradeTerms",
      "inputs": [
        {
          "name": "tokenOut",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "targetMinOut",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "NonceAlreadyUsed",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "nonce",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "NotOwner",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NothingInFlight",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ReentrancyGuardReentrantCall",
      "inputs": []
    },
    {
      "type": "error",
      "name": "RouterPaused",
      "inputs": []
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SettlementTransportUnavailable",
      "inputs": [
        {
          "name": "chainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "TradeIntentsDisabled",
      "inputs": []
    },
    {
      "type": "error",
      "name": "UnknownIntent",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "ZeroAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ZeroAmount",
      "inputs": []
    }
  ] as const,
  ArcaidiaLiquidityVault: [
    {
      "type": "constructor",
      "inputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "accruedProtocolFees",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "advancedPrincipal",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "agentNonceUsed",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "allowance",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "approve",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "asset",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "availableLiquidity",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "balanceOf",
      "inputs": [
        {
          "name": "account",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "convertToAssets",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "convertToShares",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "decimals",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint8",
          "internalType": "uint8"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "deposit",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "domainSeparator",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "fastFill",
      "inputs": [
        {
          "name": "authorization",
          "type": "tuple",
          "internalType": "struct FillAuthorization",
          "components": [
            {
              "name": "intentId",
              "type": "bytes32",
              "internalType": "bytes32"
            },
            {
              "name": "sourceChainId",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "sourceTxHash",
              "type": "bytes32",
              "internalType": "bytes32"
            },
            {
              "name": "recipient",
              "type": "address",
              "internalType": "address"
            },
            {
              "name": "inputAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "outputAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "feeAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "expiry",
              "type": "uint64",
              "internalType": "uint64"
            },
            {
              "name": "nonce",
              "type": "uint256",
              "internalType": "uint256"
            }
          ]
        },
        {
          "name": "signature",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "outputs": [
        {
          "name": "signer",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "hashFillAuthorization",
      "inputs": [
        {
          "name": "authorization",
          "type": "tuple",
          "internalType": "struct FillAuthorization",
          "components": [
            {
              "name": "intentId",
              "type": "bytes32",
              "internalType": "bytes32"
            },
            {
              "name": "sourceChainId",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "sourceTxHash",
              "type": "bytes32",
              "internalType": "bytes32"
            },
            {
              "name": "recipient",
              "type": "address",
              "internalType": "address"
            },
            {
              "name": "inputAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "outputAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "feeAmount",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "expiry",
              "type": "uint64",
              "internalType": "uint64"
            },
            {
              "name": "nonce",
              "type": "uint256",
              "internalType": "uint256"
            }
          ]
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initialize",
      "inputs": [
        {
          "name": "owner_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "asset_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "reserveFloorBps_",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "initialized",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "intentFilled",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isAuthorisedSigner",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isFilled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "liquidBalance",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "lpLiquidBalance",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "market",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxDeposit",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxExposureBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxFeeBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxFillAmount",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxFillBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxMint",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxOutstandingExposure",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxRedeem",
      "inputs": [
        {
          "name": "shareOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxWithdraw",
      "inputs": [
        {
          "name": "shareOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "mint",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "name",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "outstandingExposure",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "owner",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "paused",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "previewDeposit",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "previewMint",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "previewRedeem",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "previewWithdraw",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "protocolFeeShareBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "recordReimbursement",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "redeem",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "shareOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "reserveFloor",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "reserveFloorBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "setAuthorisedSigner",
      "inputs": [
        {
          "name": "signer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "allowed",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setFillLimits",
      "inputs": [
        {
          "name": "maxFillBps_",
          "type": "uint16",
          "internalType": "uint16"
        },
        {
          "name": "maxExposureBps_",
          "type": "uint16",
          "internalType": "uint16"
        },
        {
          "name": "maxFeeBps_",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setMarket",
      "inputs": [
        {
          "name": "market_",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setPaused",
      "inputs": [
        {
          "name": "paused_",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setProtocolFeeShareBps",
      "inputs": [
        {
          "name": "bps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setReserveFloorBps",
      "inputs": [
        {
          "name": "bps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setSettlementReceiver",
      "inputs": [
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setTreasury",
      "inputs": [
        {
          "name": "treasury_",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settlementReceiver",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "symbol",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "totalAssets",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "totalSupply",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "transfer",
      "inputs": [
        {
          "name": "to",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "transferFrom",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "transferOwnership",
      "inputs": [
        {
          "name": "newOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "treasury",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "utilisationBps",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "withdraw",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "shareOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "withdrawFees",
      "inputs": [],
      "outputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "withdrawableLiquidity",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "Approval",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "spender",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "AuthorisedSignerSet",
      "inputs": [
        {
          "name": "signer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "allowed",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Deposit",
      "inputs": [
        {
          "name": "caller",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "receiver",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "assets",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "shares",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FastFilled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "recipient",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "signer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "inputAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "outputAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "feeAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FeesAccrued",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "toProtocol",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "toLps",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FeesWithdrawn",
      "inputs": [
        {
          "name": "treasury",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FillLimitsConfigured",
      "inputs": [
        {
          "name": "maxFillBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        },
        {
          "name": "maxExposureBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        },
        {
          "name": "maxFeeBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FillRecorded",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "recipient",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "outputAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MarketConfigured",
      "inputs": [
        {
          "name": "market",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "OwnerTransferred",
      "inputs": [
        {
          "name": "previousOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "newOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "PausedSet",
      "inputs": [
        {
          "name": "paused",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "ProtocolFeeShareConfigured",
      "inputs": [
        {
          "name": "protocolFeeShareBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "ReimbursementRecorded",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "amountReceived",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "exposureCleared",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "ReserveFloorConfigured",
      "inputs": [
        {
          "name": "reserveFloorBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "SettlementReceiverConfigured",
      "inputs": [
        {
          "name": "settlementReceiver",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Transfer",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "TreasuryConfigured",
      "inputs": [
        {
          "name": "treasury",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "VaultInitialized",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "asset",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "reserveFloorBps",
          "type": "uint16",
          "indexed": false,
          "internalType": "uint16"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Withdraw",
      "inputs": [
        {
          "name": "caller",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "receiver",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "shareOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "assets",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "shares",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AgentNonceAlreadyUsed",
      "inputs": [
        {
          "name": "nonce",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "AlreadyInitialized",
      "inputs": []
    },
    {
      "type": "error",
      "name": "AmountsInconsistent",
      "inputs": [
        {
          "name": "inputAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "outputAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "feeAmount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "AuthorizationExpired",
      "inputs": [
        {
          "name": "expiry",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "nowTimestamp",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "BpsAboveDenominator",
      "inputs": [
        {
          "name": "bps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ]
    },
    {
      "type": "error",
      "name": "ECDSAInvalidSignature",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ECDSAInvalidSignatureLength",
      "inputs": [
        {
          "name": "length",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ECDSAInvalidSignatureS",
      "inputs": [
        {
          "name": "s",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InsufficientAllowance",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "allowance",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "needed",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InsufficientBalance",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "balance",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "needed",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidApprover",
      "inputs": [
        {
          "name": "approver",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidReceiver",
      "inputs": [
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidSender",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidSpender",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ExceedsMaxDeposit",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "max",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ExceedsMaxRedeem",
      "inputs": [
        {
          "name": "shares",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "max",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ExceedsMaxWithdraw",
      "inputs": [
        {
          "name": "assets",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "max",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ExposureCapExceeded",
      "inputs": [
        {
          "name": "attempted",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "cap",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "FeeAboveProtocolCeiling",
      "inputs": [
        {
          "name": "feeAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "ceiling",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "FillAboveCap",
      "inputs": [
        {
          "name": "outputAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "cap",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "InsufficientLiquidity",
      "inputs": [
        {
          "name": "requested",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "available",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAlreadyFilled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAlreadySettledCanonically",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentNotFilled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "NoFeesAccrued",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NoMarketConfigured",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotOwner",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotSettlementReceiver",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ReentrancyGuardReentrantCall",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ReimbursementBelowPrincipal",
      "inputs": [
        {
          "name": "received",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "principal",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ReserveFloorTooHigh",
      "inputs": [
        {
          "name": "bps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ]
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ShareAboveDenominator",
      "inputs": [
        {
          "name": "bps",
          "type": "uint16",
          "internalType": "uint16"
        }
      ]
    },
    {
      "type": "error",
      "name": "SignerNotAuthorised",
      "inputs": [
        {
          "name": "signer",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "TreasuryNotSet",
      "inputs": []
    },
    {
      "type": "error",
      "name": "VaultPaused",
      "inputs": []
    },
    {
      "type": "error",
      "name": "WrongDestinationChain",
      "inputs": [
        {
          "name": "sourceChainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ZeroAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ZeroAmount",
      "inputs": []
    }
  ] as const,
  SettlementReceiver: [
    {
      "type": "function",
      "name": "asset",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initialize",
      "inputs": [
        {
          "name": "owner_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "asset_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "market_",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "initialized",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isReporter",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isSettled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "market",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IIntentMarket"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "outcomeOf",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint8",
          "internalType": "enum SettlementReceiver.Outcome"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "owner",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "setReporter",
      "inputs": [
        {
          "name": "reporter",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "allowed",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settle",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "fallbackRecipient",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "outcome",
          "type": "uint8",
          "internalType": "enum SettlementReceiver.Outcome"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settledAmount",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "transferOwnership",
      "inputs": [
        {
          "name": "newOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "LpReimbursed",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "vault",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "ReceiverInitialized",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "asset",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "market",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "RecipientPaidByFallback",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "recipient",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "ReporterSet",
      "inputs": [
        {
          "name": "reporter",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "allowed",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyInitialized",
      "inputs": []
    },
    {
      "type": "error",
      "name": "AlreadySettled",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "InsufficientCanonicalFunds",
      "inputs": [
        {
          "name": "requested",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "held",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "NotOwner",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotReporter",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ReentrancyGuardReentrantCall",
      "inputs": []
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ZeroAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ZeroAmount",
      "inputs": []
    }
  ] as const,
  ArcaidiaIntentMarket: [
    {
      "type": "constructor",
      "inputs": [
        {
          "name": "settlementCheck_",
          "type": "address",
          "internalType": "contract ISettlementCheck"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "MAX_FEE_BPS",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint16",
          "internalType": "uint16"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "claimIntent",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "outputAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "feeAmount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "filledBy",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "settlementCheck",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract ISettlementCheck"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "IntentClaimed",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "vault",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "outputAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "feeAmount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "FeeAboveUniversalCeiling",
      "inputs": [
        {
          "name": "feeAmount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "ceiling",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAlreadyClaimed",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "claimedBy",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "IntentAlreadySettledCanonically",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    }
  ] as const,
  ArcaidiaDeployer: [
    {
      "type": "function",
      "name": "deploy",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "creationCode",
          "type": "bytes",
          "internalType": "bytes"
        },
        {
          "name": "initCall",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "outputs": [
        {
          "name": "deployed",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "isDeployed",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "creationCodeHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "predictAddress",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "creationCodeHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "predictAddressFor",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "creationCode",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "Deployed",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "deployed",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "initialized",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AddressMismatch",
      "inputs": [
        {
          "name": "predicted",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "actual",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "DeploymentFailed",
      "inputs": [
        {
          "name": "salt",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "EmptyCreationCode",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InitializationFailed",
      "inputs": [
        {
          "name": "deployed",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "reason",
          "type": "bytes",
          "internalType": "bytes"
        }
      ]
    }
  ] as const,
  MockUSDC: [
    {
      "type": "constructor",
      "inputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "allowance",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "approve",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "balanceOf",
      "inputs": [
        {
          "name": "account",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "burn",
      "inputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "decimals",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint8",
          "internalType": "uint8"
        }
      ],
      "stateMutability": "pure"
    },
    {
      "type": "function",
      "name": "mint",
      "inputs": [
        {
          "name": "to",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "name",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "symbol",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "totalSupply",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "transfer",
      "inputs": [
        {
          "name": "to",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "transferFrom",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "Approval",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "spender",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Transfer",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "value",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "ERC20InsufficientAllowance",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "allowance",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "needed",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InsufficientBalance",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "balance",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "needed",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidApprover",
      "inputs": [
        {
          "name": "approver",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidReceiver",
      "inputs": [
        {
          "name": "receiver",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidSender",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ERC20InvalidSpender",
      "inputs": [
        {
          "name": "spender",
          "type": "address",
          "internalType": "address"
        }
      ]
    }
  ] as const,
  MockSettlementInitiator: [
    {
      "type": "function",
      "name": "hookDataOf",
      "inputs": [
        {
          "name": "",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initiateSettlement",
      "inputs": [
        {
          "name": "asset",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationReceiver",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "hookData",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "outputs": [
        {
          "name": "settlementRef",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setShouldSucceed",
      "inputs": [
        {
          "name": "value",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setUnsupportedDestination",
      "inputs": [
        {
          "name": "chainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "value",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "shouldSucceed",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "supportsDestination",
      "inputs": [
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "totalCommitted",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "unsupportedDestination",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "SettlementInitiated",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "settlementRef",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SettlementInitiationFailed",
      "inputs": []
    }
  ] as const,
  CircleCCTPInitiator: [
    {
      "type": "constructor",
      "inputs": [
        {
          "name": "owner_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "tokenMessenger_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "settlementAsset_",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "domainConfigured",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "domainFor",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initiateSettlement",
      "inputs": [
        {
          "name": "asset",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "destinationReceiver",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "intentId",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "hookData",
          "type": "bytes",
          "internalType": "bytes"
        }
      ],
      "outputs": [
        {
          "name": "settlementRef",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "maxFee",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "minFinalityThreshold",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "owner",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "setDomain",
      "inputs": [
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "domain",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setFinality",
      "inputs": [
        {
          "name": "minFinalityThreshold_",
          "type": "uint32",
          "internalType": "uint32"
        },
        {
          "name": "maxFee_",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settlementAsset",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "supportsDestination",
      "inputs": [
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "tokenMessenger",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract ITokenMessengerV2"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "transferOwnership",
      "inputs": [
        {
          "name": "newOwner",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "DomainConfigured",
      "inputs": [
        {
          "name": "destinationChainId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "domain",
          "type": "uint32",
          "indexed": false,
          "internalType": "uint32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "FinalityConfigured",
      "inputs": [
        {
          "name": "minFinalityThreshold",
          "type": "uint32",
          "indexed": false,
          "internalType": "uint32"
        },
        {
          "name": "maxFee",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "OwnershipTransferred",
      "inputs": [
        {
          "name": "previousOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "newOwner",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "SettlementInitiated",
      "inputs": [
        {
          "name": "intentId",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "settlementRef",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "destinationChainId",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AssetMismatch",
      "inputs": [
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "actual",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "NotOwner",
      "inputs": []
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "UnsupportedDestination",
      "inputs": [
        {
          "name": "destinationChainId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    },
    {
      "type": "error",
      "name": "ZeroAddress",
      "inputs": []
    }
  ] as const,
} as const;

export type ArcaidiaAbis = typeof ABIS;
