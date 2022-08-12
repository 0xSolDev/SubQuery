import {ContractFactory, Contract, Overrides} from 'ethers';
import sha256 from 'sha256';
import CONTRACTS from '../src/contracts';
import {ContractDeployment, DeploymentConfig} from '../src/types';
import {Wallet} from '@ethersproject/wallet';

import {
    ProxyAdmin,
    ProxyAdmin__factory,
    AdminUpgradeabilityProxy__factory,
    InflationController__factory,
    Staking__factory,
    IndexerRegistry__factory,
    QueryRegistry__factory,
    InflationController,
    Staking,
    Settings__factory,
    QueryRegistry,
    PlanManager__factory,
    SQToken__factory,
    ServiceAgreementRegistry__factory,
    ServiceAgreementRegistry,
    EraManager__factory,
    PurchaseOfferMarket__factory,
    Settings,
    SQToken,
    EraManager,
    IndexerRegistry,
    PlanManager,
    PurchaseOfferMarket,
    RewardsDistributer,
    RewardsDistributer__factory,
} from '../src';

interface FactoryContstructor {
    new (wallet: Wallet): ContractFactory;
    readonly abi: any;
}

type Contracts = {
    proxyAdmin: ProxyAdmin;
    settings: Settings;
    inflationController: InflationController;
    token: SQToken;
    staking: Staking;
    eraManager: EraManager;
    indexerRegistry: IndexerRegistry;
    queryRegistry: QueryRegistry;
    planManager: PlanManager;
    purchaseOfferMarket: PurchaseOfferMarket;
    serviceAgreementRegistry: ServiceAgreementRegistry;
    rewardsDistributer: RewardsDistributer;
};

export const deployProxy = async <C extends Contract>(
    proxyAdmin: ProxyAdmin,
    ContractFactory: FactoryContstructor,
    wallet: Wallet,
    overrides: any
): Promise<C> => {
    const contractFactory = new ContractFactory(wallet);
    let contractLogic = await contractFactory.deploy(overrides);
    await contractLogic.deployTransaction.wait();

    const adminUpgradabilityProxyFactory = new AdminUpgradeabilityProxy__factory(wallet);

    const contractProxy = await adminUpgradabilityProxyFactory.deploy(
        contractLogic.address,
        proxyAdmin.address,
        [],
        overrides
    );
    await contractProxy.deployTransaction.wait();

    const proxy = contractFactory.attach(contractProxy.address) as C;
    (proxy as any).deployTransaction = contractLogic.deployTransaction;
    return proxy;
};

function updateDeployment(deployment: Partial<ContractDeployment>, name: keyof ContractDeployment, contract: Contract) {
    if (process.env.DEBUG) {
        console.log(`${name} deploy ${contract.address}`);
    }
    if (process.env.DEPLOY_PRINT === 'true') {
        console.log(`${name} ${contract.address} deployed at tx ${contract.deployTransaction.hash}`);
    }
    deployment[name] = {
        address: contract.address,
        bytecodeHash: sha256(Buffer.from(CONTRACTS[name].bytecode, 'hex')),
        txHash: contract.deployTransaction.hash,
        lastUpdate: new Date().toUTCString(),
    };
}

export async function deployContracts(
    wallet: Wallet,
    config: DeploymentConfig['contracts'],
    overrides: Overrides | {} = {}
): Promise<[Partial<ContractDeployment>, Contracts]> {
    const deployment: Partial<ContractDeployment> = {};
    if (process.env.DEBUG) {
        console.log(`deploy start, from wallet ${wallet.address}`);
    }
    const proxyAdmin = await new ProxyAdmin__factory(wallet).deploy(overrides);
    await proxyAdmin.deployTransaction.wait();
    updateDeployment(deployment, 'ProxyAdmin', proxyAdmin);
    if (process.env.DEBUG) {
        console.log(`proxyAdmin deploy ${proxyAdmin.address}`);
    }
    // deploy settings contract
    const settings = await new Settings__factory(wallet).deploy(overrides);
    await settings.deployTransaction.wait();
    updateDeployment(deployment, 'Settings', settings);
    // deploy InflationController contract
    const inflationController = await deployProxy<InflationController>(
        proxyAdmin,
        InflationController__factory,
        wallet,
        overrides
    );
    const inflationInit = await inflationController.initialize(
        deployment.Settings.address,
        ...(config['InflationController'] as [number, string]),
        overrides
    );
    await inflationInit.wait();
    updateDeployment(deployment, 'InflationController', inflationController);

    // deploy SQToken contract
    const sqtToken = await new SQToken__factory(wallet).deploy(deployment.InflationController.address, overrides);
    await sqtToken.deployTransaction.wait();
    updateDeployment(deployment, 'SQToken', sqtToken);

    // deploy Staking contract
    const staking = await deployProxy<Staking>(proxyAdmin, Staking__factory, wallet, overrides);
    const initStaking = await staking.initialize(
        ...(config['Staking'] as [number]),
        deployment.Settings.address,
        overrides
    );
    await initStaking.wait();
    updateDeployment(deployment, 'Staking', staking);

    // deploy Era manager
    const eraManager = await deployProxy<EraManager>(proxyAdmin, EraManager__factory, wallet, overrides);
    const eraManagerInit = await eraManager.initialize(
        deployment.Settings.address,
        ...(config['EraManager'] as [number]),
        overrides
    );
    await eraManagerInit.wait();
    updateDeployment(deployment, 'EraManager', eraManager);

    // deploy IndexerRegistry contract
    const indexerRegistry = await deployProxy<IndexerRegistry>(proxyAdmin, IndexerRegistry__factory, wallet, overrides);
    const initIndexer = await indexerRegistry.initialize(deployment.Settings.address, overrides);
    await initIndexer.wait();
    updateDeployment(deployment, 'IndexerRegistry', indexerRegistry);

    // deploy QueryRegistry contract
    const queryRegistry = await deployProxy<QueryRegistry>(proxyAdmin, QueryRegistry__factory, wallet, overrides);
    const initQuery = await queryRegistry.initialize(deployment.Settings.address, overrides);
    await initQuery.wait();
    updateDeployment(deployment, 'QueryRegistry', queryRegistry);

    const planManager = await deployProxy<PlanManager>(proxyAdmin, PlanManager__factory, wallet, overrides);
    const initPlanManager = await planManager.initialize(deployment.Settings.address, overrides);
    await initPlanManager.wait();
    updateDeployment(deployment, 'PlanManager', planManager);

    const purchaseOfferMarket = await deployProxy<PurchaseOfferMarket>(
        proxyAdmin,
        PurchaseOfferMarket__factory,
        wallet,
        overrides
    );
    const purchaseOfferMarketInit = await purchaseOfferMarket.initialize(deployment.Settings.address, overrides);
    await purchaseOfferMarketInit.wait();
    updateDeployment(deployment, 'PurchaseOfferMarket', purchaseOfferMarket);

    const serviceAgreementRegistry = await deployProxy<ServiceAgreementRegistry>(
        proxyAdmin,
        ServiceAgreementRegistry__factory,
        wallet,
        overrides
    );
    const initSARegistry = await serviceAgreementRegistry.initialize(deployment.Settings.address, [
        planManager.address,
        purchaseOfferMarket.address,
    ]);
    await initSARegistry.wait();
    updateDeployment(deployment, 'ServiceAgreementRegistry', serviceAgreementRegistry);

    const rewardsDistributer = await deployProxy<RewardsDistributer>(
        proxyAdmin,
        RewardsDistributer__factory,
        wallet,
        overrides
    );
    const initRewardsDistributer = await rewardsDistributer.initialize(deployment.Settings.address, overrides);
    await initRewardsDistributer.wait();
    updateDeployment(deployment, 'RewardsDistributer', rewardsDistributer);

    // Register addresses on settings contract
    const txObj = await settings.setAllAddresses(
        deployment.SQToken.address,
        deployment.Staking.address,
        deployment.IndexerRegistry.address,
        deployment.QueryRegistry.address,
        deployment.EraManager.address,
        deployment.PlanManager.address,
        deployment.ServiceAgreementRegistry.address,
        deployment.RewardsDistributer.address,
        overrides as any
    );

    await txObj.wait();

    return [
        deployment,
        {
            settings,
            inflationController,
            token: sqtToken,
            staking,
            eraManager,
            indexerRegistry,
            queryRegistry,
            planManager,
            purchaseOfferMarket,
            serviceAgreementRegistry,
            rewardsDistributer,
            proxyAdmin,
        },
    ];
}
