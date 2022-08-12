import {writeFileSync} from 'fs';
import setup from './setup';
import {DeploymentConfig} from '../src/types';
import localConfig from './config/local.config';
import testnetConfig from './config/testnet.config';
import mandalaConfig from './config/mandala.config';
import mainnetConfig from './config/mainnet.config';
import {EvmRpcProvider} from '@acala-network/eth-providers';
import {deployContracts} from './deployContracts';

const main = async () => {
    let config: DeploymentConfig;

    switch (process.argv[2]) {
        case '--mainnet':
            config = mainnetConfig as DeploymentConfig;
            break;
        case '--testnet':
            config = testnetConfig as DeploymentConfig;
            break;
        case '--mandala':
            config = mandalaConfig as DeploymentConfig;
            break;
        default:
            config = localConfig();
    }
    if (process.env.ENDPOINT) {
        console.log(`use overiden endpoint ${process.env.ENDPOINT}`);
        config.network.endpoint = process.env.ENDPOINT;
    }
    const {wallet, provider, overrides} = await setup(config.network);

    const [deployment] = await deployContracts(wallet, config.contracts, overrides);

    let filePath = `${__dirname}/../publish/${config.network.name}.json`;
    writeFileSync(filePath, JSON.stringify(deployment, null, 4));
    console.log('Exported the deployment result to ', filePath);

    if ((provider as EvmRpcProvider).api) {
        await (provider as EvmRpcProvider).api.disconnect();
    }
};

main();
