import {MockProvider} from 'ethereum-waffle';
import {BigNumber, Contract, Wallet, utils} from 'ethers';
import {IndexerRegistry, EraManager} from '../typechain';
import {METADATA_HASH} from './constants';
const {constants, time} = require('@openzeppelin/test-helpers');

export {constants, time};

export async function timeTravel(provider: MockProvider, seconds: number) {
    await provider.send('evm_increaseTime', [seconds]);
    await provider.send('evm_mine', []);
}

export async function lastestBlock(provider: MockProvider) {
    const blockBefore = await provider.send('eth_getBlockByNumber', ['latest', false]);
    return blockBefore;
}

export async function lastestTime(provider: MockProvider) {
    const block = await lastestBlock(provider);
    return BigNumber.from(block.timestamp).toNumber();
}

export function getCurrentTime() {
    return new Date().getTime();
}

export function futureTimestamp() {
    return Math.floor((new Date().getTime() + 1000 * 60 * 5) / 1000);
}

// contract call helpers
export async function registerIndexer(
    token: Contract,
    indexerRegistry: IndexerRegistry,
    staking: Contract,
    rootWallet: Wallet,
    wallet: Wallet
) {
    const amount = 1000000000;
    await token.connect(rootWallet).transfer(wallet.address, amount);
    await token.connect(wallet).increaseAllowance(staking.address, amount);
    await indexerRegistry.connect(wallet).registerIndexer(amount, METADATA_HASH, 0, {gasLimit: '2000000'});
}

export async function createPurchaseOffer(purchaseOfferMarket: Contract, deploymentId: string) {
    await purchaseOfferMarket.createPurchaseOffer(deploymentId, 0, 100, 2, 100, futureTimestamp(), 1000, true);
}

export async function startNewEra(mockProvider: MockProvider, eraManager: EraManager): Promise<BigNumber> {
    const eraPeroid = await eraManager.eraPeriod();
    await timeTravel(mockProvider, eraPeroid.toNumber() + 10);
    await eraManager.startNewEra();
    return eraManager.eraNumber();
}

export async function delay(sec: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

export function cidToBytes32(cid: string): string {
    return '0x' + Buffer.from(utils.base58.decode(cid)).slice(2).toString('hex');
}
