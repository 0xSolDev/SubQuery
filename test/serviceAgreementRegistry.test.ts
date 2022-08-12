import {expect, use} from 'chai';
import {MockProvider, solidity} from 'ethereum-waffle';
import {deployContracts} from './setup';
import {METADATA_HASH, VERSION} from './constants';
import {createPurchaseOffer, futureTimestamp, lastestTime, timeTravel} from './helper';
import {
    SQToken,
    Staking,
    IndexerRegistry,
    QueryRegistry,
    PlanManager,
    PurchaseOfferMarket,
    ServiceAgreementRegistry,
} from '../src';
const {constants} = require('@openzeppelin/test-helpers');

use(solidity);

describe('Service Agreement Registry Contract', () => {
    let mockProvider = new MockProvider();
    const [wallet, wallet1, wallet2] = mockProvider.getWallets();
    let token: SQToken;
    let staking: Staking;
    let indexerRegistry: IndexerRegistry;
    let queryRegistry: QueryRegistry;
    let planManager: PlanManager;
    let purchaseOfferMarket: PurchaseOfferMarket;
    let serviceAgreementRegistry: ServiceAgreementRegistry;

    const deploymentId_1 = '0xbec921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c54';
    const deploymentId_2 = '0xccc921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c53';
    const deploymentId_3 = '0xaec921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c52';
    const deploymentId_4 = '0xaec921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c51';
    const deploymentId_5 = '0xaec921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c50';
    const deploymentId_6 = '0xaec921276c8067fe0c82def3e5ecfd8447f1961bc85768c2a56e6bd26d3c0c59';

    const allowanceMultiplerBP = '100000000000';

    beforeEach(async () => {
        const deployment = await deployContracts(wallet, wallet1);
        token = deployment.token;
        staking = deployment.staking;
        indexerRegistry = deployment.indexerRegistry;
        queryRegistry = deployment.queryRegistry;
        planManager = deployment.planManager;
        purchaseOfferMarket = deployment.purchaseOfferMarket;
        serviceAgreementRegistry = deployment.serviceAgreementRegistry;

        //SetAllowanceMultipler
        await serviceAgreementRegistry.setAllowanceMultipler(allowanceMultiplerBP);
        // await token.increaseAllowance(purchaseOfferMarket.address, 100000000000);
        await token.transfer(wallet.address, 100000000000);
    });

    describe('Establisher Management', () => {
        it('add and remove establisher should work', async () => {
            // check default config
            expect(await serviceAgreementRegistry.establisherWhitelist(purchaseOfferMarket.address)).be.equal(true);
            // add new establisher
            const establisher = planManager.address;
            await serviceAgreementRegistry.addEstablisher(establisher);
            expect(await serviceAgreementRegistry.establisherWhitelist(establisher)).to.be.equal(true);
            // remove establisher
            await serviceAgreementRegistry.removeEstablisher(establisher);
            expect(await serviceAgreementRegistry.establisherWhitelist(establisher)).to.be.equal(false);
        });

        it('add establisher without owner should fail', async () => {
            await expect(
                serviceAgreementRegistry.connect(wallet1).addEstablisher(planManager.address)
            ).to.be.revertedWith('Ownable: caller is not the owner');
        });
    });
    describe('Set Allowance Multipler', () => {
        beforeEach(async () => {
            // SetAllowanceMultipler
            await serviceAgreementRegistry.setAllowanceMultipler(allowanceMultiplerBP);
        });

        it('set allowance multipler should fail without owner', async () => {
            expect(await serviceAgreementRegistry.connect(wallet1).allowanceMultiplerBP()).to.be.equal(
                allowanceMultiplerBP
            );
        });
        it('should set allowance multipler with owner', async () => {
            expect(await serviceAgreementRegistry.allowanceMultiplerBP()).to.be.equal(allowanceMultiplerBP);
        });
    });
    describe('Establish Service Agressment', () => {
        beforeEach(async () => {
            // register indexer
            await token.increaseAllowance(staking.address, 10000000000);
            await token.increaseAllowance(purchaseOfferMarket.address, 10000000000);
            await indexerRegistry.registerIndexer(10000000000, METADATA_HASH, 0);
            await indexerRegistry.setControllerAccount(wallet2.address);

            // create 3 query projects
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_1);
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_2);
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_3);

            await queryRegistry.startIndexing(deploymentId_1);
            await queryRegistry.updateIndexingStatusToReady(deploymentId_1);
            await queryRegistry.startIndexing(deploymentId_2);

            // create a purchase offer
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_1);
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_2);
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_3);
        });

        it('should estabish service agressment successfully', async () => {
            // trigger `establishServiceAgreement` with `acceptPurchaseOffer`
            const tx = await purchaseOfferMarket.acceptPurchaseOffer(0);
            // TODO: get events
            // const { events: [_, event] } = await tx.wait();
            // const serviceAgreement = event.args[0];
            const serviceAgreements = await serviceAgreementRegistry.getServiceAgreements(wallet.address, 0);
            expect(serviceAgreements).to.be.not.equal(constants.ZERO_ADDRESS);
            expect(
                await serviceAgreementRegistry.hasOngoingServiceAgreement(wallet.address, deploymentId_1)
            ).to.be.equal(true);
        });

        it('should estabish service agressment should revert', async () => {
            // trigger `establishServiceAgreement` with `acceptPurchaseOffer`
            const tx = await purchaseOfferMarket.acceptPurchaseOffer(0);
            // TODO: get events
            // const { events: [_, event] } = await tx.wait();
            // const serviceAgreement = event.args[0];
            const serviceAgreements = await serviceAgreementRegistry.getServiceAgreements(wallet.address, 0);

            await token.increaseAllowance(purchaseOfferMarket.address, 500000);
            await purchaseOfferMarket.createPurchaseOffer(
                deploymentId_1,
                0,
                1000,
                2,
                100,
                futureTimestamp() + 86400,
                86400,
                true
            );

            await expect(purchaseOfferMarket.connect(wallet).acceptPurchaseOffer(3)).to.be.revertedWith(
                'Indexer reward reached to the limit'
            );
        });
    });

    describe('clearEndedAgreements', () => {
        beforeEach(async () => {
            // register indexer
            await token.increaseAllowance(staking.address, 10000000000);
            await token.increaseAllowance(purchaseOfferMarket.address, 10000000000);
            await indexerRegistry.registerIndexer(10000000000, METADATA_HASH, 0);
            await indexerRegistry.setControllerAccount(wallet2.address);

            // create 3 query projects
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_1);
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_2);
            await queryRegistry.createQueryProject(METADATA_HASH, VERSION, deploymentId_3);

            await queryRegistry.startIndexing(deploymentId_1);
            await queryRegistry.updateIndexingStatusToReady(deploymentId_1);
            await queryRegistry.startIndexing(deploymentId_2);

            // create a purchase offer
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_1);
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_2);
            await createPurchaseOffer(purchaseOfferMarket, deploymentId_3);
        });

        it('should clear service agressment successfully', async () => {
            // trigger `establishServiceAgreement` with `acceptPurchaseOffer`

            expect(
                await serviceAgreementRegistry.hasOngoingServiceAgreement(wallet.address, deploymentId_1)
            ).to.be.equal(false);

            const tx = await purchaseOfferMarket.acceptPurchaseOffer(0);
            // TODO: get events
            // const { events: [_, event] } = await tx.wait();
            // const serviceAgreement = event.args[0];
            const serviceAgreements = await serviceAgreementRegistry.getServiceAgreements(wallet.address, 0);
            expect(serviceAgreements).to.be.not.equal(constants.ZERO_ADDRESS);
            expect(
                await serviceAgreementRegistry.hasOngoingServiceAgreement(wallet.address, deploymentId_1)
            ).to.be.equal(true);

            await timeTravel(mockProvider, 2000);
            await serviceAgreementRegistry.clearEndedAgreements(wallet.address, 0);
            expect(
                await serviceAgreementRegistry.hasOngoingServiceAgreement(wallet.address, deploymentId_1)
            ).to.be.equal(false);
        });
    });
});
