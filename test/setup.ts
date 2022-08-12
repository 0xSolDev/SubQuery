import {TestAccountSigningKey, Provider, Signer} from '@acala-network/bodhi';
import {Wallet} from '@ethersproject/wallet';
import {WsProvider} from '@polkadot/api';
import {createTestPairs} from '@polkadot/keyring/testingPairs';

import {deployContracts as deploy} from '../scripts/deployContracts';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:9944';

const setup = async () => {
    const provider = new Provider({
        provider: new WsProvider(WS_URL),
    });

    await provider.api.isReady;

    const testPairs = createTestPairs();
    const signingKey = new TestAccountSigningKey(provider.api.registry);
    const testSigners = Object.keys(testPairs).reduce<{
        [key: string]: Signer;
    }>((acc, key) => {
        const pair = testPairs[key];
        signingKey.addKeyringPair(pair);
        acc[key] = new Signer(provider, pair.address, signingKey);
        return acc;
    }, {});

    return {
        testSigners,
        provider,
    };
};

export const deployContracts = async (wallet: Wallet, wallet1: Wallet) => {
    const [_, contracts] = await deploy(wallet, {
        InflationController: [10, wallet1.address],
        Staking: [1000],
        EraManager: [60 * 60 * 24],
    });

    return contracts;
};

export default setup;
