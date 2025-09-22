# atomiq SDK demo showcase

Here you can find examples of all the things you can do with atomiq SDK

## Setup

You can check the general SDK factory and swapper setup in [/src/setup.ts](/src/setup.ts)

## Wallets

Wallets (while not necessarily being part of atomiq itself) are setup in [/src/wallets.ts](/src/wallets.ts)

## Utilities

- listening to events (swap state changes, etc.) on swapper instance: [/src/utils/events.ts](/src/utils/events.ts)
- general purpose address parsing: [/src/utils/parseAddress.ts](/src/utils/parseAddress.ts)
- checking and claiming/refunding past swaps: [/src/utils/pastSwaps.ts](/src/utils/pastSwaps.ts)
- checking supported tokens: [/src/utils/supportedTokens.ts](/src/utils/supportedTokens.ts)
- swap types and swap features: [/src/utils/swapTypes.ts](/src/utils/supportedTokens.ts)
- wallet balances getter utilities: [/src/utils/walletHelper.ts](/src/utils/walletHelper.ts)

## Swaps

### BTC -> Starknet/EVM

These swaps are using the new swap protocol, for swaps for BTC -> Solana see below for the legacy protocol

- simple/basic swap implementation: [/src/btc-to-smartchain/swapBasic.ts](/src/btc-to-smartchain/swapBasic.ts)
- advanced EVM implementation (manually signing transactions and going through swap steps): [/src/btc-to-smartchain/swapAdvancedEVM.ts](/src/btc-to-smartchain/swapAdvancedEVM.ts)
- advanced Starknet implementation (manually signing transactions and going through swap steps): [/src/btc-to-smartchain/swapAdvancedStarknet.ts](/src/btc-to-smartchain/swapAdvancedStarknet.ts)

### BTC -> Solana (legacy)

BTC -> Solana swaps are using the old/legacy swap protocol

- simple/basic swap implementation: [/src/btc-to-solana-legacy/swapBasic.ts](/src/btc-to-solana-legacy/swapBasic.ts)
- advanced Solana implementation (manually signing transactions and going through swap steps): [/src/btc-to-solana-legacy/swapAdvancedSolana.ts](/src/btc-to-solana-legacy/swapAdvancedSolana.ts)

### BTCLN (lightning) -> Starknet/EVM

These swaps are using the new swap protocol, for swaps for BTCLN -> Solana see below for the legacy protocol

- simple/basic swap implementation: [/src/btcln-to-smartchain/swapBasic.ts](/src/btcln-to-smartchain/swapBasic.ts)
- swap using LNURL-withdraw link: [/src/btcln-to-smartchain/swapBasicLNURL.ts](/src/btcln-to-smartchain/swapBasicLNURL.ts)
- advanced EVM implementation (manually signing transactions and going through swap steps): [/src/btcln-to-smartchain/swapAdvancedEVM.ts](/src/btcln-to-smartchain/swapAdvancedEVM.ts)
- advanced Starknet implementation (manually signing transactions and going through swap steps): [/src/btcln-to-smartchain/swapAdvancedStarknet.ts](/src/btcln-to-smartchain/swapAdvancedStarknet.ts)

### BTCLN (lightning) -> Solana

BTCLN -> Solana swaps are using the old/legacy swap protocol

- simple/basic swap implementation: [/src/btcln-to-solana-legacy/swapBasic.ts](/src/btcln-to-solana-legacy/swapBasic.ts)
- swap using LNURL-withdraw link: [/src/btcln-to-solana-legacy/swapBasicLNURL.ts](/src/btcln-to-solana-legacy/swapBasicLNURL.ts)
- advanced Solana implementation (manually signing transactions and going through swap steps): [/src/btcln-to-solana-legacy/swapAdvancedSolana.ts](/src/btcln-to-solana-legacy/swapAdvancedSolana.ts)

### Solana, Starknet, EVM -> BTC

Uses the same protocol for all supported chains, hence the flow is the same

- simple/basic swap implementation: [/src/smartchain-to-btc/swapBasic.ts](/src/smartchain-to-btc/swapBasic.ts)
- advanced EVM implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btc/swapAdvancedEVM.ts](/src/smartchain-to-btc/swapAdvancedEVM.ts)
- advanced Starknet implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btc/swapAdvancedStarknet.ts](/src/smartchain-to-btc/swapAdvancedStarknet.ts)
- advanced Solana implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btc/swapAdvancedSolana.ts](/src/smartchain-to-btc/swapAdvancedSolana.ts)

### Solana, Starknet, EVM -> BTCLN (lightning)

Uses the same protocol for all supported chains, hence the flow is the same

- simple/basic swap implementation: [/src/smartchain-to-btcln/swapBasic.ts](/src/smartchain-to-btcln/swapBasic.ts)
- swap using LNURL-pay link: [/src/smartchain-to-btcln/swapBasicLNURL.ts](/src/smartchain-to-btcln/swapBasicLNURL.ts)
- advanced EVM implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btcln/swapAdvancedEVM.ts](/src/smartchain-to-btcln/swapAdvancedEVM.ts)
- advanced Starknet implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btcln/swapAdvancedStarknet.ts](/src/smartchain-to-btcln/swapAdvancedStarknet.ts)
- advanced Solana implementation (manually signing transactions and going through swap steps): [/src/smartchain-to-btcln/swapAdvancedSolana.ts](/src/smartchain-to-btcln/swapAdvancedSolana.ts)
