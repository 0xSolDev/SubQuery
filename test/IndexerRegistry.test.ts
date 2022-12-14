import { expect, use } from "chai";
import { BigNumber, Wallet } from "ethers";
import { MockProvider, solidity } from "ethereum-waffle";
import { deployContracts } from "./setup";
import {
    METADATA_HASH,
    METADATA_1_HASH,
    VERSION,
    DEPLOYMENT_ID,
} from "./constants";
import { describe } from "mocha";
import { startNewEra } from "./helper";
import {
    EraManager,
    IndexerRegistry,
    SQToken,
    QueryRegistry,
    Staking,
    RewardsDistributer,
} from "../typechain";

const { constants } = require("@openzeppelin/test-helpers");

use(solidity);

describe("IndexerRegistry Contract", () => {
    let mockProvider = new MockProvider();
    const [wallet_0, wallet_1, wallet_2] = mockProvider.getWallets();
    const COMMISSION_RATE_MULTIPLIER = 1e3;
    const indexer = wallet_0.address;

    let token: SQToken;
    let staking: Staking;
    let queryRegistry: QueryRegistry;
    let indexerRegistry: IndexerRegistry;
    let eraManager: EraManager;
    let rewardsDistributer: RewardsDistributer;

    const registerIndexer = async (wallet: Wallet) => {
        await token.connect(wallet_0).transfer(wallet.address, 2000000000);
        await token
            .connect(wallet)
            .increaseAllowance(staking.address, 2000000000);
        const tx = await indexerRegistry
            .connect(wallet)
            .registerIndexer(1000000000, METADATA_HASH, 0);
        return tx;
    };

    const checkControllerIsEmpty = async () => {
        expect(
            await indexerRegistry.indexerToController(wallet_0.address)
        ).to.equal(constants.ZERO_ADDRESS);
        expect(
            await indexerRegistry.controllerToIndexer(wallet_2.address)
        ).to.equal(constants.ZERO_ADDRESS);
    };

    beforeEach(async () => {
        const deployment = await deployContracts(wallet_0, wallet_1);
        token = deployment.token;
        staking = deployment.staking;
        queryRegistry = deployment.queryRegistry;
        indexerRegistry = deployment.indexerRegistry;
        eraManager = deployment.eraManager;
        rewardsDistributer = deployment.rewardsDistributer;
        await registerIndexer(wallet_0);
    });

    describe("Indexer Registry", () => {
        it("register indexer should work", async () => {
            await expect(registerIndexer(wallet_1))
                .to.be.emit(indexerRegistry, "RegisterIndexer")
                .withArgs(wallet_1.address, 1000000000, METADATA_HASH);

            // check state changes
            expect(await indexerRegistry.isIndexer(wallet_1.address)).to.equal(
                true
            );
            expect(
                await indexerRegistry.metadataByIndexer(wallet_1.address)
            ).to.equal(METADATA_HASH);
        });

        it("staking by indexer should work", async () => {
            await expect(indexerRegistry.stake(1000))
                .to.be.emit(indexerRegistry, "Stake")
                .withArgs(indexer, 1000);
            // check staking changes
            await startNewEra(mockProvider, eraManager);
            expect(
                await staking.getDelegationAmount(indexer, indexer)
            ).to.equal(1000001000);
        });

        it("unstaking by indexer should work", async () => {
            await expect(indexerRegistry.unstake(1000))
                .to.be.emit(indexerRegistry, "Unstake")
                .withArgs(indexer, 1000);
            // check staking changes
            await startNewEra(mockProvider, eraManager);
            expect(
                await staking.getDelegationAmount(indexer, indexer)
            ).to.equal(999999000);
        });

        it("staking by indexer with invalid caller should fail", async () => {
            // not indexer
            await expect(
                indexerRegistry.connect(wallet_1).stake(1000)
            ).to.be.revertedWith("Not registered");
        });

        it("unstaking by indexer with invalid params should fail", async () => {
            // not indexer
            await expect(
                indexerRegistry.connect(wallet_1).unstake(1000)
            ).to.be.revertedWith("Not registered");
            // amount execess minum requirement
            await expect(
                indexerRegistry.unstake(1000000000)
            ).to.be.revertedWith(
                "Existential amount should be greater than minimum amount"
            );
        });

        it("registered indexer reregister should fail", async () => {
            await expect(
                indexerRegistry.registerIndexer(1000000000, METADATA_HASH, 0)
            ).to.be.revertedWith("Already registered");
        });

        it("update metadata should work", async () => {
            await expect(indexerRegistry.updateMetadata(METADATA_1_HASH))
                .to.be.emit(indexerRegistry, "UpdateMetadata")
                .withArgs(wallet_0.address, METADATA_1_HASH);

            expect(
                await indexerRegistry.metadataByIndexer(wallet_0.address)
            ).to.equal(METADATA_1_HASH);
        });

        it("update metadata with invalid caller should fail", async () => {
            // caller is not an indexer
            await expect(
                indexerRegistry
                    .connect(wallet_1)
                    .updateMetadata(METADATA_1_HASH)
            ).to.be.revertedWith("Not an indexer");
        });
    });

    describe("Controller Account Management", () => {
        it("set controller account should work", async () => {
            // set controller
            await expect(indexerRegistry.setControllerAccount(wallet_1.address))
                .to.be.emit(indexerRegistry, "SetControllerAccount")
                .withArgs(wallet_0.address, wallet_1.address);

            // check state changes
            expect(
                await indexerRegistry.indexerToController(wallet_0.address)
            ).to.equal(wallet_1.address);
            expect(
                await indexerRegistry.controllerToIndexer(wallet_1.address)
            ).to.equal(wallet_0.address);
            expect(
                await indexerRegistry.isController(wallet_1.address)
            ).to.equal(true);
            expect(
                await indexerRegistry.controllerToIndexer(wallet_2.address)
            ).to.equal(constants.ZERO_ADDRESS);
        });

        it("update controller account should work", async () => {
            // set wallet1 as controller
            await indexerRegistry.setControllerAccount(wallet_1.address);
            // update wallet_2 as controller
            await indexerRegistry.setControllerAccount(wallet_2.address);
            // check state changes
            expect(
                await indexerRegistry.indexerToController(wallet_0.address)
            ).to.equal(wallet_2.address);
            expect(
                await indexerRegistry.controllerToIndexer(wallet_2.address)
            ).to.equal(wallet_0.address);
        });

        it("set controller account with invalid caller should fail", async () => {
            // caller is not an indexer
            await expect(
                indexerRegistry
                    .connect(wallet_1)
                    .setControllerAccount(wallet_0.address)
            ).to.be.revertedWith("Only indexer can set controller account");
        });

        it("set controller with used account should fail", async () => {
            // wallet_0 add wallet_2 as controller
            await indexerRegistry.setControllerAccount(wallet_2.address);
            await registerIndexer(wallet_1);
            // wallet_1 try to add wallet_2 as controller should fail
            await expect(
                indexerRegistry
                    .connect(wallet_1)
                    .setControllerAccount(wallet_2.address)
            ).to.be.revertedWith(
                "Controller account is used by an indexer already"
            );
        });

        it("remove controller account from indexer should work", async () => {
            await indexerRegistry.setControllerAccount(wallet_1.address);
            await expect(indexerRegistry.removeControllerAccount())
                .to.be.emit(indexerRegistry, "RemoveControllerAccount")
                .withArgs(wallet_0.address, wallet_1.address);

            // check state changes
            await checkControllerIsEmpty();
        });

        it("remove controller account with invalid caller should fail", async () => {
            // caller is not an indexer
            await expect(
                indexerRegistry.connect(wallet_1).removeControllerAccount()
            ).to.be.revertedWith("Only indexer can remove controller account");
        });
    });

    describe("Indexer Unregistry", () => {
        it("indexer deregister should work", async () => {
            // deregister from network
            await expect(
                indexerRegistry.unregisterIndexer({ gasLimit: "1000000" })
            )
                .to.be.emit(indexerRegistry, "UnregisterIndexer")
                .withArgs(wallet_0.address);

            // check updates
            await checkControllerIsEmpty();
            expect(await indexerRegistry.isIndexer(wallet_0.address)).to.equal(
                false
            );
            expect(
                await indexerRegistry.metadataByIndexer(wallet_0.address)
            ).to.equal(constants.ZERO_BYTES32);
        });

        it("deregister with invalid status should fail", async () => {
            // unregisted account
            await expect(
                indexerRegistry.connect(wallet_1).unregisterIndexer()
            ).to.be.revertedWith("Not registered");

            // with running projects
            await queryRegistry.createQueryProject(
                METADATA_HASH,
                VERSION,
                DEPLOYMENT_ID
            );
            await queryRegistry.startIndexing(DEPLOYMENT_ID);
            await expect(
                indexerRegistry.unregisterIndexer()
            ).to.be.revertedWith(
                "Can not unregister from the network due to running indexing projects"
            );
        });
    });
});
