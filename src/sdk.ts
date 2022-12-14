import type { Contract, Signer } from "ethers";
import type { Provider as AbstractProvider } from '@ethersproject/abstract-provider';
import { ContractDeployment, SdkOptions } from "./types";
import {
    SQToken,
    SQToken__factory,
    Settings,
    Settings__factory,
    Staking,
    Staking__factory,
    IndexerRegistry,
    IndexerRegistry__factory,
    InflationController,
    InflationController__factory,
    QueryRegistry,
    QueryRegistry__factory,
    ServiceAgreementRegistry,
    ServiceAgreementRegistry__factory,
    EraManager,
    EraManager__factory,
    PlanManager,
    PlanManager__factory,
    RewardsDistributer,
    RewardsDistributer__factory,
} from "./typechain";

export class ContractSDK {
    static async create(
        signerOrProvider: AbstractProvider | Signer,
        options?: SdkOptions,
    ): Promise<ContractSDK> {
        const sdk = new ContractSDK(signerOrProvider, options);
        return sdk.isReady;
    }

    private _isReady: Promise<ContractSDK>;
    private _contractDeployments: ContractDeployment;

    private _settings?: Settings;
    private _sqToken?: SQToken;
    private _staking?: Staking;
    private _indexerRegistry?: IndexerRegistry;
    private _queryRegistry?: QueryRegistry;
    private _inflationController?: InflationController;
    private _serviceAgreementRegistry?: ServiceAgreementRegistry;
    private _eraManager?: EraManager;
    private _planManager?: PlanManager;
    private _rewardsDistributor?: RewardsDistributer;

    constructor(
        private readonly signerOrProvider: AbstractProvider | Signer,
        public readonly options?: SdkOptions
    ) {
        this._contractDeployments = options?.deploymentDetails || require(`./publish/${options?.network || 'testnet'}.json`);
        this._isReady = this._init().then(() => this);
    }

    get settings(): Settings {
        if (!this._settings) {
            throw new Error(`_settings address not found`);
        }
        return this._settings;
    }

    get sqToken(): SQToken {
        if (!this._sqToken) {
            throw new Error(`sqToken address not found`);
        }
        return this._sqToken;
    }

    get staking(): Staking {
        if (!this._staking) {
            throw new Error(`_staking address not found`);
        }
        return this._staking;
    }

    get indexerRegistry(): IndexerRegistry {
        if (!this._indexerRegistry) {
            throw new Error(`_indexerRegistry address not found`);
        }
        return this._indexerRegistry;
    }

    get queryRegistry(): QueryRegistry {
        if (!this._queryRegistry) {
            throw new Error(`_queryRegistry address not found`);
        }
        return this._queryRegistry;
    }

    get inflationController(): InflationController {
        if (!this._inflationController) {
            throw new Error(`_inflationController address not found`);
        }
        return this._inflationController;
    }

    get serviceAgreementRegistry(): ServiceAgreementRegistry {
        if (!this._serviceAgreementRegistry) {
            throw new Error(`_serviceAgreementRegistry address not found`);
        }
        return this._serviceAgreementRegistry;
    }

    get eraManager(): EraManager {
        if (!this._eraManager) {
            throw new Error(`_eraManager address not found`);
        }
        return this._eraManager;
    }

    get planManager(): PlanManager {
        if (!this._planManager) {
            throw new Error(`_planManager address not found`);
        }
        return this._planManager;
    }

    get rewardsDistributor(): RewardsDistributer {
        if (!this._rewardsDistributor) {
            throw new Error(`_rewardsDistributer address not found`);
        }
        return this._rewardsDistributor;
    }

    get isReady(): Promise<ContractSDK> {
        return this._isReady;
    }

    private async initContract<C extends Contract>(
        factory: { connect: (address: string, signerOrProvider: AbstractProvider | Signer) => C },
        address?: string
    ): Promise<C | undefined> {
        if (!address) {
            return undefined;
        }
        return factory.connect(address, this.signerOrProvider).deployed() as Promise<C>;
    }

    private async _init(): Promise<void> {
        const [
            settings,
            sqToken,
            staking,
            indexerRegistry,
            queryRegistry,
            inflationController,
            serviceAgreementRegistry,
            eraManager,
            planManager,
            rewardsDistributor,
        ] = await Promise.all([
            this.initContract(Settings__factory, this._contractDeployments.Settings?.address),
            this.initContract(SQToken__factory, this._contractDeployments.SQToken?.address),
            this.initContract(Staking__factory, this._contractDeployments.Staking?.address),
            this.initContract(IndexerRegistry__factory, this._contractDeployments.IndexerRegistry?.address),
            this.initContract(QueryRegistry__factory, this._contractDeployments.QueryRegistry?.address),
            this.initContract(InflationController__factory, this._contractDeployments.InflationController.address),
            this.initContract(ServiceAgreementRegistry__factory, this._contractDeployments.ServiceAgreementRegistry.address),
            this.initContract(EraManager__factory, this._contractDeployments.EraManager.address),
            this.initContract(PlanManager__factory, this._contractDeployments.PlanManager.address),
            this.initContract(RewardsDistributer__factory, this._contractDeployments.RewardsDistributer.address),
        ]);
        this._settings = settings;
        this._sqToken = sqToken;
        this._staking = staking;
        this._indexerRegistry = indexerRegistry;
        this._inflationController = inflationController;
        this._queryRegistry = queryRegistry;
        this._serviceAgreementRegistry = serviceAgreementRegistry;
        this._eraManager = eraManager;
        this._planManager = planManager;
        this._rewardsDistributor = rewardsDistributor;
    }
}
