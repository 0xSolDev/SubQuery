import { expect, use } from "chai";
import { BigNumber } from "ethers";
import { MockProvider, solidity } from "ethereum-waffle";
import { describe } from "mocha";

import { IndexerRegistry, EraManager, SQToken, Staking } from "../typechain";
import { deployContracts } from "./setup";
import {
    lastestTime,
    registerIndexer,
    startNewEra,
    timeTravel,
} from "./helper";

use(solidity);

describe("Staking Contract", () => {
    let mockProvider = new MockProvider();
    const [indexer, indexer2, delegator] = mockProvider.getWallets();
    let token: SQToken;
    let staking: Staking;
    let eraManager: EraManager;
    let indexerRegistry: IndexerRegistry;

    const amount = 1000000000;

    const checkDelegation = async (
        _delegator: string,
        indexerAddress: string,
        valueAfter: number,
        era: number
    ) => {
        const stakingAmount = await staking.getStakingAmount(
            _delegator,
            indexerAddress
        );
        expect(stakingAmount.valueAfter).to.equal(valueAfter);
        expect(await eraManager.eraNumber()).to.equal(era);
    };

    const checkStakingAmount = async (
        indexerAddress: string,
        valueAfter: number,
        era: number
    ) => {
        const totalStakingAmount = await staking.getTotalStakingAmount(
            indexerAddress
        );
        expect(totalStakingAmount).to.equal(valueAfter);
        expect(await eraManager.eraNumber()).to.equal(era);
    };

    const availableWidthdraw = async (unbondAmount: BigNumber) => {
        const unbondFeeRateBP = await staking.unbondFeeRateBP();
        const UNNOMINATE_BURNRATE_MULTIPLIER =
            await staking.UNNOMINATE_BURNRATE_MULTIPLIER();
        const burnAmount = unbondFeeRateBP
            .mul(unbondAmount)
            .div(UNNOMINATE_BURNRATE_MULTIPLIER);
        const availableAmount = unbondAmount.sub(burnAmount);

        return { availableAmount, burnAmount };
    };

    const configWallet = async () => {
        await registerIndexer(
            token,
            indexerRegistry,
            staking,
            indexer,
            indexer
        );
        await registerIndexer(
            token,
            indexerRegistry,
            staking,
            indexer,
            indexer2
        );
        await token.connect(indexer).transfer(delegator.address, amount);
        await token
            .connect(delegator)
            .increaseAllowance(staking.address, amount);
    };

    beforeEach(async () => {
        const deployment = await deployContracts(indexer, indexer2);
        token = deployment.token;
        staking = deployment.staking;
        eraManager = deployment.eraManager;
        indexerRegistry = deployment.indexerRegistry;
        await configWallet();
    });

    describe("Staking Config", () => {
        it("check staking configs", async () => {
            expect(await staking.lockPeriod()).to.equal(1000);
            expect(await staking.indexerLeverageLimit()).to.equal(10);
            expect(await staking.unbondFeeRateBP()).to.equal(10);
        });

        it("update configs should work", async () => {
            await staking.setLockPeriod(100);
            expect(await staking.lockPeriod()).to.equal(100);

            await staking.setIndexerLeverageLimit(100);
            expect(await staking.indexerLeverageLimit()).to.equal(100);

            await staking.setUnbondFeeRateBP(100);
            expect(await staking.unbondFeeRateBP()).to.equal(100);
        });

        it("update configs without owner should fail", async () => {
            await expect(
                staking.connect(indexer2).setLockPeriod(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                staking.connect(indexer2).setIndexerLeverageLimit(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                staking.connect(indexer2).setUnbondFeeRateBP(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Staking Tokens", () => {
        it("staking by indexer registry should work", async () => {
            // check statking state with 2 registered indexer
            expect(await staking.indexerLength()).to.equal(2);
            expect(await staking.indexerNo(indexer.address)).to.equal(0);
            expect(await staking.indexerNo(indexer2.address)).to.equal(1);
            expect(await staking.indexers(0)).to.equal(indexer.address);
            expect(await staking.indexers(1)).to.equal(indexer2.address);
            expect(
                await staking.stakingIndexerNos(
                    indexer.address,
                    indexer.address
                )
            ).to.equal(0);
            expect(await staking.stakingIndexers(indexer.address, 0)).to.equal(
                indexer.address
            );
            expect(
                await staking.getStakingIndexersLength(indexer.address)
            ).to.equal(1);

            // first stake from indexer should be effective immediately
            const stakingAmount = await staking.getStakingAmount(indexer.address, indexer.address);
            expect(stakingAmount.valueAt).to.equal(amount);
            expect(stakingAmount.valueAfter).to.equal(amount);
            await checkStakingAmount(indexer.address, amount, 1);
            expect(await token.balanceOf(staking.address)).to.equal(amount * 2);
        });

        it("staking by delegator should work", async () => {
            const delegatorBalance = await token.balanceOf(delegator.address);
            const contractBalance = await token.balanceOf(staking.address);
            await staking.connect(delegator).delegate(indexer.address, 1000);

            await startNewEra(mockProvider, eraManager);
            expect(
                await staking.getStakingIndexersLength(delegator.address)
            ).to.equal(1);
            await checkDelegation(delegator.address, indexer.address, 1000, 2);
            await checkStakingAmount(indexer.address, amount + 1000, 2);

            expect(await token.balanceOf(delegator.address)).to.equal(
                delegatorBalance.sub(1000)
            );
            expect(await token.balanceOf(staking.address)).to.equal(
                contractBalance.add(1000)
            );
        });

        it("redelegate should work", async () => {
            const [from_indexer, to_indexer] = [
                indexer.address,
                indexer2.address,
            ];
            await staking.connect(delegator).delegate(from_indexer, 1000);
            await staking
                .connect(delegator)
                .redelegate(from_indexer, to_indexer, 1000);

            await startNewEra(mockProvider, eraManager);
            expect(
                await staking.getStakingIndexersLength(delegator.address)
            ).to.equal(2);
            await checkDelegation(delegator.address, from_indexer, 0, 2);
            await checkStakingAmount(from_indexer, amount, 2);
            await checkDelegation(delegator.address, to_indexer, 1000, 2);
            await checkStakingAmount(to_indexer, amount + 1000, 2);
        });

        it("staking by indexer registry with invalid caller should fail", async () => {
            await expect(
                staking.stake(indexer.address, 1000)
            ).to.be.revertedWith("Caller is not indexerRegistry");
        });

        it("redelegate with invalid params should fail", async () => {
            // self delegation
            await expect(
                staking.redelegate(indexer.address, indexer2.address, 1000)
            ).to.be.revertedWith("Self delegation can not be redelegated");
            // out of amount
            await staking.connect(delegator).delegate(indexer.address, 1000);
            await expect(
                staking
                    .connect(delegator)
                    .redelegate(indexer.address, indexer2.address, 1001)
            ).to.be.revertedWith(
                "Removed delegation cannot be greater than current amount"
            );
        });

        it("delegation excess max limitation should fail", async () => {
            const indexerLeverageLimit = await staking.indexerLeverageLimit();
            const indexerStakingAmount = await staking.getDelegationAmount(
                indexer.address,
                indexer.address
            );
            await token
                .connect(indexer)
                .transfer(
                    delegator.address,
                    indexerStakingAmount.mul(indexerLeverageLimit)
                );

            await expect(
                staking
                    .connect(delegator)
                    .delegate(
                        indexer.address,
                        indexerStakingAmount.mul(indexerLeverageLimit)
                    )
            ).to.be.revertedWith("Delegation limitation reached");
        });
    });

    describe("Request Undelegate", () => {
        beforeEach(async () => {
            await staking.connect(delegator).delegate(indexer.address, 2000);
        });

        const checkUnbondingAmount = async (
            source: string,
            id: number,
            startTime: number | BigNumber,
            amount: number | BigNumber
        ) => {
            const unbondingAmount = await staking.getUnbondingAmount(
                source,
                id
            );
            expect(unbondingAmount.amount).to.equal(amount);
            expect(unbondingAmount.startTime).to.equal(startTime);
        };

        it("request unbond by indexer registry should work", async () => {
            await indexerRegistry.unstake(1000, { gasLimit: "1000000" });
            const startTime = await lastestTime(mockProvider);

            // check changes of staking storage
            await startNewEra(mockProvider, eraManager);
            await checkDelegation(
                indexer.address,
                indexer.address,
                amount - 1000,
                2
            );
            await checkStakingAmount(indexer.address, amount + 1000, 2);
            await checkUnbondingAmount(indexer.address, 0, startTime, 1000);

            // check changes of unbonding storage
            expect(await staking.unbondingLength(indexer.address)).to.equal(1);
            expect(await staking.withdrawnLength(indexer.address)).to.equal(0);
            expect(await staking.indexerLength()).to.equal(2);
        });

        it("request unstaking all by indexer registry should work", async () => {
            await indexerRegistry.unregisterIndexer({ gasLimit: "1000000" });

            // check changes of indexer storage
            await startNewEra(mockProvider, eraManager);
            expect(await staking.indexerLength()).to.equal(1);
            expect(await staking.indexerNo(indexer.address)).to.equal(0);
            expect(await staking.indexerNo(indexer2.address)).to.equal(0);
            expect(await staking.indexers(0)).to.equal(indexer2.address);
        });

        it("request undelegate by delegator should work", async () => {
            // request the first unbond
            await expect(
                staking.connect(delegator).undelegate(indexer.address, 1000)
            )
                .to.be.emit(staking, "UnbondRequested")
                .withArgs(delegator.address, indexer.address, 1000, 0);
            const startTime = await lastestTime(mockProvider);

            // check changes of staking storage
            await startNewEra(mockProvider, eraManager);
            await checkDelegation(delegator.address, indexer.address, 1000, 2);
            await checkStakingAmount(indexer.address, amount + 1000, 2);
            await checkUnbondingAmount(delegator.address, 0, startTime, 1000);

            // check changes of unbonding storage
            expect(await staking.unbondingLength(delegator.address)).to.equal(
                1
            );
            expect(await staking.withdrawnLength(delegator.address)).to.equal(
                0
            );
        });

        it("multiple undelegate request by delegator should work", async () => {
            await staking.connect(delegator).undelegate(indexer.address, 500);
            await staking.connect(delegator).undelegate(indexer.address, 500);
            await staking.connect(delegator).undelegate(indexer.address, 500);

            // check changes of staking storage
            await startNewEra(mockProvider, eraManager);
            await checkDelegation(delegator.address, indexer.address, 500, 2);
            await checkStakingAmount(indexer.address, amount + 500, 2);

            // check all unbondingAmounts
            const unbondingAmounts = await staking.getUnbondingAmounts(
                delegator.address
            );
            expect(unbondingAmounts.length).to.equal(3);
            unbondingAmounts.forEach(async ({ amount, startTime }, index) => {
                await checkUnbondingAmount(
                    delegator.address,
                    index,
                    startTime,
                    amount
                );
            });

            // check changes of unbonding storage
            expect(await staking.unbondingLength(delegator.address)).to.equal(
                3
            );
            expect(await staking.withdrawnLength(delegator.address)).to.equal(
                0
            );
        });

        it("request undelegate with invlaid params should fail", async () => {
            // indexer unstake out of balance
            await expect(
                staking.undelegate(indexer.address, amount)
            ).to.be.revertedWith("Self delegation can not unbond from staking");
            // amount should be positive
            await expect(
                staking.connect(delegator).undelegate(indexer.address, 0)
            ).to.be.revertedWith("Amount should be positive");
            // delegator undelegate out of balance
            await expect(
                staking.connect(delegator).undelegate(indexer.address, 2001)
            ).to.be.revertedWith(
                "Removed delegation cannot be greater than current amount"
            );
        });

        it("request unbond by indexer registry with invalid caller should fail", async () => {
            // invalid caller
            await expect(
                staking.connect(indexer2).unstake(indexer2.address, 1000)
            ).to.be.revertedWith("Caller is not indexerRegistry");
        });
    });

    describe("Withdraw Undelegate", () => {
        const checkUnbondingChanges = async (
            balance: BigNumber,
            unbondingLength: number,
            withdrawnLength: number
        ) => {
            expect(await token.balanceOf(delegator.address)).to.equal(balance);
            expect(await staking.unbondingLength(delegator.address)).to.equal(
                unbondingLength
            );
            expect(await staking.withdrawnLength(delegator.address)).to.equal(
                withdrawnLength
            );
        };

        beforeEach(async () => {
            await staking.connect(delegator).delegate(indexer.address, 10000);
        });

        it("withdraw from single indexer should work", async () => {
            // get initial balances
            const delegatorBalance = await token.balanceOf(delegator.address);
            const contractBalance = await token.balanceOf(staking.address);

            // request undelegate
            await staking.connect(delegator).undelegate(indexer.address, 1000);
            await timeTravel(mockProvider, 1000);
            // request another undelegate
            await staking.connect(delegator).undelegate(indexer.address, 1000);
            expect(await staking.unbondingLength(delegator.address)).to.equal(
                2
            );

            // withdraw an undelegate
            const unbondingAmount = await staking.getUnbondingAmount(
                delegator.address,
                0
            );
            const { availableAmount } = await availableWidthdraw(
                unbondingAmount.amount
            );
            await staking.connect(delegator).widthdraw();

            // check balances
            expect(await token.balanceOf(delegator.address)).to.equal(
                delegatorBalance.add(availableAmount)
            );
            expect(await token.balanceOf(staking.address)).to.equal(
                contractBalance.sub(unbondingAmount.amount)
            );

            // check changes of unbonding storage
            expect(await staking.unbondingLength(delegator.address)).to.equal(
                2
            );
            expect(await staking.withdrawnLength(delegator.address)).to.equal(
                1
            );
        });

        it("withdraw from multi indexers should work", async () => {
            // delegate to another indexer
            await staking.connect(delegator).delegate(indexer2.address, 10000);

            // undelegate from 2 indexers
            await staking.connect(delegator).undelegate(indexer.address, 500);
            await staking.connect(delegator).undelegate(indexer2.address, 500);
            await staking.connect(delegator).undelegate(indexer.address, 500);
            await timeTravel(mockProvider, 1000);
            await staking.connect(delegator).undelegate(indexer2.address, 500);
            await staking.connect(delegator).undelegate(indexer.address, 500);

            let delegatorBalance = await token.balanceOf(delegator.address);
            await checkUnbondingChanges(delegatorBalance, 5, 0);

            // widthdraw the fist 3 requests
            await staking.connect(delegator).widthdraw();
            const { availableAmount } = await availableWidthdraw(
                BigNumber.from(500)
            );
            delegatorBalance = delegatorBalance.add(availableAmount.mul(3));
            await checkUnbondingChanges(delegatorBalance, 5, 3);

            // widthdraw the other 2 requests
            await timeTravel(mockProvider, 1000);
            await staking.connect(delegator).widthdraw();
            delegatorBalance = delegatorBalance.add(availableAmount.mul(2));
            await checkUnbondingChanges(delegatorBalance, 5, 5);
        });

        it("withdraw max 10 undelegate requests should work", async () => {
            // request 12 undelegate requests
            for (let i = 0; i < 12; i++) {
                await staking
                    .connect(delegator)
                    .undelegate(indexer.address, 500);
            }
            let delegatorBalance = await token.balanceOf(delegator.address);
            await checkUnbondingChanges(delegatorBalance, 12, 0);

            // make the 12 undelegate requests ready to withdraw
            await timeTravel(mockProvider, 1000);
            // request extra 3 undelegate requests
            for (let i = 0; i < 3; i++) {
                await staking
                    .connect(delegator)
                    .undelegate(indexer.address, 500);
            }
            await checkUnbondingChanges(delegatorBalance, 15, 0);

            // first withdraw only claim the first 10 requests
            await staking.connect(delegator).widthdraw();
            // check balance and unbonding storage
            const { availableAmount } = await availableWidthdraw(
                BigNumber.from(500)
            );
            delegatorBalance = delegatorBalance.add(availableAmount.mul(10));
            await checkUnbondingChanges(delegatorBalance, 15, 10);

            // second withdraw claim the other 2 requests
            await staking.connect(delegator).widthdraw();
            // check balance and unbonding storage
            delegatorBalance = delegatorBalance.add(availableAmount.mul(2));
            await checkUnbondingChanges(delegatorBalance, 15, 12);

            // make the next 3 undelegate requests ready to withdraw
            await timeTravel(mockProvider, 1000);
            await staking.connect(delegator).widthdraw();
            delegatorBalance = delegatorBalance.add(availableAmount.mul(3));
            await checkUnbondingChanges(delegatorBalance, 15, 15);
        });

        it("withdraw an unbond with invalid status should fail", async () => {
            // no unbonding requests for withdrawing
            await expect(
                staking.connect(delegator).widthdraw()
            ).to.be.revertedWith("Need to request unbond before withdraw");
        });
    });

    // describe("Set Commission Rate", () => {
    //     it("set commission rate should work", async () => {
    //         expect(
    //             await indexerRegistry.getCommissionRate(wallet_0.address)
    //         ).to.equal("0");
    //         expect(await indexerRegistry.setCommissionRate(100))
    //             .to.be.emit(indexerRegistry, "SetCommissionRate")
    //             .withArgs(wallet_0.address, 100);

    //         const commissionRate = await indexerRegistry.commissionRates(
    //             wallet_0.address
    //         );
    //         expect(commissionRate.valueAfter).to.equal(100);
    //         expect(
    //             await indexerRegistry.getCommissionRate(wallet_0.address)
    //         ).to.equal("0");
    //         await startNewEra(mockProvider, eraManager);
    //         expect(
    //             await indexerRegistry.getCommissionRate(wallet_0.address)
    //         ).to.equal("0");
    //         await startNewEra(mockProvider, eraManager);
    //         expect(
    //             await indexerRegistry.getCommissionRate(wallet_0.address)
    //         ).to.equal("100");
    //     });

    //     it("set commission rate with invalid params should fail", async () => {
    //         // not an indexer
    //         await expect(
    //             indexerRegistry.connect(wallet_1).setCommissionRate(100)
    //         ).to.be.revertedWith("Not an indexer");
    //         // rate greater than COMMISSION_RATE_MULTIPLIER
    //         await expect(
    //             indexerRegistry.setCommissionRate(1e4)
    //         ).to.be.revertedWith("Invalid commission rate");
    //     });
    // });
});
