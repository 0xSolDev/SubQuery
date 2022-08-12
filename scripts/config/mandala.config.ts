
export default {
    network: {
        name: 'mandala-local',
        endpoint: {
            eth: 'http://localhost:8545',
            substrate: 'wss://node-6874665007342661632.lh.onfinality.io/ws?apikey=8a603978-f036-4c0d-9f69-3f850f45c8bb',
        },
        platform: 'acala',
    },
    contracts: {
        InflationController: [100, "0x4ae8fcdddc859e2984ce0b8f4ef490d61a7a9b7f"], // inflationRateBP, inflationDestination
        Staking: [1000], // LockPeriod
    }
};
