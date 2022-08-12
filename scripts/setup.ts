import {calcEthereumTransactionParams, EvmRpcProvider} from '@acala-network/eth-providers';
import { Overrides, providers, utils, Wallet } from 'ethers';
import dotenv from "dotenv"
import moduleAlias from 'module-alias';
import { AcalaDeploymentConfig, DeploymentConfig, MoonbeamDeploymentConfig } from "../src/types";
import assert from "assert";

dotenv.config();
// nodejs doesn't understand rootDirs in tsconfig, use moduleAlias to workaround
moduleAlias.addAlias('./publish', `${__dirname}/../publish`);

const seed = process.env.SEED;

async function setupAcala({endpoint}: AcalaDeploymentConfig["network"]) {
    assert(seed, 'Not found SEED in env');
    const hdNode = utils.HDNode.fromMnemonic(seed).derivePath("m/44'/60'/0'/0/0");
    const provider = EvmRpcProvider.from(endpoint.substrate);
    const network = await provider.isReady();
    const ethProvider = new providers.StaticJsonRpcProvider(endpoint.eth, network);
    const wallet = new Wallet(hdNode, provider);
    const txFeePerGas = provider.api.consts.evm.txFeePerGas.toString();
    const storageByteDeposit = provider.api.consts.evm.storageDepositPerByte.toString();
    const currentHeight = await provider.getBlockNumber();
    const { txGasLimit, txGasPrice } = calcEthereumTransactionParams({
        gasLimit: 10000001n,
        validUntil: currentHeight + 1000,
        storageLimit: 64001n,
        txFeePerGas,
        storageByteDeposit
    });
    const overrides: Overrides = {
        gasLimit: txGasLimit,
        gasPrice: txGasPrice,
        type: 0,
    }
    return {
        wallet, ethProvider, provider, overrides
    };
}

async function setupMoonbeam({endpoint, providerConfig}: MoonbeamDeploymentConfig['network']) {
    assert(seed, 'Not found SEED in env');
    const hdNode = utils.HDNode.fromMnemonic(seed).derivePath("m/44'/60'/0'/0/0");
    const provider = new providers.StaticJsonRpcProvider(endpoint, providerConfig);
    const wallet = new Wallet(hdNode, provider);
    return {
        wallet, provider, overrides: {}
    };
}

const setup = async (networkConfig: DeploymentConfig['network']) => {
    if (networkConfig.platform === 'acala') {
        return setupAcala(networkConfig);
    } else if (networkConfig.platform === 'moonbeam') {
        return setupMoonbeam(networkConfig);
    } else {
        throw new Error(`platform ${(networkConfig as any).platform} not supported`)
    }
}

export default setup;
