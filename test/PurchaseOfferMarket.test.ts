import {expect, use} from 'chai';
import {Contract, Wallet} from 'ethers';
import {MockProvider, solidity} from 'ethereum-waffle';
import {deployContracts} from './setup';
import {DEPLOYMENT_ID, METADATA_HASH, VERSION} from './constants';
import {futureTimestamp} from './helper';
import {
    IndexerRegistry,
    PurchaseOfferMarket,
    QueryRegistry,
    ServiceAgreementRegistry,
    SQToken,
    Staking,
    RewardsDistributer,
} from '../src';

use(solidity);

describe('Purchase Offer Market Contract', () => {
    let mockProvider = new MockProvider();
    const [wallet_0, wallet_1, wallet_2] = mockProvider.getWallets();
    let purchaseOfferMarket: PurchaseOfferMarket;
    let serviceAgreementRegistry: ServiceAgreementRegistry;
    let indexerRegistry: IndexerRegistry;
    let queryRegistry: QueryRegistry;
    let staking: Staking;
    let token: SQToken;
    let rewardsDistributor: RewardsDistributer;

    const futureDate = futureTimestamp();
    const deposit = 100;
    const replicas = 1;
    const renewable = true;
    const minimumAcceptHeight = 100;
    const contractPeriod = 1000;
    const planTemplateId = 0;

    const createPurchaseOffer = async (expireDate: number) => {
        await token.increaseAllowance(purchaseOfferMarket.address, 10000);
        await purchaseOfferMarket.createPurchaseOffer(
            DEPLOYMENT_ID,
            planTemplateId,
            deposit,
            replicas,
            minimumAcceptHeight,
            expireDate,
            contractPeriod,
            renewable
        );
    };

    const registerIndexer = async (wallet: Wallet, controller: string) => {
        await token.connect(wallet_0).transfer(wallet.address, 1000000000);
        await token.connect(wallet).increaseAllowance(staking.address, 1000000000);
        await indexerRegistry.connect(wallet).registerIndexer(1000000000, METADATA_HASH, 0);
        await indexerRegistry.connect(wallet).setControllerAccount(controller);
    };

    beforeEach(async () => {
        const deployment = await deployContracts(wallet_0, wallet_1);
        purchaseOfferMarket = deployment.purchaseOfferMarket;
        serviceAgreementRegistry = deployment.serviceAgreementRegistry;
        indexerRegistry = deployment.indexerRegistry;
        queryRegistry = deployment.queryRegistry;
        staking = deployment.staking;
        token = deployment.token;
        rewardsDistributor = deployment.rewardsDistributer;
        await createPurchaseOffer(futureDate);
    });

    describe('Purchase Offer Market', () => {
        describe('Create Purchase Offer', () => {
            it('create offer should work', async () => {
                const offer = await purchaseOfferMarket.offers(0);
                expect(offer.contractee).to.equal(wallet_0.address);
                expect(offer.expireDate).to.equal(futureDate);
                expect(offer.deploymentId).to.equal(DEPLOYMENT_ID);
                expect(offer.deposit).to.equal(deposit);
                expect(offer.replicas).to.equal(replicas);
                expect(offer.numAcceptedContracts).to.equal(0);
                expect(offer.renewable).to.equal(renewable);
                expect(offer.minimumAcceptHeight).to.equal(minimumAcceptHeight);
                expect(offer.planTemplateId).to.equal(planTemplateId);
                expect(offer.contractPeriod).to.equal(contractPeriod);
                expect(offer.cancelled).to.equal(false);
                expect(await purchaseOfferMarket.numOffers()).to.be.equal(1);
                expect(await token.balanceOf(purchaseOfferMarket.address)).to.equal(deposit * replicas);
            });

            it('create offer with invalid params should fail ', async () => {
                // invalid expiration
                await expect(
                    purchaseOfferMarket.createPurchaseOffer(
                        DEPLOYMENT_ID,
                        planTemplateId,
                        deposit,
                        replicas,
                        minimumAcceptHeight,
                        0,
                        contractPeriod,
                        renewable
                    )
                ).to.be.revertedWith('invalid expiration');
                // zero deposit
                await expect(
                    purchaseOfferMarket.createPurchaseOffer(
                        DEPLOYMENT_ID,
                        planTemplateId,
                        0,
                        replicas,
                        minimumAcceptHeight,
                        futureDate,
                        contractPeriod,
                        renewable
                    )
                ).to.be.revertedWith('should deposit positive amount');
                // zero replicas
                await expect(
                    purchaseOfferMarket.createPurchaseOffer(
                        DEPLOYMENT_ID,
                        planTemplateId,
                        deposit,
                        0,
                        minimumAcceptHeight,
                        futureDate,
                        contractPeriod,
                        renewable
                    )
                ).to.be.revertedWith('should replicas positive amount');
            });
        });

        describe('Cancel Purchase Offer', () => {
            it('cancel offer should work', async () => {
                const consumerBalance = await token.balanceOf(wallet_0.address);
                const offerMarketBalance = await token.balanceOf(purchaseOfferMarket.address);

                expect(await purchaseOfferMarket.cancelPurchaseOffer(0))
                    .to.be.emit(purchaseOfferMarket, 'PurchaseOfferCancelled')
                    .withArgs(wallet_0.address, 0);
                const offer = await purchaseOfferMarket.offers(0);
                expect(offer.cancelled).to.equal(true);

                // check balance changed
                const amount = deposit * replicas;
                expect(await token.balanceOf(purchaseOfferMarket.address)).to.equal(offerMarketBalance.sub(amount));
                expect(await token.balanceOf(wallet_0.address)).to.equal(consumerBalance.add(amount));
            });

            it('cancel offer with invalid caller should fail', async () => {
                await expect(purchaseOfferMarket.connect(wallet_1).cancelPurchaseOffer(0)).to.be.revertedWith(
                    'only offerer can cancel the offer'
                );
            });
        });

        describe('Accept Purchase Offer', () => {
            beforeEach(async () => {
                // create second offer
                await createPurchaseOffer(new Date().getTime() + 10000);
                // register indexers
                await registerIndexer(wallet_0, wallet_1.address);
                await registerIndexer(wallet_1, wallet_0.address);
                // create query project
                await queryRegistry.createQueryProject(METADATA_HASH, VERSION, DEPLOYMENT_ID);
                // wallet_0 start project
                await queryRegistry.startIndexing(DEPLOYMENT_ID);
                await queryRegistry.updateIndexingStatusToReady(DEPLOYMENT_ID);
            });

            it('accept offer should work', async () => {
                const offerMarketBalance = await token.balanceOf(purchaseOfferMarket.address);
                let offer = await purchaseOfferMarket.offers(0);
                const rewardsDistrBalance = await token.balanceOf(rewardsDistributor.address);

                // accept offer
                await purchaseOfferMarket.acceptPurchaseOffer(0);
                const serviceAgreements = await serviceAgreementRegistry.getServiceAgreements(
                    wallet_0.address,
                    DEPLOYMENT_ID
                );
                const CSAContractAddress = serviceAgreements[0];

                // check updates for the offer
                offer = await purchaseOfferMarket.offers(0);
                expect(await purchaseOfferMarket.acceptedOffer(0, wallet_0.address)).to.equal(true);
                expect(offer.numAcceptedContracts).to.equal(1);
                expect(await token.balanceOf(purchaseOfferMarket.address)).to.equal(offerMarketBalance.sub(deposit));
                expect(await token.balanceOf(CSAContractAddress)).to.equal(0);
                expect(await token.balanceOf(rewardsDistributor.address)).to.equal(rewardsDistrBalance.add(deposit));
            });

            it('accept offer with invalid params and caller should fail', async () => {
                // invalid caller
                await expect(purchaseOfferMarket.connect(wallet_2).acceptPurchaseOffer(0)).to.be.revertedWith(
                    'caller is not an indexer'
                );
                // invalid offerId
                await expect(purchaseOfferMarket.acceptPurchaseOffer(2)).to.be.revertedWith('invalid offerId');
                // offer already accepted
                await purchaseOfferMarket.acceptPurchaseOffer(0);
                await expect(purchaseOfferMarket.acceptPurchaseOffer(0)).to.be.revertedWith('offer accepted already');
                // offer cancelled
                await purchaseOfferMarket.cancelPurchaseOffer(1);
                await expect(purchaseOfferMarket.acceptPurchaseOffer(1)).to.be.revertedWith('offer cancelled');
                // contracts reacheed replicas
                await expect(purchaseOfferMarket.connect(wallet_1).acceptPurchaseOffer(0)).to.be.revertedWith(
                    'number of contracts already reached replicas'
                );
            });
        });
    });
});
