// Ports mev_inspect/classifiers/helpers.py. These build Swap / NftTrade / eth
// Transfer records from the ERC-20 transfers reconstructed around a call — the
// protocol-agnostic core of swap detection (a swap is "tokens went into the
// pool, other tokens came back to the recipient"). Import-only on ./types to
// keep specs free of pipeline-module cycles.
import {
  type DecodedCallTrace,
  ETH_TOKEN_ADDRESS,
  type NftTrade,
  type Protocol,
  type Swap,
  type Transfer,
} from "../types.js";

export function filterTransfers(
  transfers: Transfer[],
  opts: { toAddress?: string; fromAddress?: string },
): Transfer[] {
  return transfers.filter((transfer) => {
    if (opts.toAddress !== undefined && transfer.toAddress !== opts.toAddress) return false;
    if (opts.fromAddress !== undefined && transfer.fromAddress !== opts.fromAddress) return false;
    return true;
  });
}

export function buildEthTransfer(trace: DecodedCallTrace): Transfer {
  return {
    blockNumber: trace.blockNumber,
    transactionHash: trace.transactionHash,
    traceAddress: trace.traceAddress,
    amount: trace.value ?? 0n,
    toAddress: trace.toAddress,
    fromAddress: trace.fromAddress,
    tokenAddress: ETH_TOKEN_ADDRESS,
  };
}

export function createSwapFromPoolTransfers(
  trace: DecodedCallTrace,
  recipientAddress: string,
  priorTransfers: Transfer[],
  childTransfers: Transfer[],
): Swap | null {
  const poolAddress = trace.toAddress;

  let transfersToPool: Transfer[] = [];
  if (trace.value !== null && trace.value > 0n) {
    transfersToPool = [buildEthTransfer(trace)];
  }
  if (transfersToPool.length === 0) {
    transfersToPool = filterTransfers(priorTransfers, { toAddress: poolAddress });
  }
  if (transfersToPool.length === 0) {
    transfersToPool = filterTransfers(childTransfers, { toAddress: poolAddress });
  }
  if (transfersToPool.length === 0) return null;

  const transfersFromPoolToRecipient = filterTransfers(childTransfers, {
    toAddress: recipientAddress,
    fromAddress: poolAddress,
  });
  if (transfersFromPoolToRecipient.length !== 1) return null;

  const transferIn = transfersToPool[transfersToPool.length - 1];
  const transferOut = transfersFromPoolToRecipient[0];
  if (transferIn.tokenAddress === transferOut.tokenAddress) return null;

  return {
    abiName: trace.abiName,
    transactionHash: trace.transactionHash,
    transactionPosition: trace.transactionPosition,
    blockNumber: trace.blockNumber,
    traceAddress: trace.traceAddress,
    contractAddress: poolAddress,
    protocol: trace.protocol as Protocol,
    fromAddress: transferIn.fromAddress,
    toAddress: transferOut.toAddress,
    tokenInAddress: transferIn.tokenAddress,
    tokenInAmount: transferIn.amount,
    tokenOutAddress: transferOut.tokenAddress,
    tokenOutAmount: transferOut.amount,
    error: trace.error,
  };
}

export function createSwapFromRecipientTransfers(
  trace: DecodedCallTrace,
  poolAddress: string,
  recipientAddress: string,
  priorTransfers: Transfer[],
  childTransfers: Transfer[],
): Swap | null {
  const transfersFromRecipient = filterTransfers([...priorTransfers, ...childTransfers], {
    fromAddress: recipientAddress,
  });
  const transfersToRecipient = filterTransfers(childTransfers, { toAddress: recipientAddress });

  if (transfersFromRecipient.length !== 1 || transfersToRecipient.length !== 1) return null;

  const transferIn = transfersFromRecipient[0];
  const transferOut = transfersToRecipient[0];

  return {
    abiName: trace.abiName,
    transactionHash: trace.transactionHash,
    transactionPosition: trace.transactionPosition,
    blockNumber: trace.blockNumber,
    traceAddress: trace.traceAddress,
    contractAddress: poolAddress,
    protocol: trace.protocol as Protocol,
    fromAddress: transferIn.fromAddress,
    toAddress: transferOut.toAddress,
    tokenInAddress: transferIn.tokenAddress,
    tokenInAmount: transferIn.amount,
    tokenOutAddress: transferOut.tokenAddress,
    tokenOutAmount: transferOut.amount,
    error: trace.error,
  };
}

export function createNftTradeFromTransfers(
  trace: DecodedCallTrace,
  childTransfers: Transfer[],
  collectionAddress: string,
  sellerAddress: string,
  buyerAddress: string,
  exchangeWalletAddress: string,
): NftTrade | null {
  const transfersToBuyer = filterTransfers(childTransfers, { toAddress: buyerAddress });
  const transfersToSeller = filterTransfers(childTransfers, { toAddress: sellerAddress });

  if (transfersToBuyer.length !== 1 || transfersToSeller.length !== 1) return null;
  if (transfersToBuyer[0].tokenAddress !== collectionAddress) return null;

  const paymentTokenAddress = transfersToSeller[0].tokenAddress;
  let paymentAmount = transfersToSeller[0].amount;
  const tokenId = transfersToBuyer[0].amount;

  const feeTransfers = [
    ...filterTransfers(childTransfers, {
      fromAddress: sellerAddress,
      toAddress: exchangeWalletAddress,
    }),
    ...filterTransfers(childTransfers, {
      fromAddress: buyerAddress,
      toAddress: exchangeWalletAddress,
    }),
  ];
  // Assumes exchange fees are paid in the same token as the sale.
  for (const fee of feeTransfers) paymentAmount -= fee.amount;

  return {
    abiName: trace.abiName,
    transactionHash: trace.transactionHash,
    transactionPosition: trace.transactionPosition,
    blockNumber: trace.blockNumber,
    traceAddress: trace.traceAddress,
    protocol: trace.protocol,
    error: trace.error,
    sellerAddress,
    buyerAddress,
    paymentTokenAddress,
    paymentAmount,
    collectionAddress,
    tokenId,
  };
}

export function getReceivedTransfer(
  liquidator: string,
  childTransfers: Transfer[],
): Transfer | null {
  // Transfer from the protocol to the liquidator.
  return childTransfers.find((t) => t.toAddress === liquidator) ?? null;
}

export function getDebtTransfer(liquidator: string, childTransfers: Transfer[]): Transfer | null {
  // Transfer from the liquidator to the protocol.
  return childTransfers.find((t) => t.fromAddress === liquidator) ?? null;
}
