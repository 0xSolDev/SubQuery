import { expect, use } from "chai";
import { MockProvider, solidity } from "ethereum-waffle";

import { deployContracts } from "./setup";
import { timeTravel } from "./helper";
import { describe } from "mocha";
import { InflationController, EraManager, SQToken } from "../src";


use(solidity);

describe("Inflation Controller Contract", () => {
    let mockProvider = new MockProvider();
    const [wallet_0, wallet_1, wallet_2] = mockProvider.getWallets();
    const inflationDestination = wallet_1.address;

    let inflationController: InflationController;
    let eraManager: EraManager;
    let token: SQToken;

    const getMissingClaimCount = async () => {
        const notInflatedEra = await inflationController.getNotInflatedEras();
        return Math.min(notInflatedEra.toNumber(), 10);
    }

    const calculateClaim = async () => {
        const inflationRateBP = await inflationController.inflationRateBP();
        const missingClaimCount = await getMissingClaimCount();
        const totalSupply = await token.totalSupply();

        let newSupply = totalSupply;
        for (let i = 0; i < missingClaimCount; i++) {
            newSupply = (newSupply.mul(inflationRateBP.add(10000))).div(10000);
        }

        return newSupply.sub(totalSupply);
    };

    beforeEach(async () => {
        const deployment = await deployContracts(wallet_0, wallet_1);
        inflationController = deployment.inflationController;
        eraManager = deployment.eraManager;
        token = deployment.token;

        await eraManager.startNewEra();
    });

    describe("Inflation Config", () => {
        it("check initial settings", async () => {
            expect(await inflationController.inflationRateBP()).to.equal(10);
            expect(await inflationController.inflationDestination()).to.equal(wallet_1.address);
            expect(await inflationController.getLastInflatedEra()).to.equal(0);
            expect(await inflationController.getNotInflatedEras()).to.equal(1);
        });

        it("set inflation destination should work", async () => {
            await inflationController.setInflationDestination(wallet_2.address);
            expect(await inflationController.inflationDestination()).to.equal(wallet_2.address);
        });

        it("set infaltion destination without owner should fail", async () => {
            await expect(inflationController.connect(wallet_1).setInflationDestination(wallet_2.address))
                .to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("set inflation rate BP should work", async () => {
            await inflationController.setInflationRateBP(100);
            expect(await inflationController.inflationRateBP()).to.equal(100);

            // inflationRateBP can be zero
            await inflationController.setInflationRateBP(0);
            expect(await inflationController.inflationRateBP()).to.equal(0);
        });

        it("set inflation rate BP with invalid params should fail", async () => {
            await expect(inflationController.setInflationRateBP(10001)).to.be.revertedWith(
                "InflationRateBP value is out of range"
            );
        });
    });

    describe("Mint Inflation Tokens", () => {
        it("mint inflation tokens should work", async () => {
            let balanceBefore = await token.balanceOf(inflationDestination);
            let claimAmount = await calculateClaim();

            // mint inflation tokens
            expect(await inflationController.getNotInflatedEras()).to.equal(1);
            await inflationController.mintInflatedTokens();
            expect(await inflationController.getNotInflatedEras()).to.equal(0);
            expect(await inflationController.getLastInflatedEra()).to.equal(1);
            expect(await token.balanceOf(inflationDestination)).to.equal(claimAmount.add(balanceBefore));

            // trigger 11 eras
            await eraManager.updateEraPeriod(10);
            for (let i = 0; i < 11; i++) {
                await timeTravel(mockProvider, 11);
                await eraManager.startNewEra();
            }

            claimAmount = await calculateClaim();
            balanceBefore = await token.balanceOf(inflationDestination);
            // mint inflation tokens after 12 eras
            expect(await eraManager.eraNumber()).to.equal(12);
            expect(await inflationController.getNotInflatedEras()).to.equal(11);
            await inflationController.mintInflatedTokens();
            expect(await inflationController.getNotInflatedEras()).to.equal(1);
            expect(await inflationController.getLastInflatedEra()).to.equal(11);
            expect(await token.balanceOf(inflationDestination)).to.equal(claimAmount.add(balanceBefore));
        });

        it("mint inflation tokens without missing claim count should fail", async () => {
            await inflationController.mintInflatedTokens();
            await expect(inflationController.mintInflatedTokens()).to.be.revertedWith(
                "Already minted in the current era"
            );
        });
    });
});
