import assert from "assert";
import dotenv from 'dotenv';
import { DeploymentConfig } from "../../src";

dotenv.config();
const platform = process.env.PLATFORM;
const endpoint = process.env.ENDPOINT;

export default function localConfig(): DeploymentConfig {
    assert(platform, 'Not found PLATFORM in env');
    assert(endpoint, 'Not found ENDPOINT in env');
    return {
        network: {
            name: 'local',
            endpoint: {
                eth: 'http://localhost:8545',
                substrate: 'ws://localhost:9944',
            },
            platform: 'acala',
        },
        contracts: {
            InflationController: [100, "0x4ae8fcdddc859e2984ce0b8f4ef490d61a7a9b7f"], // inflationRateBP, inflationDestination
            Staking: [1000], // LockPeriod
        }
    };
}
